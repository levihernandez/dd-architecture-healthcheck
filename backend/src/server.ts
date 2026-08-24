import 'dotenv/config';
import './tracer'; // must come before all other imports for APM patching
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { initDatabase, closeDatabase } from './db/database';
import { requestLoggingMiddleware } from './api/middleware/logging.middleware';
import { errorMiddleware } from './api/middleware/error.middleware';
import orgsRouter from './api/routes/orgs.routes';
import scansRouter from './api/routes/scans.routes';
import inventoryRouter from './api/routes/inventory.routes';
import aiRouter from './api/routes/ai.routes';
import exportRouter from './api/routes/export.routes';
import taggingRouter from './api/routes/tagging.routes';
import chatRouter from './api/routes/chat.routes';
import aiSettingsRouter from './api/routes/ai-settings.routes';
import analyticsRouter from './api/routes/analytics.routes';
import orgContextRouter from './api/routes/org-context.routes';
import tagTemplateRouter from './api/routes/tag-template.routes';
import usageRouter from './api/routes/usage.routes';
import pricingSnapshotsRouter from './api/routes/pricing-snapshots.routes';
import sizingSnapshotsRouter from './api/routes/sizing-snapshots.routes';
import idpRouter from './api/routes/idp.routes';
import eventsRouter from './api/routes/events.routes';
import featureFlagsRouter from './api/routes/feature-flags.routes';
import authRouter from './api/routes/auth.routes';
import { authMiddleware } from './api/middleware/auth.middleware';
import { FeatureFlagRepository } from './feature-flags/repository';
import { logger } from './utils/logger';
import { resolveEncryptedEnv } from './utils/secrets';
import { ensureTlsCredentials } from './utils/tls';
import { ensurePromptsSeeded } from './ai/prompt-store';
import fs from 'fs';
import https from 'https';

// Ensure log directory exists
if (!fs.existsSync('logs')) fs.mkdirSync('logs', { recursive: true });

// Ensure PROMPTS_DIR exists and every known prompt file is seeded from the
// bundled defaults (backend/src/ai/prompt-defaults) — a fresh checkout or a
// fresh (empty) mounted volume in prod must never boot with missing prompts.
// Never overwrites a file that already exists, so host edits survive restarts.
ensurePromptsSeeded();

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001');
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true';

// Trust exactly one hop — the nginx reverse proxy in front of this container
// (see frontend/nginx.conf). Without this, express-rate-limit throws on the
// X-Forwarded-For header nginx adds (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR), and
// req.ip would resolve to nginx's container IP instead of the real client.
app.set('trust proxy', 1);

// Security
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    // Datadog RUM trace-propagation headers — needed so browser fetch/XHR
    // requests to /api aren't blocked by CORS preflight, which would sever
    // the RUM<->APM trace link (see allowedTracingUrls in frontend/src/lib/datadog.ts)
    'x-datadog-origin',
    'x-datadog-parent-id',
    'x-datadog-sampling-priority',
    'x-datadog-trace-id',
    'x-datadog-tags',
    'traceparent',
    'tracestate',
  ],
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX ?? '100'),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Logging
app.use(requestLoggingMiddleware);

// Health check — must stay reachable without a token (container healthcheck).
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Auth routes are public (register/login) or self-authenticating (/me checks its
// own token) — mounted before the blanket /api gate below.
app.use('/api/auth', authRouter);

// Everything else under /api requires a valid Bearer token.
app.use('/api', authMiddleware);

// Routes
app.use('/api/orgs', orgsRouter);
app.use('/api/scans', scansRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/ai', aiRouter);
app.use('/api/export', exportRouter);
app.use('/api/tagging', taggingRouter);
app.use('/api/chat', chatRouter);
app.use('/api/ai-settings', aiSettingsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/orgs', orgContextRouter);
app.use('/api/orgs', tagTemplateRouter);
app.use('/api/usage', usageRouter);
app.use('/api/pricing-snapshots', pricingSnapshotsRouter);
app.use('/api/sizing-snapshots', sizingSnapshotsRouter);
app.use('/api/idp', idpRouter);
app.use('/api/events', eventsRouter);
app.use('/api/feature-flags', featureFlagsRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Route ${req.path} not found` });
});

// Error handler
app.use(errorMiddleware);

async function start() {
  await resolveEncryptedEnv(); // decrypts any ENC[...] values (e.g. DD_API_KEY/DD_APP_KEY) before the DB or routes touch them

  await initDatabase();

  await FeatureFlagRepository.seedDefaults();

  const protocol = HTTPS_ENABLED ? 'https' : 'http';
  const listening = () => {
    logger.info(`Datadog Health Check backend running on ${protocol}://localhost:${PORT}`);
    logger.info(`AI provider: ${process.env.AI_PROVIDER ?? 'none'}`);
  };

  const server = HTTPS_ENABLED
    ? https
        .createServer(
          ensureTlsCredentials(
            process.env.SSL_CERT_PATH ?? './certs/cert.pem',
            process.env.SSL_KEY_PATH ?? './certs/key.pem'
          ),
          app
        )
        .listen(PORT, listening)
    : app.listen(PORT, listening);

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully`);
    // server.close()'s callback only fires once every open connection closes.
    // A lingering keep-alive/SSE connection would otherwise hang shutdown
    // forever, leaving this process holding the port on the next `npm run dev`.
    server.closeAllConnections();
    server.close(() => {
      closeDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();

export default app;

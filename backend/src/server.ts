import 'dotenv/config';
import './tracer'; // must come before all other imports for APM patching
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { getDatabase, closeDatabase } from './db/database';
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
import usageRouter from './api/routes/usage.routes';
import { logger } from './utils/logger';
import { resolveEncryptedEnv } from './utils/secrets';
import fs from 'fs';

// Ensure log directory exists
if (!fs.existsSync('logs')) fs.mkdirSync('logs', { recursive: true });

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001');

// Security
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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
app.use('/api/usage', usageRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Route ${req.path} not found` });
});

// Error handler
app.use(errorMiddleware);

async function start() {
  await resolveEncryptedEnv(); // decrypts any ENC[...] values (e.g. DD_API_KEY/DD_APP_KEY) before the DB or routes touch them

  getDatabase();

  const server = app.listen(PORT, () => {
    logger.info(`Datadog Health Check backend running on http://localhost:${PORT}`);
    logger.info(`AI provider: ${process.env.AI_PROVIDER ?? 'none'}`);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  });
}

start();

export default app;

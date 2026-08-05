import { Router } from 'express';
import { z } from 'zod';
import { buildChatContext } from '../../chat/context-builder';
import { streamChatResponse } from '../../chat/streaming';
import { logger } from '../../utils/logger';

const router = Router();

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});

const ChatRequestSchema = z.object({
  orgId: z.string().min(1),
  scanId: z.string().optional(),
  page: z.string().optional(),
  messages: z.array(MessageSchema).min(1).max(40),
});

router.post('/stream', async (req, res) => {
  const parse = ChatRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  const { orgId, scanId, page, messages } = parse.data;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const context = buildChatContext(orgId, scanId, page);
    logger.info(`[chat] streaming response for org=${orgId} page=${page ?? 'none'} messages=${messages.length}`);
    await streamChatResponse(context, messages, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    logger.error(`[chat] error: ${msg}`);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', content: msg })}\n\n`);
      res.write('data: [DONE]\n\n');
    } catch { /* client disconnected */ }
  } finally {
    res.end();
  }
});

// Non-streaming context endpoint — useful for debugging / showing what context was built
router.get('/context', (req, res) => {
  const { orgId, scanId, page } = req.query as Record<string, string>;
  if (!orgId) { res.status(400).json({ error: 'orgId required' }); return; }
  try {
    const context = buildChatContext(orgId, scanId, page);
    res.json({ context });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;

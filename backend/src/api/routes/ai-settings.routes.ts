import { Router } from 'express';
import axios from 'axios';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AISettingsRepository } from '../../ai/settings-repository';
import { getAIConfig } from '../../ai/config';
import { logger } from '../../utils/logger';
import { listPrompts, savePrompt, isKnownPromptKey } from '../../ai/prompt-store';

const router = Router();

const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7 (most capable)' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (balanced)' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (fastest)' },
];

// GET /api/ai-settings — current settings (no raw key)
router.get('/', (_req, res) => {
  try {
    const settings = AISettingsRepository.get();
    const envFallback = settings.provider === 'none' ? {
      envProvider: process.env.AI_PROVIDER ?? 'none',
    } : {};
    res.json({ ...settings, ...envFallback });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/ai-settings — save settings
const SaveSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'ollama', 'none']),
  model: z.string().min(1).max(200),
  apiKey: z.string().optional(),
  clearKey: z.boolean().optional(),
  baseUrl: z.string().url().optional().or(z.literal('')),
});

router.put('/', (req, res) => {
  const parse = SaveSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }
  try {
    AISettingsRepository.save(parse.data);
    logger.info(`[ai-settings] saved provider=${parse.data.provider} model=${parse.data.model}`);
    res.json({ ok: true, settings: AISettingsRepository.get() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/ai-settings/models — autodiscover models
// query: provider=openai|anthropic|ollama, baseUrl=..., apiKey=... (all optional, falls back to saved settings)
router.get('/models', async (req, res) => {
  const { provider: qProvider, baseUrl: qBaseUrl, apiKey: qApiKey } = req.query as Record<string, string>;

  const config = getAIConfig();
  const provider = qProvider || config.provider;
  const baseUrl = qBaseUrl || config.baseUrl;
  const apiKey = qApiKey || config.apiKey || '';

  try {
    if (provider === 'anthropic') {
      res.json({ models: ANTHROPIC_MODELS.map(m => m.id) });
      return;
    }

    if (provider === 'ollama') {
      const ollamaBase = (baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '');
      const response = await axios.get<{ models: Array<{ name: string; size: number; modified_at: string }> }>(
        `${ollamaBase}/api/tags`,
        { timeout: 5000 }
      );
      const models = (response.data.models ?? []).map(m => m.name).sort();
      res.json({ models });
      return;
    }

    if (provider === 'openai') {
      const key = apiKey || process.env.OPENAI_API_KEY || '';
      if (!key) { res.json({ models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] }); return; }
      const client = new OpenAI({ apiKey: key });
      const list = await client.models.list();
      const chatModels = list.data
        .filter(m => m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3'))
        .map(m => m.id)
        .sort((a, b) => b.localeCompare(a)); // newest first
      res.json({ models: chatModels });
      return;
    }

    res.json({ models: [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to discover models';
    logger.warn(`[ai-settings] model discovery failed for ${provider}: ${msg}`);
    // Return sensible defaults on discovery failure
    const defaults: Record<string, string[]> = {
      openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
      anthropic: ANTHROPIC_MODELS.map(m => m.id),
      ollama: [],
    };
    res.json({ models: defaults[provider] ?? [], error: msg });
  }
});

// POST /api/ai-settings/test — test the current (or provided) config
router.post('/test', async (req, res) => {
  const config = getAIConfig();

  if (config.provider === 'none') {
    res.json({ ok: false, message: 'No AI provider configured. Save settings first.' });
    return;
  }

  try {
    if (config.provider === 'openai') {
      if (!config.apiKey) { res.json({ ok: false, message: 'No OpenAI API key configured' }); return; }
      const client = new OpenAI({ apiKey: config.apiKey });
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [{ role: 'user', content: 'Reply with just: ok' }],
        max_tokens: 5,
      });
      const reply = response.choices[0]?.message?.content ?? '';
      res.json({ ok: true, message: `Connected to OpenAI (${config.model}). Response: "${reply.trim()}"` });
      return;
    }

    if (config.provider === 'anthropic') {
      if (!config.apiKey) { res.json({ ok: false, message: 'No Anthropic API key configured' }); return; }
      const client = new Anthropic({ apiKey: config.apiKey });
      const response = await client.messages.create({
        model: config.model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Reply with just: ok' }],
      });
      const reply = response.content[0]?.type === 'text' ? response.content[0].text : '';
      res.json({ ok: true, message: `Connected to Anthropic (${config.model}). Response: "${reply.trim()}"` });
      return;
    }

    if (config.provider === 'ollama') {
      const ollamaBase = config.baseUrl.replace(/\/v1\/?$/, '');
      const r = await axios.get(`${ollamaBase}/api/tags`, { timeout: 5000 });
      const count = (r.data?.models ?? []).length;
      res.json({ ok: true, message: `Ollama reachable at ${ollamaBase}. ${count} model(s) available. Active: ${config.model}` });
      return;
    }

    res.json({ ok: false, message: `Unknown provider: ${config.provider}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    res.json({ ok: false, message: msg });
  }
});

// GET /api/ai-settings/prompts — list the 6 editable prompt files with their
// current content and resolved on-disk path (for display, so the user knows
// where to `git diff`/`git commit` on the host).
router.get('/prompts', (_req, res) => {
  try {
    res.json(listPrompts());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// PUT /api/ai-settings/prompts/:key — overwrite one prompt file's content.
// Change history is handled entirely by git on the host — no DB versioning.
const SavePromptSchema = z.object({
  content: z.string().max(50_000),
});

router.put('/prompts/:key', (req, res) => {
  const { key } = req.params;
  if (!isKnownPromptKey(key)) {
    res.status(404).json({ error: `Unknown prompt key: ${key}` });
    return;
  }

  const parse = SavePromptSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.flatten() });
    return;
  }

  try {
    savePrompt(key, parse.data.content);
    logger.info(`[ai-settings] saved prompt key=${key}`);
    const [descriptor] = listPrompts().filter((p) => p.key === key);
    res.json(descriptor);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;

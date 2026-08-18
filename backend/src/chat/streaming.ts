import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import { getAIConfig } from '../ai/config';
import { getGroundingInstructions } from '../ai/grounding';
import { getPrompt } from '../ai/prompt-store';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Builds the chat system prompt from the host-editable `chat-system` prompt
 * file, splicing in the shared grounding instructions at the `{{GROUNDING}}`
 * marker. Read fresh on every call (no module-level constant) so edits made
 * via the AI Settings "Prompts" tab take effect immediately. */
function buildSystemPrompt(): string {
  const grounding = getGroundingInstructions();
  // Function form avoids `$`-pattern interpolation in a user-edited grounding file.
  return getPrompt('chat-system').replace('{{GROUNDING}}', () => grounding);
}

async function* streamOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey });
  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    temperature: 0.3,
    max_tokens: 3072,
    stream: true,
  });
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) yield content;
  }
}

async function* streamAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey });
  const stream = await client.messages.create({
    model,
    max_tokens: 3072,
    system: systemPrompt,
    messages,
    stream: true,
  });
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

async function* streamOllama(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  // Ollama exposes an OpenAI-compatible /v1 endpoint
  const v1Base = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/v1`;
  const client = new OpenAI({ baseURL: v1Base, apiKey: 'ollama' });
  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    temperature: 0.3,
    max_tokens: 3072,
    stream: true,
  });
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) yield content;
  }
}

export async function streamChatResponse(
  context: string,
  messages: ChatMessage[],
  res: Response
): Promise<void> {
  const config = getAIConfig();

  if (config.provider === 'none') {
    res.write(`data: ${JSON.stringify({ type: 'error', content: 'No AI provider configured. Go to AI Settings to set up a provider.' })}\n\n`);
    res.write('data: [DONE]\n\n');
    return;
  }

  const systemPrompt = `${buildSystemPrompt()}\n\n=== CURRENT ORG DATA ===\n${context}`;
  const trimmedMessages = messages.slice(-20);

  let generator: AsyncGenerator<string>;

  try {
    if (config.provider === 'openai') {
      if (!config.apiKey) throw new Error('OpenAI API key not configured');
      generator = streamOpenAI(config.apiKey, config.model, systemPrompt, trimmedMessages);
    } else if (config.provider === 'anthropic') {
      if (!config.apiKey) throw new Error('Anthropic API key not configured');
      generator = streamAnthropic(config.apiKey, config.model, systemPrompt, trimmedMessages);
    } else if (config.provider === 'ollama') {
      generator = streamOllama(config.baseUrl || 'http://localhost:11434', config.model, systemPrompt, trimmedMessages);
    } else {
      throw new Error(`Unknown provider: ${config.provider}`);
    }

    for await (const token of generator) {
      res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stream error';
    res.write(`data: ${JSON.stringify({ type: 'error', content: msg })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
}

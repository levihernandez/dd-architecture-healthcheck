import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import { getAIConfig } from '../ai/config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are a senior Datadog Solutions Architect and FinOps expert embedded in the Datadog Architecture Health Check tool. You have direct access to real telemetry data collected from the Datadog API for this organization.

When an ORGANIZATION PROFILE is present in the context, use it to tailor every recommendation to the org's specific industry, tech stack, service tiers, compliance requirements, revenue sensitivity, and stated goals. A payment processor has very different priorities than a SaaS startup. A Tier 0 payment API with 99.99% uptime targets demands different synthetic monitoring, alerting, and log retention strategies than a Tier 2 internal portal.

Your mission:
1. Apply Datadog best practices for product configuration, tagging, and observability — calibrated to the org's industry and stack
2. Recommend tagging strategies aligned to the org's tech stack (K8s labels → DD tags, .NET service names, service tier tags)
3. Analyze and optimize log/APM/Synthetics/RUM indexing, sampling, and retention — with cost estimates grounded in actual volumes
4. Assess custom metric usage, quantify allotment vs on-demand risk, and identify top drivers
5. Evaluate host and container footprint against typical contract allotment tiers
6. Recommend Synthetics coverage aligned to the org's Tier 0/1 services and revenue-critical flows
7. Identify integration gaps based on the declared tech stack
8. Surface scalability risks given the declared growth trajectory and seasonality

Guidelines:
- Always connect technical recommendations to business outcomes (uptime targets, revenue impact, compliance requirements)
- Reference actual numbers from the org context — be specific (e.g. "17 of your 23 log indexes have no exclusion filters")
- Quantify impact wherever possible (e.g. "each browser test location removed saves ~X runs/month")
- Explain the Datadog billing model accurately: custom metrics, log indexing vs ingestion, trace ingestion vs indexing, Flex Logs, host allotment
- Structure every recommendation with: What to do → Why it matters → How to implement → When to prioritize → Where to apply it
- Use Datadog product names precisely: Flex Logs, Universal Service Catalog, Unified Service Tagging (UST), APM Trace Ingestion/Indexing, Intelligent Sampling, DogStatsD
- For cost estimates, give realistic ranges (e.g. "$0.10/GB for log ingestion, $1.70/million indexed logs at standard tier")
- For fleet/K8s recommendations, reference the actual node/pod counts when available
- Be conversational but precise — this is a working session, not a formal report
- Do not invent data — only reference metrics that appear in the org context block`;

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
    max_tokens: 2048,
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
    max_tokens: 2048,
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
    max_tokens: 2048,
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

  const systemPrompt = `${SYSTEM_PROMPT}\n\n=== CURRENT ORG DATA ===\n${context}`;
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

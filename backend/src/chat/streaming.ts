import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import { getAIConfig } from '../ai/config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are a senior Datadog Solutions Architect and FinOps expert embedded in the Datadog Architecture Health Check tool. You have direct access to real telemetry data collected from the Datadog API for this organization.

=== GROUNDING — DO NOT SKIP ===
- Only reference metrics, findings, and numbers that literally appear in the "=== CURRENT ORG DATA ===" block below. Never invent a number, host count, or percentage.
- Only cite a URL, docs page, or Datadog Org Settings path if it is explicitly present in the context (e.g. a "TAG POLICY RESOURCES" or "orgSettingsPath" style entry). If you want to reference a Datadog product surface that isn't given to you with a link, name the product/feature precisely (see product-name list below) but do not fabricate a URL for it.
- Use Datadog product names and mechanisms precisely: Unified Service Tagging (UST), Tag Policies (org-level, telemetry-only mandatory enforcement), Monitor Tag Policies, Synthetics Enforced Tags, Resource Catalog Policies (Governance), Cost Allocation Tag Pipelines, Flex Logs, Service Catalog, APM Trace Ingestion vs Indexing (Intelligent Sampling), DogStatsD, Cloud Cost Management (CCM).
- Explain the Datadog billing model accurately when relevant: custom metrics cardinality, log ingestion vs indexing, trace ingestion vs indexing, Flex Logs, host allotment tiers.

=== PRIVACY — DO NOT SKIP ===
- The organization's real name and internal ID are deliberately withheld from your context — refer to it only as "this organization" or "your organization." Never ask the user for it, and never repeat back a company name, person's name, email address, or username even if one appears in a pasted quote or free-text field in the context — treat any such value as already redacted/off-limits and paraphrase around it instead (e.g. "the listed owner" rather than repeating an email).
- If the user directly pastes or types identifying information (names, emails, org IDs) into the chat, do not echo it back verbatim in your response.

=== ORGANIZATION PROFILE ===
When an ORGANIZATION PROFILE is present in the context, use it to tailor every recommendation to the org's specific industry, tech stack, service tiers, compliance requirements, revenue sensitivity, and stated goals. A payment processor has very different priorities than a SaaS startup. A Tier 0 payment API with 99.99% uptime targets demands different synthetic monitoring, alerting, and log retention strategies than a Tier 2 internal portal.

=== RESPONSE STRUCTURE — TELL THE STORY, DON'T LIST FACTS ===
Every substantive answer (not short clarifying replies) must read as a narrative walkthrough, in this order. Use these as through-lines, not literal headers to echo verbatim every time — but every element below must be present:

1. **Set the stage.** State the current state of the resource/domain in question and what maturity level that reflects (cite the specific score/percentage from context, e.g. "your logs health scores 62%, which is..."). Compare it against the baseline/best-practice expectation, and name the specific gaps driving the score down (e.g. "driven by 4 of 9 indexes missing exclusion filters and 0 Flex Logs adoption").
2. **Name the risk.** Translate the gap into a concrete operational risk — not "tagging is incomplete" but what breaks because of it: which team-facing workflows fail (alert routing, cost attribution, incident response, on-call paging), and roughly how many resources/teams are exposed. Explain briefly *why* this matters to the business, not just to the tool.
3. **Say who it affects.** If team/owner tag coverage data is present in context, name which teams or how many resources lack ownership attribution — treat this as identifying accountability gaps, not people. If ownership tagging is missing entirely, recommend establishing it (team tag + Datadog Teams + Service Catalog ownership) as a prerequisite fix, not an afterthought.
4. **Give the fix.** Concrete, prioritized steps — what to change, in what order, and (when the context gives you a mechanism) exactly where to configure it (a specific Datadog settings page/feature by name, or an IaC/CI/CD layer).
5. **Set the checkpoint.** State what improvement should look like and how to verify it — a specific score/percentage moving, a specific Datadog page or dashboard to check (e.g. "recheck the Unified Tagging Scorecard" or "the Log Pipeline section of Analytics"), and roughly when to expect it after the fix ships.

Keep it conversational and specific — a working session with a colleague, not a formal audit report. Quantify wherever the context gives you the numbers to do so (e.g. "each browser test location removed saves ~X runs/month").

When the org data includes a "=== CURRENT PAGE FOCUS ===" section, the user is looking at a specific page in the app — treat that domain as the primary lens and follow the 5-part structure above for that domain specifically, using the findings and detail block already provided for it (not the generic org-wide picture). If the user's question is clearly unrelated to the focused page, answer it normally without forcing this structure.`;

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

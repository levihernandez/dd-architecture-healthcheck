import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../utils/logger';
import { getGroundingInstructions } from '../grounding';
import { getPrompt } from '../prompt-store';
import type { AIAssessmentResponse } from '../../types/assessment.types';

export async function runAnthropicAssessment(
  prompt: string,
  apiKey = process.env.ANTHROPIC_API_KEY ?? '',
  model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7'
): Promise<AIAssessmentResponse> {
  const client = new Anthropic({ apiKey });

  logger.info(`Running AI assessment with Anthropic (${model})`);

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.1,
    system: `${getGroundingInstructions()}\n\n${getPrompt('anthropic-system')}`,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected content type from Anthropic');

  // Strip potential markdown wrapping
  const text = content.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  return JSON.parse(text) as AIAssessmentResponse;
}

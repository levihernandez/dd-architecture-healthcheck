import OpenAI from 'openai';
import { logger } from '../../utils/logger';
import { getGroundingInstructions } from '../grounding';
import { getPrompt } from '../prompt-store';
import type { AIAssessmentResponse } from '../../types/assessment.types';

export async function runOllamaAssessment(
  prompt: string,
  baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  model = process.env.OLLAMA_MODEL ?? 'llama3.2'
): Promise<AIAssessmentResponse> {
  const baseURL = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/v1`;
  const client = new OpenAI({ baseURL, apiKey: 'ollama' });

  logger.info(`Running AI assessment with Ollama (${model}) at ${baseURL}`);

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `${getGroundingInstructions()}\n\n${getPrompt('ollama-system')}`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content in Ollama response');

  // Strip potential markdown wrapping that some models add despite instructions
  const text = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  return JSON.parse(text) as AIAssessmentResponse;
}

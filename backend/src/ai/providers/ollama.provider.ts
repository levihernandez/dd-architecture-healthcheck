import OpenAI from 'openai';
import { logger } from '../../utils/logger';
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
        content:
          'You are a Datadog Solutions Engineer expert. Respond only with valid JSON matching the requested schema. Do not include any text outside the JSON object. Do not use markdown code blocks.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content in Ollama response');

  // Strip potential markdown wrapping that some models add despite instructions
  const text = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  return JSON.parse(text) as AIAssessmentResponse;
}

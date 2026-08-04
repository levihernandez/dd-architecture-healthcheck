import OpenAI from 'openai';
import { logger } from '../../utils/logger';
import type { AIAssessmentResponse } from '../../types/assessment.types';

export async function runOpenAIAssessment(
  prompt: string,
  apiKey = process.env.OPENAI_API_KEY ?? '',
  model = process.env.OPENAI_MODEL ?? 'gpt-4o'
): Promise<AIAssessmentResponse> {
  const client = new OpenAI({ apiKey });

  logger.info(`Running AI assessment with OpenAI (${model})`);

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a Datadog Solutions Engineer expert. Respond only with valid JSON matching the requested schema. Do not include any text outside the JSON object.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI response');

  return JSON.parse(content) as AIAssessmentResponse;
}

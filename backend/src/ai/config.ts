import { AISettingsRepository } from './settings-repository';

export type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'none';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string | null;
  model: string;
  baseUrl: string;
}

const MODEL_DEFAULTS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-opus-4-7',
  ollama: 'llama3.2',
};

export function getAIConfig(): AIConfig {
  // DB settings take priority over env vars
  try {
    const settings = AISettingsRepository.get();
    if (settings.provider && settings.provider !== 'none') {
      const apiKey = AISettingsRepository.getDecryptedKey();
      return {
        provider: settings.provider as AIProvider,
        apiKey,
        model: settings.model ?? MODEL_DEFAULTS[settings.provider] ?? 'default',
        baseUrl: settings.baseUrl ?? (settings.provider === 'ollama' ? 'http://localhost:11434' : ''),
      };
    }
  } catch { /* DB not ready, fall through to env */ }

  // Env var fallback
  const provider = (process.env.AI_PROVIDER ?? 'none') as AIProvider;
  return {
    provider,
    apiKey: provider === 'openai' ? (process.env.OPENAI_API_KEY ?? null)
          : provider === 'anthropic' ? (process.env.ANTHROPIC_API_KEY ?? null)
          : null,
    model: provider === 'openai' ? (process.env.OPENAI_MODEL ?? 'gpt-4o')
          : provider === 'anthropic' ? (process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7')
          : provider === 'ollama' ? (process.env.OLLAMA_MODEL ?? 'llama3.2')
          : 'none',
    baseUrl: provider === 'ollama' ? (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434') : '',
  };
}

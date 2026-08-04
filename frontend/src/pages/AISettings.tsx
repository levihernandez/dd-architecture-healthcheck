import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { aiSettingsApi } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonText } from '../components/ui/Skeleton';

type Provider = 'openai' | 'anthropic' | 'ollama' | 'none';

const PROVIDERS: Array<{ id: Provider; label: string; icon: string; description: string; needsKey: boolean }> = [
  {
    id: 'openai',
    label: 'OpenAI',
    icon: '⬡',
    description: 'GPT-4o, GPT-4o-mini, and other OpenAI models. Best for structured JSON output.',
    needsKey: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    icon: '◆',
    description: 'Claude Opus, Sonnet, and Haiku. Best for nuanced analysis and long context.',
    needsKey: true,
  },
  {
    id: 'ollama',
    label: 'Ollama',
    icon: '🦙',
    description: 'Run models locally with no API key. Requires Ollama running on this machine.',
    needsKey: false,
  },
];

const ANTHROPIC_MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

export default function AISettings() {
  const qc = useQueryClient();

  const { data: saved, isLoading } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: aiSettingsApi.get,
  });

  const [provider, setProvider] = useState<Provider>('none');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  // Initialise form from saved settings
  useEffect(() => {
    if (!saved) return;
    const p = (saved.provider as Provider) || 'none';
    setProvider(p);
    setBaseUrl(saved.baseUrl || 'http://localhost:11434');
    setModel(saved.model || '');
    setApiKey('');   // never pre-fill raw key — show hint instead
    setDirty(false);
    setTestResult(null);
  }, [saved]);

  // Auto-discover models when switching to anthropic
  useEffect(() => {
    if (provider === 'anthropic') {
      setModels(ANTHROPIC_MODELS);
      if (!model || !ANTHROPIC_MODELS.includes(model)) setModel(ANTHROPIC_MODELS[0]);
    }
  }, [provider]);

  const discoverModels = useCallback(async () => {
    setDiscovering(true);
    setDiscoverError('');
    try {
      const params = new URLSearchParams({ provider });
      if (provider === 'ollama') params.set('baseUrl', baseUrl);
      if (provider === 'openai' && apiKey) params.set('apiKey', apiKey);
      const result = await aiSettingsApi.models(params.toString());
      setModels(result.models);
      if (result.models.length > 0 && !result.models.includes(model)) {
        setModel(result.models[0]);
      }
      if (result.error) setDiscoverError(result.error);
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  }, [provider, baseUrl, apiKey, model]);

  // Auto-discover when provider changes (except anthropic which is static)
  useEffect(() => {
    if (provider !== 'none' && provider !== 'anthropic') {
      discoverModels();
    }
  }, [provider]);

  const saveMutation = useMutation({
    mutationFn: aiSettingsApi.save,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-settings'] });
      setDirty(false);
      setApiKey('');
      setTestResult(null);
      toast.success('AI provider settings saved');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      provider,
      model,
      ...(apiKey ? { apiKey } : {}),
      ...(provider === 'ollama' ? { baseUrl } : {}),
    });
  };

  const handleTest = async () => {
    setTestResult(null);
    // Save first if dirty (failure is already toasted by the save mutation itself)
    if (dirty) {
      try {
        await saveMutation.mutateAsync({ provider, model, ...(apiKey ? { apiKey } : {}), ...(provider === 'ollama' ? { baseUrl } : {}) });
      } catch {
        return;
      }
    }
    try {
      const result = await aiSettingsApi.test();
      setTestResult(result);
      if (!result.ok) toast.error(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection test failed');
    }
  };

  const mark = () => setDirty(true);

  const activeEnvProvider = saved?.envProvider as string | undefined;
  const hasEnvFallback = !saved?.provider || saved.provider === 'none';

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-8">
        <PageHeader title="AI Provider Settings" subtitle="Configure the AI model used for chat, assessments, and recommendations." />
        <div className="card space-y-4">
          <SkeletonText lines={4} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader
        title="AI Provider Settings"
        subtitle="Configure the AI model used for chat, assessments, and recommendations. Settings are stored encrypted in the local database and override any .env values."
      />

      {hasEnvFallback && activeEnvProvider && activeEnvProvider !== 'none' && (
        <div className="card bg-amber-50 border-amber-200 text-sm text-amber-800 flex items-start gap-2 p-3">
          <span className="mt-0.5">⚠</span>
          <span>Currently using <strong>{activeEnvProvider}</strong> from <code className="text-xs bg-amber-100 px-1 rounded">.env</code>. Configure here to override.</span>
        </div>
      )}

      {/* Provider selector */}
      <section>
        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">Provider</h2>
        <div className="grid grid-cols-3 gap-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setProvider(p.id); mark(); setTestResult(null); }}
              className={`text-left p-4 rounded-xl border-2 transition-all ${
                provider === p.id
                  ? 'border-dd-purple bg-dd-purple/5'
                  : 'border-border bg-white hover:border-border-strong'
              }`}
            >
              <div className="text-2xl mb-2">{p.icon}</div>
              <div className={`font-semibold text-sm ${provider === p.id ? 'text-dd-purple-dark' : 'text-ink'}`}>{p.label}</div>
              <div className="text-xs text-ink-faint mt-1 leading-relaxed">{p.description}</div>
            </button>
          ))}
        </div>
      </section>

      {provider !== 'none' && (
        <>
          {/* API Key */}
          {PROVIDERS.find(p => p.id === provider)?.needsKey && (
            <section>
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">API Key</h2>
              <div className="space-y-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); mark(); }}
                  placeholder={saved?.hasKey && saved.provider === provider
                    ? `Current key: ${saved.keyHint} — enter new key to replace`
                    : `Enter your ${PROVIDERS.find(p => p.id === provider)?.label} API key`}
                  className="input w-full font-mono text-sm"
                />
                {saved?.hasKey && saved.provider === provider && !apiKey && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600">✓ Key saved</span>
                    <span className="text-xs text-ink-faint">{saved.keyHint}</span>
                    <button
                      onClick={() => { saveMutation.mutate({ provider, model, clearKey: true }); }}
                      className="text-xs text-red-500 hover:text-red-700 ml-auto"
                    >
                      Remove key
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Base URL (Ollama only) */}
          {provider === 'ollama' && (
            <section>
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">Ollama Base URL</h2>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => { setBaseUrl(e.target.value); mark(); }}
                placeholder="http://localhost:11434"
                className="input w-full font-mono text-sm"
              />
              <p className="text-xs text-ink-faint mt-1">
                The root URL of your Ollama instance — not the <code>/v1</code> endpoint. The app adds <code>/v1</code> for OpenAI-compatible calls and <code>/api/tags</code> for model discovery automatically.
              </p>
            </section>
          )}

          {/* Model selector */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Model</h2>
              {provider !== 'anthropic' && (
                <button
                  onClick={discoverModels}
                  disabled={discovering}
                  className="text-xs text-dd-purple hover:text-dd-purple-dark disabled:opacity-50 flex items-center gap-1"
                >
                  {discovering ? (
                    <span className="animate-spin">↻</span>
                  ) : '↻'}
                  {discovering ? 'Discovering…' : 'Refresh models'}
                </button>
              )}
            </div>

            {discoverError && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
                {discoverError}
              </div>
            )}

            {models.length > 0 ? (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {models.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setModel(m); mark(); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                      model === m
                        ? 'border-dd-purple bg-dd-purple/5 text-dd-purple-dark font-medium'
                        : 'border-border bg-white text-ink-muted hover:bg-surface-subtle'
                    }`}
                  >
                    <span className="font-mono">{m}</span>
                    {model === m && <span className="ml-2 text-xs text-dd-purple">selected</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex gap-3 items-center">
                <input
                  type="text"
                  value={model}
                  onChange={(e) => { setModel(e.target.value); mark(); }}
                  placeholder={provider === 'openai' ? 'gpt-4o' : provider === 'ollama' ? 'llama3.2' : 'model name'}
                  className="input flex-1 font-mono text-sm"
                />
                {discovering && <span className="text-xs text-ink-faint animate-pulse">Discovering…</span>}
              </div>
            )}
          </section>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending || !model}
              className="btn-primary disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
            </button>
            <button
              onClick={handleTest}
              disabled={saveMutation.isPending}
              className="btn-secondary"
            >
              Test Connection
            </button>
            {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
            {saveMutation.isSuccess && !dirty && <span className="text-xs text-green-600">✓ Saved</span>}
            {saveMutation.isError && (
              <span className="text-xs text-red-600">
                {saveMutation.error instanceof Error ? saveMutation.error.message : 'Save failed'}
              </span>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`rounded-lg px-4 py-3 text-sm ${
              testResult.ok
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              <span className="font-medium mr-1">{testResult.ok ? '✓' : '✗'}</span>
              {testResult.message}
            </div>
          )}
        </>
      )}

      {/* Current status card */}
      {saved && saved.provider !== 'none' && (
        <div className="card bg-surface-subtle border-border">
          <div className="text-xs font-semibold text-ink-faint uppercase tracking-wide mb-2">Active Configuration</div>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="text-ink-faint">Provider</span>
              <code className="bg-dd-purple/10 text-dd-purple-dark px-1.5 py-0.5 rounded text-xs font-mono">{saved.provider}</code>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-ink-faint">Model</span>
              <code className="bg-surface-sunken text-ink-muted px-1.5 py-0.5 rounded text-xs font-mono">{saved.model || '—'}</code>
            </span>
            {saved.provider === 'ollama' && saved.baseUrl && (
              <span className="flex items-center gap-1.5">
                <span className="text-ink-faint">URL</span>
                <code className="bg-surface-sunken text-ink-muted px-1.5 py-0.5 rounded text-xs font-mono">{saved.baseUrl}</code>
              </span>
            )}
            {saved.hasKey && <span className="text-green-600 text-xs">✓ API key saved</span>}
            {saved.updatedAt && (
              <span className="text-ink-faint text-xs ml-auto">
                Updated {new Date(saved.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

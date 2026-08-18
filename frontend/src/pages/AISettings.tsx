import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { aiSettingsApi } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonText } from '../components/ui/Skeleton';
import SectionGate from '../components/SectionGate';

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

  const { data: prompts, isLoading: promptsLoading } = useQuery({
    queryKey: ['ai-prompts'],
    queryFn: aiSettingsApi.getPrompts,
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

  const [selectedPromptKey, setSelectedPromptKey] = useState<string>('');
  const [promptContent, setPromptContent] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);

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

  // Default to the first prompt once the list loads, and load its content
  // into the textarea whenever the selection changes.
  useEffect(() => {
    if (!prompts || prompts.length === 0) return;
    if (!selectedPromptKey || !prompts.some((p) => p.key === selectedPromptKey)) {
      setSelectedPromptKey(prompts[0].key);
      return;
    }
    const current = prompts.find((p) => p.key === selectedPromptKey);
    if (current) {
      setPromptContent(current.content);
      setPromptDirty(false);
    }
  }, [prompts, selectedPromptKey]);

  const selectedPrompt = prompts?.find((p) => p.key === selectedPromptKey);

  const savePromptMutation = useMutation({
    mutationFn: ({ key, content }: { key: string; content: string }) => aiSettingsApi.savePrompt(key, content),
    onSuccess: (updated) => {
      qc.setQueryData(['ai-prompts'], (old: typeof prompts) =>
        old?.map((p) => (p.key === updated.key ? updated : p))
      );
      setPromptDirty(false);
      toast.success(`${updated.label} saved`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save prompt');
    },
  });

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
        <div className="card bg-amber-500/10 border-amber-500/30 text-sm text-amber-400 flex items-start gap-2 p-3">
          <span className="mt-0.5">⚠</span>
          <span>Currently using <strong>{activeEnvProvider}</strong> from <code className="text-xs bg-amber-500/15 px-1 rounded">.env</code>. Configure here to override.</span>
        </div>
      )}

      {/* Provider selector */}
      <SectionGate featureKey="section.ai_settings.provider_config">
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
                  : 'border-border bg-surface-subtle hover:border-border-strong'
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
                    <span className="text-xs text-green-400">✓ Key saved</span>
                    <span className="text-xs text-ink-faint">{saved.keyHint}</span>
                    <button
                      onClick={() => { saveMutation.mutate({ provider, model, clearKey: true }); }}
                      className="text-xs text-red-500 hover:text-red-400 ml-auto"
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
              <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1 mb-2">
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
                        : 'border-border bg-surface-subtle text-ink-muted hover:bg-surface-subtle'
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
            {dirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
            {saveMutation.isSuccess && !dirty && <span className="text-xs text-green-400">✓ Saved</span>}
            {saveMutation.isError && (
              <span className="text-xs text-red-400">
                {saveMutation.error instanceof Error ? saveMutation.error.message : 'Save failed'}
              </span>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`rounded-lg px-4 py-3 text-sm ${
              testResult.ok
                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              <span className="font-medium mr-1">{testResult.ok ? '✓' : '✗'}</span>
              {testResult.message}
            </div>
          )}
        </>
      )}
      </SectionGate>

      {/* Current status card */}
      {saved && saved.provider !== 'none' && (
        <SectionGate featureKey="section.ai_settings.status">
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
            {saved.hasKey && <span className="text-green-400 text-xs">✓ API key saved</span>}
            {saved.updatedAt && (
              <span className="text-ink-faint text-xs ml-auto">
                Updated {new Date(saved.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        </SectionGate>
      )}

      {/* Prompts */}
      <SectionGate featureKey="section.ai_settings.prompts">
      <section>
        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">Prompts</h2>
        <p className="text-xs text-ink-faint mb-3">
          Edit the raw prompt text used for chat, assessments, and each provider's system message. Every surface
          composes the shared grounding instructions with these files at call time — no restart needed.
        </p>
        {promptsLoading ? (
          <div className="card space-y-4">
            <SkeletonText lines={4} />
          </div>
        ) : (
          <div className="card space-y-3">
            <div className="flex flex-wrap gap-2">
              {(prompts ?? []).map((p) => (
                <button
                  key={p.key}
                  onClick={() => setSelectedPromptKey(p.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selectedPromptKey === p.key
                      ? 'border-dd-purple bg-dd-purple/5 text-dd-purple-dark'
                      : 'border-border bg-surface-subtle text-ink-muted hover:border-border-strong'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <textarea
              value={promptContent}
              onChange={(e) => { setPromptContent(e.target.value); setPromptDirty(true); }}
              rows={20}
              spellCheck={false}
              className="input font-mono text-xs w-full"
            />

            <div className="flex items-center gap-3">
              <button
                onClick={() => selectedPromptKey && savePromptMutation.mutate({ key: selectedPromptKey, content: promptContent })}
                disabled={savePromptMutation.isPending || !promptDirty || !selectedPromptKey}
                className="btn-primary disabled:opacity-50"
              >
                {savePromptMutation.isPending ? 'Saving…' : 'Save Prompt'}
              </button>
              {promptDirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
              {!promptDirty && savePromptMutation.isSuccess && <span className="text-xs text-green-400">✓ Saved</span>}
            </div>

            {selectedPrompt && (
              <p className="text-xs text-ink-faint">
                Changes are saved to this file on the server: <code className="bg-surface-sunken px-1 py-0.5 rounded">{selectedPrompt.filePath}</code>.
                Use git to track and review history.
              </p>
            )}
          </div>
        )}
      </section>
      </SectionGate>
    </div>
  );
}

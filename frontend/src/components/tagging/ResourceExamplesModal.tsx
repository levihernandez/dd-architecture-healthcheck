import { useState } from 'react';
import type { ResourceExample } from '../../types';

const RESOURCE_LABEL: Record<ResourceExample['resource'], string> = {
  rum: 'RUM',
  logs: 'Logs',
  apm: 'APM',
  agent: 'Agent',
  integrations: 'Integrations',
};

const RESOURCE_ORDER: ResourceExample['resource'][] = ['rum', 'logs', 'apm', 'agent', 'integrations'];

export default function ResourceExamplesModal({
  tagKey, examples, onClose,
}: {
  tagKey: string;
  examples: ResourceExample[] | undefined;
  onClose: () => void;
}) {
  const ordered = RESOURCE_ORDER.map((r) => examples?.find((e) => e.resource === r)).filter(
    (e): e is ResourceExample => Boolean(e)
  );
  const [active, setActive] = useState<ResourceExample['resource']>(ordered[0]?.resource ?? 'rum');
  const activeExample = ordered.find((e) => e.resource === active);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-surface-subtle rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-ink">Resource examples</h2>
              <code className="text-xs font-mono text-violet-400">{tagKey}</code>
            </div>
            <button onClick={onClose} className="btn-ghost text-xs">✕ Close</button>
          </div>

          {ordered.length === 0 ? (
            <div className="card text-center text-ink-faint py-10 text-sm">
              No resource-specific examples yet for this tag.
            </div>
          ) : (
            <>
              <div className="flex gap-1 border-b border-border mb-4">
                {ordered.map((e) => (
                  <button
                    key={e.resource}
                    onClick={() => setActive(e.resource)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
                      active === e.resource
                        ? 'bg-surface text-violet-400 border border-b-0 border-border'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {RESOURCE_LABEL[e.resource]}
                  </button>
                ))}
              </div>

              {activeExample && (
                <div className="space-y-2">
                  <pre className="bg-surface-sunken border border-border rounded-lg p-3 text-xs font-mono text-ink overflow-x-auto whitespace-pre-wrap break-words">
                    {activeExample.example}
                  </pre>
                  {activeExample.description && (
                    <p className="text-xs text-ink-muted">{activeExample.description}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

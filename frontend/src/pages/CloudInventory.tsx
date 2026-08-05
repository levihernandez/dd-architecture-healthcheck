import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards, SkeletonCard } from '../components/ui/Skeleton';

const PROVIDER_META: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  aws:        { label: 'Amazon Web Services', color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/30', icon: '☁' },
  gcp:        { label: 'Google Cloud Platform', color: 'text-blue-400', bg: 'bg-blue-500/10',   border: 'border-blue-500/30',  icon: '⛅' },
  azure:      { label: 'Microsoft Azure',      color: 'text-cyan-400',  bg: 'bg-cyan-500/10',   border: 'border-cyan-500/30',  icon: '🌤' },
  kubernetes: { label: 'Kubernetes',           color: 'text-violet-400',bg: 'bg-violet-500/10', border: 'border-violet-500/30',icon: '⎈' },
  docker:     { label: 'Docker',               color: 'text-sky-400',   bg: 'bg-sky-500/10',    border: 'border-sky-500/30',   icon: '🐳' },
};

const fallback = { label: 'Unknown', color: 'text-ink-muted', bg: 'bg-surface-subtle', border: 'border-border', icon: '☁' };

function ProviderBadge({ provider }: { provider: string }) {
  const m = PROVIDER_META[provider] ?? fallback;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${m.bg} ${m.color} ${m.border}`}>
      {m.icon} {provider.toUpperCase()}
    </span>
  );
}

function StatCard({ label, value, sub, color = 'gray' }: {
  label: string; value: string | number; sub?: string; color?: 'gray' | 'green' | 'amber' | 'red' | 'violet';
}) {
  const colors = {
    gray:   'bg-surface-subtle border-border text-ink',
    green:  'bg-green-500/10 border-green-500/30 text-green-400',
    amber:  'bg-amber-500/10 border-amber-500/30 text-amber-400',
    red:    'bg-red-500/10 border-red-500/30 text-red-400',
    violet: 'bg-violet-500/10 border-violet-500/30 text-violet-400',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export default function CloudInventory() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [tagSearch, setTagSearch] = useState('');

  const enabled = Boolean(selectedOrgId && selectedScanId);
  const { data, isLoading, error } = useQuery({
    queryKey: ['cloud-inventory', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.cloud(selectedOrgId, selectedScanId),
    enabled,
    retry: false,
  });

  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader
        title="Cloud Inventory"
        subtitle="Cloud account connections, provider-sourced tags on hosts, and alignment with Datadog standard keys"
      />

      {!selectedScanId ? (
        <EmptyState message="Run a scan to view cloud inventory" />
      ) : isLoading ? (
        <div className="space-y-6">
          <SkeletonCards count={4} />
          <SkeletonCard />
        </div>
      ) : error || !data ? (
        <EmptyState message="No cloud data found for this scan" />
      ) : (
        <>
          {data.usingFallback && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-amber-400">
              <strong>Note:</strong> Tag sources extracted from host raw data (pre-fix scan). Run a new scan to get per-source tag tracking in the database.
            </div>
          )}

          {/* ── Summary stats ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              label="Cloud Accounts"
              value={data.accounts.length}
              sub={data.detectedProviders.join(' · ').toUpperCase() || 'none configured'}
              color={data.accounts.length > 0 ? 'violet' : 'gray'}
            />
            <StatCard
              label="Providers Detected"
              value={data.detectedProviders.length}
              sub="from host tags_by_source"
              color={data.detectedProviders.length > 0 ? 'green' : 'amber'}
            />
            <StatCard
              label="Hosts with Cloud Tags"
              value={data.hostsWithCloudTags}
              sub={`of ${data.totalHosts} total hosts (${data.totalHosts > 0 ? Math.round(data.hostsWithCloudTags / data.totalHosts * 100) : 0}%)`}
              color={data.hostsWithCloudTags > 0 ? 'green' : 'amber'}
            />
            <StatCard
              label="Unique Cloud Tag Keys"
              value={Object.values(data.keysBySource).flat().length}
              sub={`across ${data.detectedProviders.length} provider(s)`}
              color="gray"
            />
          </div>

          {/* ── Cloud Cost Management ──────────────────────────────────────── */}
          {data.costManagement.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-ink mb-3">Cloud Cost Management</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {data.costManagement.map((cm) => {
                  const m = PROVIDER_META[cm.provider] ?? fallback;
                  return (
                    <div key={cm.provider} className={`rounded-xl border ${m.border} ${m.bg} p-4 flex items-center justify-between`}>
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{m.icon}</span>
                        <div>
                          <div className={`text-sm font-bold ${m.color}`}>{m.label}</div>
                          <div className="text-xs text-ink-muted mt-0.5">{cm.accountCount} account(s)</div>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                        cm.configured ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-surface-sunken border-border text-ink-muted'
                      }`}>
                        {cm.configured ? '✓ CCM Enabled' : 'CCM Not Configured'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Cloud Accounts ─────────────────────────────────────────────── */}
          <section>
            <h2 className="text-lg font-bold text-ink mb-3">Cloud Account Connections</h2>
            {data.accounts.length === 0 ? (
              <div className="card text-center py-8 text-ink-faint">
                <div className="text-3xl mb-2">☁</div>
                <div className="text-sm">No cloud integrations configured</div>
                <div className="text-xs mt-1">Configure AWS, GCP, or Azure integrations in Datadog to see account details here.</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {data.accounts.map((acc, i) => {
                  const m = PROVIDER_META[acc.provider] ?? fallback;
                  return (
                    <div key={i} className={`rounded-xl border ${m.border} ${m.bg} p-4`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{m.icon}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold ${m.color}`}>{acc.accountName ?? acc.accountId ?? acc.provider}</span>
                              <ProviderBadge provider={acc.provider} />
                            </div>
                            {acc.accountId && acc.accountId !== acc.accountName && (
                              <div className="text-xs text-ink-muted font-mono mt-0.5">{acc.accountId}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                            acc.hasErrors ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-green-500/10 border-green-500/30 text-green-400'
                          }`}>
                            {acc.hasErrors ? '⚠ Errors' : '✓ OK'}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                            acc.metricsEnabled ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-surface-sunken border-border text-ink-muted'
                          }`}>
                            {acc.metricsEnabled ? 'Metrics ✓' : 'Metrics ✗'}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                            acc.resourceCollectionEnabled ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-surface-sunken border-border text-ink-muted'
                          }`}>
                            {acc.resourceCollectionEnabled ? 'Resource Coll. ✓' : 'Resource Coll. ✗'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── DD Key Alignment ───────────────────────────────────────────── */}
          {data.mappingGaps.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-ink mb-1">Cloud Tag → Datadog Key Alignment</h2>
              <p className="text-sm text-ink-muted mb-3">
                Whether standard Datadog tag keys are present as cloud provider tag keys on your hosts.
                Missing keys mean cloud metadata isn't propagating to DD observability surfaces.
              </p>
              <div className="grid grid-cols-3 gap-3">
                {data.mappingGaps.map(gap => (
                  <div key={gap.ddKey} className={`rounded-xl border p-4 ${
                    gap.found ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <code className={`text-sm font-bold font-mono ${gap.found ? 'text-green-400' : 'text-red-400'}`}>
                        {gap.ddKey}
                      </code>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        gap.found ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                      }`}>
                        {gap.found ? '✓ Found' : '✗ Missing'}
                      </span>
                    </div>
                    <div className="text-xs text-ink-muted">
                      Cloud variants: {gap.cloudVariants.slice(0, 4).map(v => (
                        <code key={v} className="bg-surface-subtle border border-border px-1 rounded mr-1">{v}</code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Tags by Provider ───────────────────────────────────────────── */}
          {data.detectedProviders.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-lg font-bold text-ink">Cloud-Sourced Tag Inventory</h2>
                  <p className="text-sm text-ink-muted mt-0.5">
                    Tags discovered on hosts grouped by the cloud provider that applied them
                  </p>
                </div>
                <input
                  type="text"
                  placeholder="Filter tag keys…"
                  className="input w-44 text-sm"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                />
              </div>

              {/* Provider tabs */}
              <div className="flex gap-1 mb-4 border-b border-border">
                <button
                  onClick={() => setActiveProvider(null)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeProvider === null ? 'border-violet-600 text-violet-400' : 'border-transparent text-ink-muted hover:text-ink-muted'
                  }`}
                >
                  All providers
                </button>
                {data.detectedProviders.map(p => {
                  const m = PROVIDER_META[p] ?? fallback;
                  return (
                    <button
                      key={p}
                      onClick={() => setActiveProvider(p === activeProvider ? null : p)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
                        activeProvider === p ? 'border-violet-600 text-violet-400' : 'border-transparent text-ink-muted hover:text-ink-muted'
                      }`}
                    >
                      {m.icon} {p.toUpperCase()}
                      <span className="text-xs bg-surface-sunken text-ink-muted px-1.5 py-0.5 rounded-full">
                        {(data.keysBySource[p] ?? []).length}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Tag tables per provider */}
              <div className="space-y-5">
                {(activeProvider ? [activeProvider] : data.detectedProviders).map(provider => {
                  const m = PROVIDER_META[provider] ?? fallback;
                  const rows = (data.tagsBySource[provider] ?? [])
                    .filter(r => !tagSearch || r.key.toLowerCase().includes(tagSearch.toLowerCase()) || r.value.toLowerCase().includes(tagSearch.toLowerCase()));

                  // Group by key
                  const byKey: Record<string, Array<{ value: string; hostCount: number }>> = {};
                  for (const r of rows) {
                    if (!byKey[r.key]) byKey[r.key] = [];
                    byKey[r.key].push({ value: r.value, hostCount: r.hostCount });
                  }
                  const keys = Object.keys(byKey).sort();

                  return (
                    <div key={provider} className={`rounded-xl border ${m.border} overflow-hidden`}>
                      <div className={`px-4 py-3 ${m.bg} flex items-center justify-between`}>
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{m.icon}</span>
                          <span className={`font-semibold ${m.color}`}>{m.label}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${m.border} ${m.color} bg-surface-subtle/60`}>
                            {keys.length} tag keys · {rows.length} values
                          </span>
                        </div>
                        <div className="text-xs text-ink-muted">
                          {data.hostsWithCloudTags} hosts tagged
                        </div>
                      </div>

                      {keys.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-ink-faint">
                          {tagSearch ? 'No tags match the filter' : 'No tags detected from this provider'}
                        </div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-surface-subtle text-xs text-ink-muted uppercase tracking-wide">
                              <th className="text-left px-4 py-2 w-1/3">Tag Key</th>
                              <th className="text-left px-4 py-2">Values (top per key)</th>
                              <th className="text-right px-4 py-2 w-24">Unique Values</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {keys.map(key => {
                              const vals = byKey[key].sort((a, b) => b.hostCount - a.hostCount);
                              return (
                                <tr key={key} className="hover:bg-surface-subtle/50 transition-colors">
                                  <td className="px-4 py-2.5">
                                    <code className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded border ${m.bg} ${m.border} ${m.color}`}>
                                      {key}
                                    </code>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <div className="flex flex-wrap gap-1">
                                      {vals.slice(0, 6).map(({ value, hostCount }) => (
                                        <span key={value} className="inline-flex items-center gap-1 text-xs bg-surface-sunken text-ink-muted border border-border px-1.5 py-0.5 rounded">
                                          {value}
                                          <span className="text-ink-faint text-[10px]">{hostCount}</span>
                                        </span>
                                      ))}
                                      {vals.length > 6 && (
                                        <span className="text-xs text-ink-faint">+{vals.length - 6} more</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{vals.length}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── No cloud tags guidance ─────────────────────────────────────── */}
          {data.detectedProviders.length === 0 && (
            <section className="card text-center py-10 space-y-3">
              <div className="text-4xl">☁</div>
              <div className="text-base font-semibold text-ink-muted">No cloud provider tags detected on hosts</div>
              <div className="text-sm text-ink-muted max-w-lg mx-auto">
                Cloud provider tags are applied to hosts when the Datadog Agent runs on cloud instances and the
                cloud integration is configured. Check that your AWS/GCP/Azure integration is enabled in Datadog
                and that the Agent has permission to read instance metadata.
              </div>
              <div className="text-xs text-ink-faint bg-surface-subtle border border-border rounded-lg p-4 max-w-lg mx-auto text-left space-y-1">
                <div className="font-semibold text-ink-muted mb-2">What to check:</div>
                <div>• AWS: Enable "Collect tags" in the AWS integration tile</div>
                <div>• GCP: Grant the Agent's service account <code>compute.instanceAdmin.v1</code> read access</div>
                <div>• Azure: Enable "Resource group level" tag collection in Azure integration</div>
                <div>• Verify the Agent has <code>EC2DescribeInstances</code> or equivalent permissions</div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

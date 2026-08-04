import { useQuery } from '@tanstack/react-query';
import { scansApi, analyticsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl, ddUrl } from '../utils/ddUrl';
import EvidenceTable from '../components/common/EvidenceTable';
import MetricCard from '../components/common/MetricCard';
import LoadingState, { EmptyState } from '../components/common/LoadingState';

function DDLink({ href, label = 'Open in Datadog' }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium shrink-0">
      {label} ↗
    </a>
  );
}

function SideEffectBanner({ severity, title, detail, href, hrefLabel }: {
  severity: 'critical' | 'warning' | 'info';
  title: string; detail: string; href?: string; hrefLabel?: string;
}) {
  const styles = {
    critical: 'bg-red-50 border-red-200 text-red-900',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    info: 'bg-blue-50 border-blue-200 text-blue-900',
  };
  const icons = { critical: '🔴', warning: '⚠️', info: 'ℹ️' };
  return (
    <div className={`rounded-lg border p-3 flex items-start gap-3 ${styles[severity]}`}>
      <span className="text-base mt-0.5">{icons[severity]}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs mt-0.5 opacity-80">{detail}</div>
      </div>
      {href && <DDLink href={href} label={hrefLabel ?? 'Investigate'} />}
    </div>
  );
}

export default function LogsHealth() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['findings', selectedScanId, 'logs_health'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'logs_health' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: analytics } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  if (isLoading) return <LoadingState />;

  const logs = analytics?.logs;
  const indexDetails = logs?.indexDetails ?? [];
  const noExclusionFilters = indexDetails.filter(i => !i.isFlex && i.exclusionFilters === 0);
  const rateLimited = indexDetails.filter(i => i.isRateLimited);
  const noDailyLimit = indexDetails.filter(i => !i.isFlex && !i.dailyLimitEvents);
  const flexIndexes = indexDetails.filter(i => i.isFlex);
  const regularIndexes = indexDetails.filter(i => !i.isFlex);

  const retDist = logs?.retentionDistribution ?? {};
  const retEntries = Object.entries(retDist).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  const totalIndexedByRetention = retEntries.reduce((s, [, n]) => s + n, 0);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Logs Health</h1>
          <p className="text-gray-500 text-sm mt-1">Index coverage, pipeline hygiene, retention strategy, and cost exposure</p>
        </div>
        <DDLink href={ddUrl.logsIndexes(base)} label="Manage Indexes" />
      </div>

      {!selectedScanId ? <EmptyState message="Run a scan to see logs health data" /> : (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="col-span-1">
              <MetricCard label="Log Indexes" value={logs?.totalIndexes ?? 0} icon="📋"
                subtitle={`${flexIndexes.length} Flex, ${regularIndexes.length} Online`} />
            </div>
            <div className="col-span-1">
              <MetricCard label="Pipelines" value={logs?.pipelines ?? 0} icon="⚙"
                subtitle={`${logs?.enabledPipelines ?? 0} enabled`}
                color={(logs?.enabledPipelines ?? 0) === 0 ? 'red' : 'default'} />
            </div>
            <div className="col-span-1">
              <MetricCard label="Exclusion Filters" value={logs?.totalExclusionFilters ?? 0} icon="🔽"
                subtitle={noExclusionFilters.length > 0 ? `${noExclusionFilters.length} idx with none` : 'all indexes covered'}
                color={noExclusionFilters.length > 0 ? 'amber' : 'green'} />
            </div>
            <div className="col-span-1">
              <MetricCard label="Rate Limited" value={rateLimited.length} icon="🚦"
                subtitle={rateLimited.length > 0 ? 'hitting daily cap' : 'none hitting cap'}
                color={rateLimited.length > 0 ? 'red' : 'green'} />
            </div>
            <div className="col-span-1">
              <MetricCard label="Flex Logs" value={flexIndexes.length} icon="❄"
                subtitle={flexIndexes.length > 0 ? 'warm-tier active' : 'not configured'}
                color={flexIndexes.length > 0 ? 'green' : 'default'} />
            </div>
          </div>

          {/* Side-effect banners */}
          {(noExclusionFilters.length > 0 || rateLimited.length > 0 || noDailyLimit.length > 0) && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Active Risk Signals</h2>
              {rateLimited.map(idx => (
                <SideEffectBanner key={idx.name}
                  severity="critical"
                  title={`Index "${idx.name}" is rate limited`}
                  detail={`Daily cap of ${idx.dailyLimitEvents?.toLocaleString() ?? '?'} events reached — logs are being dropped. Increase limit or add exclusion filters.`}
                  href={ddUrl.logIndex(base, idx.name)}
                  hrefLabel="View index logs" />
              ))}
              {noExclusionFilters.length > 0 && (
                <SideEffectBanner
                  severity="warning"
                  title={`${noExclusionFilters.length} online ${noExclusionFilters.length === 1 ? 'index' : 'indexes'} have no exclusion filters`}
                  detail={`Indexes: ${noExclusionFilters.slice(0, 5).map(i => i.name).join(', ')}${noExclusionFilters.length > 5 ? ` +${noExclusionFilters.length - 5} more` : ''}. No filters means all ingested logs are indexed — likely causing over-indexing and unnecessary cost.`}
                  href={ddUrl.logsIndexes(base)}
                  hrefLabel="Add exclusion filters" />
              )}
              {noDailyLimit.length > 0 && (
                <SideEffectBanner
                  severity="warning"
                  title={`${noDailyLimit.length} online ${noDailyLimit.length === 1 ? 'index has' : 'indexes have'} no daily limit`}
                  detail={`Without a daily cap, a log spike can cause unbounded on-demand charges. Affected: ${noDailyLimit.slice(0, 4).map(i => i.name).join(', ')}${noDailyLimit.length > 4 ? ` +${noDailyLimit.length - 4}` : ''}.`}
                  href={ddUrl.logsIndexes(base)}
                  hrefLabel="Set daily limits" />
              )}
            </div>
          )}

          {/* Findings */}
          {findings.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Logs Findings ({findings.length})</h2>
              <EvidenceTable findings={findings} />
            </div>
          )}

          {/* Index breakdown table */}
          {indexDetails.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">Index Breakdown ({indexDetails.length})</h2>
                <DDLink href={ddUrl.logsIndexes(base)} label="Manage all" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Index</th>
                      <th className="text-center px-3 py-2">Type</th>
                      <th className="text-right px-3 py-2">Retention</th>
                      <th className="text-right px-3 py-2">Daily Limit</th>
                      <th className="text-right px-3 py-2">Excl. Filters</th>
                      <th className="text-center px-3 py-2">Status</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {indexDetails.map((idx) => (
                      <tr key={idx.name} className={`bg-white hover:bg-violet-50/20 ${idx.isRateLimited ? 'bg-red-50/40' : ''}`}>
                        <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-900 max-w-[160px] truncate" title={idx.name}>{idx.name}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${idx.isFlex ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                            {idx.isFlex ? 'Flex' : 'Online'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs">
                          {idx.retentionDays ? `${idx.retentionDays}d` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs">
                          {idx.dailyLimitEvents
                            ? (idx.dailyLimitEvents >= 1e9 ? `${(idx.dailyLimitEvents / 1e9).toFixed(1)}B` : idx.dailyLimitEvents >= 1e6 ? `${(idx.dailyLimitEvents / 1e6).toFixed(0)}M` : idx.dailyLimitEvents.toLocaleString())
                            : <span className="text-amber-500">∞ No limit</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`text-xs font-medium ${idx.exclusionFilters === 0 && !idx.isFlex ? 'text-amber-600' : 'text-green-600'}`}>
                            {idx.exclusionFilters === 0 && !idx.isFlex ? '⚠ None' : idx.exclusionFilters}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {idx.isRateLimited
                            ? <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-bold">RATE LIMITED</span>
                            : <span className="text-green-600 text-xs">✓</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <DDLink href={ddUrl.logIndex(base, idx.name)} label="View" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Retention distribution */}
          {retEntries.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">Retention Distribution</h2>
                <DDLink href={ddUrl.logsIndexes(base)} label="Edit retentions" />
              </div>
              <div className="space-y-2">
                {retEntries.map(([days, count]) => {
                  const pct = totalIndexedByRetention > 0 ? Math.round((count / totalIndexedByRetention) * 100) : 0;
                  return (
                    <div key={days} className="flex items-center gap-3">
                      <span className="w-12 text-right text-xs text-gray-500 font-mono">{days}d</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div className="h-full bg-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-16 text-xs text-gray-600 font-medium">{count} index{count > 1 ? 'es' : ''} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
              {retEntries.some(([days]) => parseInt(days) > 30) && (
                <p className="text-xs text-amber-600 mt-2 pt-2 border-t border-gray-100">
                  ⚠ Indexes with &gt;30 day retention have elevated storage costs. Consider Flex Logs for infrequently accessed data.
                </p>
              )}
            </div>
          )}

          {/* Quick investigation links */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Investigate in Datadog</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {[
                { label: 'All logs (Live Tail)', href: ddUrl.logs(base) },
                { label: 'Logs without service tag', href: ddUrl.logsQuery(base, '-service:*') },
                { label: 'Logs without env tag', href: ddUrl.logsQuery(base, '-env:*') },
                { label: 'Error logs (last 15m)', href: ddUrl.logsQuery(base, 'status:error') },
                { label: 'All pipelines', href: ddUrl.logsPipelines(base) },
                { label: 'Log archives', href: ddUrl.logsArchives(base) },
              ].map(({ label, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200 hover:border-violet-300 hover:bg-violet-50/30 transition-colors group">
                  <span className="text-sm text-gray-700 group-hover:text-violet-700">{label}</span>
                  <span className="text-gray-300 group-hover:text-violet-500">↗</span>
                </a>
              ))}
            </div>
          </div>

          {/* Best practices */}
          {findings.length === 0 && (
            <div className="card bg-green-50 border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-green-600 text-xl">✓</span>
                <h3 className="text-sm font-semibold text-green-800">Logs configuration looks healthy</h3>
              </div>
              <ul className="text-sm text-green-700 space-y-1 list-disc list-inside">
                <li>Use targeted index filters to control what gets indexed</li>
                <li>Add exclusion filters for health checks, 2xx responses, and debug-level logs</li>
                <li>Route infrequently queried logs to Flex Logs to reduce cost by 80–90%</li>
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { scansApi, inventoryApi, analyticsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl, ddUrl } from '../utils/ddUrl';
import EvidenceTable from '../components/common/EvidenceTable';
import MetricCard from '../components/common/MetricCard';
import DataTable from '../components/common/DataTable';
import LoadingState, { EmptyState } from '../components/common/LoadingState';

function DDLink({ href, label = 'Open in Datadog' }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium shrink-0">
      {label} ↗
    </a>
  );
}

function RiskRow({ icon, label, count, total, threshold, href, hrefLabel }: {
  icon: string; label: string; count: number; total: number;
  threshold: number; href: string; hrefLabel: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const isRisk = pct >= threshold;
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${isRisk ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-100'}`}>
      <span className="text-lg">{icon}</span>
      <div className="flex-1">
        <div className="text-sm font-medium text-gray-800">{label}</div>
        <div className="text-xs text-gray-500">{count.toLocaleString()} of {total.toLocaleString()} monitors ({pct}%)</div>
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-16 bg-gray-200 rounded-full h-1.5`}>
          <div className={`h-1.5 rounded-full ${isRisk ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        {count > 0 && <DDLink href={href} label={hrefLabel} />}
      </div>
    </div>
  );
}

export default function MonitorsHealth() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');

  const { data: findings = [], isLoading: findingsLoading } = useQuery({
    queryKey: ['findings', selectedScanId, 'monitors_health'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'monitors_health' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: monitors } = useQuery({
    queryKey: ['monitors', selectedOrgId, selectedScanId, 1],
    queryFn: () => inventoryApi.monitors(selectedOrgId, selectedScanId, { pageSize: 200 }),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const { data: analytics } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const monitorData = monitors?.data ?? [];
  const totalMonitors = monitors?.total ?? 0;
  const mb = analytics?.monitorBreakdown;

  const mutedCount = mb?.mutedCount ?? monitorData.filter(m => m.is_muted).length;
  const noPriorityCount = monitorData.filter(m => !m.priority).length;
  const noNotifCount = mb?.withoutNotification ?? monitorData.filter(m => !m.has_notification).length;
  const alertingCount = mb?.byState?.['Alert'] ?? monitorData.filter(m => String(m.overall_state).toLowerCase() === 'alert').length;
  const noDataCount = mb?.byState?.['No Data'] ?? 0;
  const withoutEnv = mb?.withoutEnvTag ?? 0;
  const withoutService = mb?.withoutServiceTag ?? 0;
  const withoutTeam = mb?.withoutTeamTag ?? 0;

  const byType = mb?.byType ?? {};
  const byTypeEntries = Object.entries(byType).sort((a, b) => b[1] - a[1]);

  const sloData = analytics?.sloBreakdown;

  if (findingsLoading) return <LoadingState />;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monitors Health</h1>
          <p className="text-gray-500 text-sm mt-1">Monitor coverage, alerting quality, notification hygiene, and SLO overview</p>
        </div>
        <DDLink href={ddUrl.monitorList(base)} label="All Monitors" />
      </div>

      {!selectedScanId ? <EmptyState message="Run a scan to see monitor health data" /> : (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard label="Total Monitors" value={totalMonitors} icon="🔔" />
            <MetricCard label="Alerting Now" value={alertingCount}
              subtitle={`${totalMonitors > 0 ? Math.round((alertingCount / totalMonitors) * 100) : 0}% in alert state`}
              color={alertingCount > 0 ? 'red' : 'green'} />
            <MetricCard label="Muted" value={mutedCount}
              subtitle={`${totalMonitors > 0 ? Math.round((mutedCount / totalMonitors) * 100) : 0}% of monitors`}
              color={mutedCount > totalMonitors * 0.1 ? 'red' : 'default'} />
            <MetricCard label="No Notification" value={noNotifCount}
              subtitle="silently alerting"
              color={noNotifCount > 0 ? 'red' : 'green'} />
            <MetricCard label="SLOs" value={sloData?.total ?? analytics?.apm.slos ?? 0}
              subtitle={`${sloData?.byType ? Object.keys(sloData.byType).join(', ') : ''}`}
              icon="🎯" />
          </div>

          {/* Quality risk signals */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Monitor Quality Signals</h2>
            <RiskRow icon="🔕" label="Muted monitors" count={mutedCount} total={totalMonitors}
              threshold={10} href={ddUrl.mutedMonitors(base)} hrefLabel="View muted" />
            <RiskRow icon="🔇" label="No notification channel" count={noNotifCount} total={totalMonitors}
              threshold={5} href={ddUrl.monitorListFiltered(base, 'no_notification:true')} hrefLabel="View affected" />
            <RiskRow icon="🔢" label="No priority assigned" count={noPriorityCount} total={totalMonitors}
              threshold={20} href={ddUrl.monitorListFiltered(base, 'no_priority:true')} hrefLabel="Set priorities" />
            {withoutEnv > 0 && (
              <RiskRow icon="🏷" label="Missing env tag" count={withoutEnv} total={totalMonitors}
                threshold={15} href={ddUrl.monitorListFiltered(base, '-tag:env:*')} hrefLabel="View untagged" />
            )}
            {withoutService > 0 && (
              <RiskRow icon="🏷" label="Missing service tag" count={withoutService} total={totalMonitors}
                threshold={20} href={ddUrl.monitorListFiltered(base, '-tag:service:*')} hrefLabel="View untagged" />
            )}
            {alertingCount > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-red-50 border-red-200">
                <span className="text-lg">🚨</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-red-800">{alertingCount} monitor{alertingCount > 1 ? 's' : ''} currently in ALERT state</div>
                  <div className="text-xs text-red-600">These require immediate attention — review and acknowledge or fix the underlying issue.</div>
                </div>
                <DDLink href={ddUrl.alertingMonitors(base)} label="View alerting" />
              </div>
            )}
            {noDataCount > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-gray-50 border-gray-200">
                <span className="text-lg">📭</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-700">{noDataCount} monitors in No Data state</div>
                  <div className="text-xs text-gray-500">Agent may be offline, metric name changed, or monitor query is incorrect.</div>
                </div>
                <DDLink href={ddUrl.noDataMonitors(base)} label="View no-data" />
              </div>
            )}
          </div>

          {/* Monitor type breakdown */}
          {byTypeEntries.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">Monitor Types</h2>
                <DDLink href={ddUrl.monitorList(base)} label="Browse all" />
              </div>
              <div className="space-y-1.5">
                {byTypeEntries.map(([type, count]) => {
                  const pct = totalMonitors > 0 ? Math.round((count / totalMonitors) * 100) : 0;
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className="w-36 text-xs text-gray-600 truncate capitalize">{type.replace(/_/g, ' ')}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="h-2 bg-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-20 text-right text-xs text-gray-500 font-mono">{count.toLocaleString()} ({pct}%)</span>
                      <a href={ddUrl.monitorListFiltered(base, `type:${type}`)} target="_blank" rel="noopener noreferrer"
                        className="text-gray-300 hover:text-violet-500 text-xs">↗</a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Findings */}
          {findings.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Monitor Findings ({findings.length})</h2>
              <EvidenceTable findings={findings} />
            </div>
          )}

          {/* Monitor inventory table */}
          {monitorData.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">Monitor Inventory ({totalMonitors})</h2>
                <DDLink href={ddUrl.monitorList(base)} label="Open in Datadog" />
              </div>
              <DataTable
                columns={[
                  { key: 'monitor_name', header: 'Name', render: (r) => (
                    <span className="text-sm">
                      {String(r.monitor_name ?? '')}
                      {Boolean(r.monitor_id) && (
                        <a href={ddUrl.monitor(base, String(r.monitor_id))} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-gray-400 hover:text-violet-600 ml-1">↗</a>
                      )}
                    </span>
                  )},
                  { key: 'monitor_type', header: 'Type', render: (r) => <code className="text-xs bg-gray-100 px-1 rounded">{String(r.monitor_type ?? '')}</code> },
                  { key: 'overall_state', header: 'State', render: (r) => {
                    const state = String(r.overall_state ?? '');
                    const cls = state === 'Alert' ? 'bg-red-100 text-red-800' : state === 'Warn' ? 'bg-amber-100 text-amber-800' : state === 'OK' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600';
                    return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{state || '—'}</span>;
                  }},
                  { key: 'priority', header: 'Priority', render: (r) => r.priority
                    ? <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded font-medium">P{String(r.priority)}</span>
                    : <span className="text-red-400 text-xs">None</span> },
                  { key: 'notif', header: 'Notif', render: (r) => <span className={r.has_notification ? 'text-green-600' : 'text-red-400 font-bold'}>{r.has_notification ? '✓' : '✗'}</span> },
                  { key: 'env', header: 'env', render: (r) => <span className={r.has_env_tag ? 'text-green-600' : 'text-amber-500'}>{r.has_env_tag ? '✓' : '✗'}</span> },
                  { key: 'muted', header: 'Muted', render: (r) => r.is_muted
                    ? <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">Muted</span>
                    : null },
                ]}
                data={monitorData}
                rowKey={(r) => String(r.id)}
              />
            </div>
          )}

          {/* Investigation quick links */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Investigate in Datadog</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {[
                { label: 'All alerting monitors', href: ddUrl.alertingMonitors(base) },
                { label: 'Muted monitors', href: ddUrl.mutedMonitors(base) },
                { label: 'No Data monitors', href: ddUrl.noDataMonitors(base) },
                { label: 'All SLOs', href: ddUrl.slos(base) },
                { label: 'Create new monitor', href: `${ddUrl.monitorList(base)}/create` },
                { label: 'Monitor templates', href: `${ddUrl.monitorList(base)}/recommended` },
              ].map(({ label, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200 hover:border-violet-300 hover:bg-violet-50/30 transition-colors group">
                  <span className="text-sm text-gray-700 group-hover:text-violet-700">{label}</span>
                  <span className="text-gray-300 group-hover:text-violet-500">↗</span>
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { scansApi, analyticsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl, ddUrl } from '../utils/ddUrl';
import EvidenceTable from '../components/common/EvidenceTable';
import MetricCard from '../components/common/MetricCard';
import DataTable from '../components/common/DataTable';
import { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';
import FilterChip, { FilterChipRow } from '../components/ui/FilterChip';
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton';
import SectionGate from '../components/SectionGate';
import type { FindingSeverity } from '../types';

function DDLink({ href, label = 'Open in Datadog' }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-400 font-medium shrink-0">
      {label} ↗
    </a>
  );
}

function SideEffectBanner({ severity, title, detail, href, hrefLabel }: {
  severity: 'critical' | 'warning' | 'info';
  title: string; detail: string; href?: string; hrefLabel?: string;
}) {
  const styles = {
    critical: 'bg-red-500/10 border-red-500/30 text-red-900',
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-900',
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-900',
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
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all');

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['findings', selectedScanId, 'logs_health'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'logs_health' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

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

  const severityCounts = useMemo(() => {
    const counts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    findings.forEach((f) => { counts[f.severity] = (counts[f.severity] ?? 0) + 1; });
    return counts;
  }, [findings]);

  const filteredFindings = severityFilter === 'all' ? findings : findings.filter((f) => f.severity === severityFilter);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Logs Health"
        subtitle="Index coverage, pipeline hygiene, retention strategy, and cost exposure"
        actions={<DDLink href={ddUrl.logsIndexes(base)} label="Manage Indexes" />}
      />

      {!selectedScanId ? <EmptyState message="Run a scan to see logs health data" /> : (isLoading || analyticsLoading) ? (
        <div className="space-y-6">
          <SkeletonCards count={5} />
          <SkeletonTable rows={6} cols={6} />
        </div>
      ) : (
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
            <SectionGate featureKey="section.logs.risk_signals">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Active Risk Signals</h2>
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
            </SectionGate>
          )}

          {/* Findings */}
          {findings.length > 0 && (
            <SectionGate featureKey="section.logs.findings">
            <div className="card">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-lg font-semibold text-ink">
                  Logs Findings ({filteredFindings.length}{filteredFindings.length !== findings.length ? ` of ${findings.length}` : ''})
                </h2>
                <FilterChipRow>
                  <FilterChip label="All" active={severityFilter === 'all'} count={findings.length} onClick={() => setSeverityFilter('all')} />
                  {(['critical', 'high', 'medium', 'low', 'info'] as FindingSeverity[])
                    .filter((s) => severityCounts[s] > 0)
                    .map((s) => (
                      <FilterChip
                        key={s}
                        label={s[0].toUpperCase() + s.slice(1)}
                        active={severityFilter === s}
                        count={severityCounts[s]}
                        onClick={() => setSeverityFilter(s)}
                      />
                    ))}
                </FilterChipRow>
              </div>
              <EvidenceTable findings={filteredFindings} />
            </div>
            </SectionGate>
          )}

          {/* Index breakdown table */}
          {indexDetails.length > 0 && (
            <SectionGate featureKey="section.logs.index_breakdown">
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-base font-semibold text-ink">Index Breakdown ({indexDetails.length})</h2>
                <DDLink href={ddUrl.logsIndexes(base)} label="Manage all" />
              </div>
              <DataTable
                tableId="logs-index-breakdown"
                columns={[
                  { key: 'name', header: 'Index', sortable: true, render: (idx) => (
                    <span className="font-mono text-xs font-medium text-ink max-w-[160px] truncate inline-block" title={idx.name}>{idx.name}</span>
                  ) },
                  { key: 'isFlex', header: 'Type', sortable: true, sortAccessor: (idx) => (idx.isFlex ? 'Flex' : 'Online'), render: (idx) => (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${idx.isFlex ? 'bg-blue-500/15 text-blue-400' : 'bg-surface-sunken text-ink-muted'}`}>
                      {idx.isFlex ? 'Flex' : 'Online'}
                    </span>
                  ) },
                  { key: 'retentionDays', header: 'Retention', sortable: true, render: (idx) => (
                    <span className="text-xs">{idx.retentionDays ? `${idx.retentionDays}d` : '—'}</span>
                  ) },
                  { key: 'dailyLimitEvents', header: 'Daily Limit', sortable: true, render: (idx) => (
                    idx.dailyLimitEvents
                      ? <span className="text-xs">{idx.dailyLimitEvents >= 1e9 ? `${(idx.dailyLimitEvents / 1e9).toFixed(1)}B` : idx.dailyLimitEvents >= 1e6 ? `${(idx.dailyLimitEvents / 1e6).toFixed(0)}M` : idx.dailyLimitEvents.toLocaleString()}</span>
                      : <span className="text-xs text-amber-500">∞ No limit</span>
                  ) },
                  { key: 'exclusionFilters', header: 'Excl. Filters', sortable: true, render: (idx) => (
                    <span className={`text-xs font-medium ${idx.exclusionFilters === 0 && !idx.isFlex ? 'text-amber-400' : 'text-green-400'}`}>
                      {idx.exclusionFilters === 0 && !idx.isFlex ? '⚠ None' : idx.exclusionFilters}
                    </span>
                  ) },
                  { key: 'isRateLimited', header: 'Status', sortable: true, render: (idx) => (
                    idx.isRateLimited
                      ? <span className="text-[10px] px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded font-bold">RATE LIMITED</span>
                      : <span className="text-green-400 text-xs">✓</span>
                  ) },
                  { key: 'view', header: '', render: (idx) => <DDLink href={ddUrl.logIndexConfig(base, idx.name)} label="View" /> },
                ]}
                data={indexDetails}
                rowKey={(idx) => idx.name}
                emptyMessage="No indexes found"
                searchable
                pageSize={10}
              />
            </div>
            </SectionGate>
          )}

          {/* Retention distribution */}
          {retEntries.length > 0 && (
            <SectionGate featureKey="section.logs.retention_distribution">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-ink">Retention Distribution</h2>
                <DDLink href={ddUrl.logsIndexes(base)} label="Edit retentions" />
              </div>
              <div className="space-y-2">
                {retEntries.map(([days, count]) => {
                  const pct = totalIndexedByRetention > 0 ? Math.round((count / totalIndexedByRetention) * 100) : 0;
                  return (
                    <div key={days} className="flex items-center gap-3">
                      <span className="w-12 text-right text-xs text-ink-muted font-mono">{days}d</span>
                      <div className="flex-1 bg-surface-sunken rounded-full h-3 overflow-hidden">
                        <div className="h-full bg-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-16 text-xs text-ink-muted font-medium">{count} index{count > 1 ? 'es' : ''} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
              {retEntries.some(([days]) => parseInt(days) > 30) && (
                <p className="text-xs text-amber-400 mt-2 pt-2 border-t border-border">
                  ⚠ Indexes with &gt;30 day retention have elevated storage costs. Consider Flex Logs for infrequently accessed data.
                </p>
              )}
            </div>
            </SectionGate>
          )}

          {/* Quick investigation links */}
          <div className="card">
            <h2 className="text-sm font-semibold text-ink-muted mb-3">Investigate in Datadog</h2>
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
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border hover:border-violet-500/30 hover:bg-violet-500/30 transition-colors group">
                  <span className="text-sm text-ink-muted group-hover:text-violet-400">{label}</span>
                  <span className="text-ink-faint group-hover:text-violet-500">↗</span>
                </a>
              ))}
            </div>
          </div>

          {/* Best practices */}
          {findings.length === 0 && (
            <div className="card bg-green-500/10 border-green-500/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-green-400 text-xl">✓</span>
                <h3 className="text-sm font-semibold text-green-400">Logs configuration looks healthy</h3>
              </div>
              <ul className="text-sm text-green-400 space-y-1 list-disc list-inside">
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

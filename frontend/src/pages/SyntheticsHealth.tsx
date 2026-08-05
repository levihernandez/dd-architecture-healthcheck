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
import type { FindingSeverity } from '../types';

function DDLink({ href, label = 'Open in Datadog' }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-400 font-medium shrink-0">
      {label} ↗
    </a>
  );
}

const fmtNum = (n: number) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
};

export default function SyntheticsHealth() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all');

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['findings', selectedScanId, 'synthetics_health'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'synthetics_health' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const syn = analytics?.synthetics;
  const details = syn?.details ?? [];
  const apiTests = syn?.apiTests ?? 0;
  const browserTests = syn?.browserTests ?? 0;
  const totalTests = apiTests + browserTests;
  const monthlyRuns = syn?.estimatedMonthlyRuns ?? 0;

  const pausedTests = details.filter(t => t.status === 'paused');
  const alertTests = details.filter(t => t.status === 'alert');
  const singleLocationTests = details.filter(t => t.locations <= 1 && t.status !== 'paused');

  const testsByType: Record<string, number> = {};
  details.forEach(t => { testsByType[t.type] = (testsByType[t.type] ?? 0) + 1; });

  const severityCounts = useMemo(() => {
    const counts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    findings.forEach((f) => { counts[f.severity] = (counts[f.severity] ?? 0) + 1; });
    return counts;
  }, [findings]);

  const filteredFindings = severityFilter === 'all' ? findings : findings.filter((f) => f.severity === severityFilter);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Synthetics Health"
        subtitle="Synthetic test coverage, run volume, alert status, and location distribution"
        actions={<DDLink href={ddUrl.syntheticsTests(base)} label="All Tests" />}
      />

      {!selectedScanId ? <EmptyState message="Run a scan to see synthetics health" /> : (isLoading || analyticsLoading) ? (
        <div className="space-y-6">
          <SkeletonCards count={5} />
          <SkeletonTable rows={8} cols={5} />
        </div>
      ) : (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard label="Total Tests" value={totalTests} icon="🌐" />
            <MetricCard label="API Tests" value={apiTests}
              subtitle={totalTests > 0 ? `${Math.round((apiTests / totalTests) * 100)}% of total` : ''}
              color={apiTests === 0 ? 'amber' : 'default'} />
            <MetricCard label="Browser Tests" value={browserTests}
              subtitle={totalTests > 0 ? `${Math.round((browserTests / totalTests) * 100)}% of total` : ''} />
            <MetricCard label="Alerting" value={alertTests.length}
              subtitle={alertTests.length > 0 ? 'tests failing now' : 'all passing'}
              color={alertTests.length > 0 ? 'red' : 'green'} />
            <MetricCard label="Est. Monthly Runs" value={fmtNum(monthlyRuns)}
              subtitle="across all tests" />
          </div>

          {/* Risk signals */}
          {(pausedTests.length > 0 || alertTests.length > 0 || singleLocationTests.length > 0) && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">Active Signals</h2>
              {alertTests.length > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-red-500/10 border-red-500/30">
                  <span className="text-lg">🚨</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-red-400">{alertTests.length} test{alertTests.length > 1 ? 's' : ''} currently alerting</div>
                    <div className="text-xs text-red-400 mt-0.5">
                      {alertTests.slice(0, 3).map(t => t.name).join(', ')}{alertTests.length > 3 ? ` +${alertTests.length - 3} more` : ''}
                    </div>
                  </div>
                  <DDLink href={ddUrl.syntheticsAlerts(base)} label="View alerts" />
                </div>
              )}
              {pausedTests.length > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-amber-500/10 border-amber-500/30">
                  <span className="text-lg">⏸</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-amber-400">{pausedTests.length} test{pausedTests.length > 1 ? 's' : ''} paused</div>
                    <div className="text-xs text-amber-400 mt-0.5">Paused tests provide no monitoring coverage. Review and resume or delete.
                      <br />{pausedTests.slice(0, 4).map(t => t.name).join(', ')}{pausedTests.length > 4 ? ` +${pausedTests.length - 4}` : ''}
                    </div>
                  </div>
                  <DDLink href={ddUrl.syntheticsPaused(base)} label="View paused" />
                </div>
              )}
              {singleLocationTests.length > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-blue-500/10 border-blue-100">
                  <span className="text-lg">📍</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-blue-400">{singleLocationTests.length} test{singleLocationTests.length > 1 ? 's' : ''} running from a single location</div>
                    <div className="text-xs text-blue-400 mt-0.5">Single-location tests can't distinguish regional outages from global ones. Use 3+ locations for critical paths.</div>
                  </div>
                  <DDLink href={ddUrl.syntheticsTests(base)} label="Edit tests" />
                </div>
              )}
            </div>
          )}

          {/* Test breakdown */}
          {details.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Test type breakdown */}
              <div className="card">
                <h2 className="text-base font-semibold text-ink mb-3">Test Type Breakdown</h2>
                <div className="space-y-2">
                  {Object.entries(testsByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                    const pct = totalTests > 0 ? Math.round((count / totalTests) * 100) : 0;
                    return (
                      <div key={type} className="flex items-center gap-3">
                        <span className="w-28 text-xs text-ink-muted capitalize">{type}</span>
                        <div className="flex-1 bg-surface-sunken rounded-full h-2">
                          <div className="h-2 bg-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-16 text-right text-xs text-ink-muted font-mono">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Location distribution */}
              <div className="card">
                <h2 className="text-base font-semibold text-ink mb-3">Location Coverage</h2>
                <div className="space-y-2">
                  {[
                    { label: '1 location', count: details.filter(t => t.locations === 1).length, risk: true },
                    { label: '2 locations', count: details.filter(t => t.locations === 2).length, risk: false },
                    { label: '3–5 locations', count: details.filter(t => t.locations >= 3 && t.locations <= 5).length, risk: false },
                    { label: '6+ locations', count: details.filter(t => t.locations >= 6).length, risk: false },
                  ].filter(r => r.count > 0).map(row => (
                    <div key={row.label} className="flex items-center gap-3">
                      <span className={`w-24 text-xs ${row.risk ? 'text-amber-400 font-medium' : 'text-ink-muted'}`}>{row.label}</span>
                      <div className="flex-1 bg-surface-sunken rounded-full h-2">
                        <div className={`h-2 rounded-full ${row.risk ? 'bg-amber-400' : 'bg-green-400'}`}
                          style={{ width: `${totalTests > 0 ? (row.count / totalTests) * 100 : 0}%` }} />
                      </div>
                      <span className="w-8 text-right text-xs text-ink-muted font-mono">{row.count}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-ink-faint mt-3 border-t border-border pt-2">
                  Best practice: use 3+ geographic locations for production-critical tests
                </p>
              </div>
            </div>
          )}

          {/* Test table */}
          {details.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-base font-semibold text-ink">Test Inventory ({details.length})</h2>
                <DDLink href={ddUrl.syntheticsTests(base)} label="View all" />
              </div>
              <DataTable
                tableId="synthetics-tests"
                columns={[
                  { key: 'name', header: 'Test Name', sortable: true, render: (t) => (
                    <span className="text-sm text-ink max-w-[220px] truncate inline-block" title={t.name}>{t.name}</span>
                  ) },
                  { key: 'type', header: 'Type', sortable: true, render: (t) => (
                    <span className="text-xs px-1.5 py-0.5 bg-surface-sunken text-ink-muted rounded capitalize">{t.type}</span>
                  ) },
                  { key: 'status', header: 'Status', sortable: true, render: (t) => (
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium capitalize ${
                      t.status === 'alert' ? 'bg-red-500/15 text-red-400'
                      : t.status === 'paused' ? 'bg-surface-sunken text-ink-muted'
                      : t.status === 'ok' ? 'bg-green-500/15 text-green-400'
                      : 'bg-surface-sunken text-ink-faint'}`}>
                      {t.status}
                    </span>
                  ) },
                  { key: 'locations', header: 'Locations', sortable: true, render: (t) => (
                    <span className={`text-xs font-mono ${t.locations <= 1 ? 'text-amber-400 font-semibold' : 'text-ink'}`}>{t.locations}</span>
                  ) },
                  { key: 'estimatedMonthlyRuns', header: 'Est. Runs/mo', sortable: true, render: (t) => (
                    <span className="text-xs text-ink-muted font-mono">{fmtNum(t.estimatedMonthlyRuns)}</span>
                  ) },
                ]}
                data={details}
                rowKey={(t) => t.name}
                emptyMessage="No synthetic tests found"
                searchable
                pageSize={15}
              />
            </div>
          )}

          {/* Findings */}
          {findings.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-lg font-semibold text-ink">
                  Synthetics Findings ({filteredFindings.length}{filteredFindings.length !== findings.length ? ` of ${findings.length}` : ''})
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
          )}

          {/* Investigation links */}
          <div className="card">
            <h2 className="text-sm font-semibold text-ink-muted mb-3">Investigate in Datadog</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {[
                { label: 'All synthetic tests', href: ddUrl.syntheticsTests(base) },
                { label: 'Alerting tests', href: ddUrl.syntheticsAlerts(base) },
                { label: 'Paused tests', href: ddUrl.syntheticsPaused(base) },
                { label: 'Create API test', href: `${base}/synthetics/create` },
                { label: 'CI/CD pipeline tests', href: `${base}/synthetics/ci` },
                { label: 'Private locations', href: `${base}/synthetics/settings/private-locations` },
              ].map(({ label, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border hover:border-violet-500/30 hover:bg-violet-500/30 transition-colors group">
                  <span className="text-sm text-ink-muted group-hover:text-violet-400">{label}</span>
                  <span className="text-ink-faint group-hover:text-violet-500">↗</span>
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

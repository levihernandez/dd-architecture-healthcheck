import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { EmptyState } from '../components/common/LoadingState';
import { AISectionInsight } from '../components/analytics/AISectionInsight';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards } from '../components/ui/Skeleton';
import DataTable, { type Column } from '../components/common/DataTable';
import type { AnalyticsData } from '../types';

// ── Mini components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-ink' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="card text-center py-4">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-xs font-semibold text-ink-muted mt-1">{label}</div>
      {sub && <div className="text-xs text-ink-faint mt-0.5">{sub}</div>}
    </div>
  );
}

function Gauge({ pct, label, risk }: { pct: number; label: string; risk: 'low' | 'medium' | 'high' }) {
  const color = risk === 'high' ? '#ef4444' : risk === 'medium' ? '#f59e0b' : '#22c55e';
  const clamp = Math.min(pct, 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-muted mb-1">
        <span>{label}</span>
        <span className="font-semibold" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-2.5 bg-surface-sunken rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamp}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function CoveragePill({ pct }: { pct: number }) {
  const cls = pct >= 80 ? 'bg-green-100 text-green-700' : pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cls}`}>{pct}%</span>;
}

function RetentionBar({ dist }: { dist: Record<string, number> }) {
  const entries = Object.entries(dist).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return <div className="text-xs text-ink-faint">No retention data</div>;
  return (
    <div className="flex h-5 rounded-full overflow-hidden gap-px">
      {entries.map(([label, count]) => {
        const pct = (count / total) * 100;
        const days = parseInt(label);
        const bg = days <= 7 ? 'bg-green-400' : days <= 15 ? 'bg-blue-400' : days <= 30 ? 'bg-violet-400' : days <= 90 ? 'bg-amber-400' : 'bg-red-400';
        return (
          <div
            key={label}
            className={`${bg} flex items-center justify-center`}
            style={{ width: `${pct}%` }}
            title={`${label}: ${count} index${count > 1 ? 'es' : ''}`}
          >
            {pct > 12 && <span className="text-white text-xs font-semibold">{label}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Table column defs ───────────────────────────────────────────────────────────

type IndexDetail = AnalyticsData['logs']['indexDetails'][number];
type SyntheticDetail = AnalyticsData['synthetics']['details'][number];
type IntegrationRow = AnalyticsData['integrations']['list'][number];
type RumApp = AnalyticsData['rum']['apps'][number];

const indexColumns: Column<IndexDetail>[] = [
  { key: 'name', header: 'Index', sortable: true, render: (idx) => (
    <div className="flex items-center gap-2">
      <code className="text-xs font-mono text-ink">{idx.name}</code>
      {idx.isFlex && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Flex</span>}
    </div>
  ) },
  { key: 'retentionDays', header: 'Retention', sortable: true, sortAccessor: (idx) => idx.retentionDays ?? 0, render: (idx) => (
    <span className={`text-xs font-semibold ${
      (idx.retentionDays ?? 0) > 90 ? 'text-red-600' :
      (idx.retentionDays ?? 0) > 30 ? 'text-amber-700' : 'text-ink-muted'
    }`}>
      {idx.retentionDays != null ? `${idx.retentionDays}d` : '—'}
    </span>
  ) },
  { key: 'dailyLimitEvents', header: 'Daily Limit', sortable: true, sortAccessor: (idx) => idx.dailyLimitEvents ?? Infinity, render: (idx) => (
    <span className="text-xs text-ink-muted">
      {idx.dailyLimitEvents != null
        ? idx.dailyLimitEvents >= 1e6
          ? `${(idx.dailyLimitEvents / 1e6).toFixed(0)}M`
          : `${(idx.dailyLimitEvents / 1e3).toFixed(0)}K`
        : <span className="text-red-500 font-semibold">∞ no limit</span>}
    </span>
  ) },
  { key: 'exclusionFilters', header: 'Excl. Filters', sortable: true, render: (idx) => (
    <span className={`text-xs font-semibold ${idx.exclusionFilters === 0 ? 'text-red-500' : 'text-green-700'}`}>{idx.exclusionFilters}</span>
  ) },
  { key: 'filterQuery', header: 'Filter Query', render: (idx) => (
    <code className="text-xs text-ink-muted max-w-xs truncate block">{idx.filterQuery || '*'}</code>
  ) },
  { key: 'isRateLimited', header: 'Status', sortable: true, sortAccessor: (idx) => (idx.isRateLimited ? 1 : 0), render: (idx) => (
    idx.isRateLimited ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Rate limited</span> : null
  ) },
];

const syntheticsColumns: Column<SyntheticDetail>[] = [
  { key: 'name', header: 'Test', sortable: true, render: (t) => <span className="text-xs text-ink max-w-xs truncate block">{t.name}</span> },
  { key: 'type', header: 'Type', sortable: true, render: (t) => (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${t.type === 'browser' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{t.type}</span>
  ) },
  { key: 'status', header: 'Status', sortable: true, render: (t) => <span className="text-xs text-ink-muted">{t.status}</span> },
  { key: 'locations', header: 'Locations', sortable: true, render: (t) => <span className="text-xs text-ink-muted">{t.locations}</span> },
  { key: 'estimatedMonthlyRuns', header: 'Est. Runs/mo', sortable: true, render: (t) => <span className="text-xs font-semibold text-ink-muted">{t.estimatedMonthlyRuns.toLocaleString()}</span> },
];

const integrationColumns: Column<IntegrationRow>[] = [
  { key: 'name', header: 'Integration', sortable: true, render: (i) => <span className="text-xs font-medium text-ink">{i.name}</span> },
  { key: 'type', header: 'Type', sortable: true, render: (i) => <span className="text-xs text-ink-muted">{i.type ?? '—'}</span> },
  { key: 'status', header: 'Status', sortable: true, render: (i) => <span className="text-xs text-ink-muted">{i.status ?? '—'}</span> },
  { key: 'isEnabled', header: 'Enabled', sortable: true, sortAccessor: (i) => (i.isEnabled ? 1 : 0), render: (i) => (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${i.isEnabled ? 'bg-green-100 text-green-700' : 'bg-surface-sunken text-ink-muted'}`}>{i.isEnabled ? 'Yes' : 'No'}</span>
  ) },
];

const rumColumns: Column<RumApp>[] = [
  { key: 'name', header: 'Application', sortable: true, sortAccessor: (a) => a.name ?? a.id, render: (a) => <span className="text-xs font-medium text-ink">{a.name ?? a.id}</span> },
  { key: 'type', header: 'Type', sortable: true, render: (a) => (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
      a.type === 'browser' ? 'bg-blue-100 text-blue-700' :
      a.type === 'ios' ? 'bg-purple-100 text-purple-700' :
      a.type === 'android' ? 'bg-green-100 text-green-700' : 'bg-surface-sunken text-ink-muted'
    }`}>{a.type ?? 'unknown'}</span>
  ) },
  { key: 'framework', header: 'Framework', sortable: true, render: (a) => <span className="text-xs text-ink-muted">{a.framework ?? '—'}</span> },
  { key: 'createdAt', header: 'Created', sortable: true, render: (a) => (
    <span className="text-xs text-ink-faint">{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '—'}</span>
  ) },
];

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader
        title="Analytics & Allotments"
        subtitle="Infrastructure footprint, log pipeline, integrations, and usage estimates across your Datadog account"
      />

      {!selectedScanId ? <EmptyState message="Select a scan to view analytics" /> :
        isLoading ? <SkeletonCards count={8} /> :
        !data ? <EmptyState message="No analytics data available" /> :
        <AnalyticsBody data={data} />
      }
    </div>
  );
}

function AnalyticsBody({ data }: { data: AnalyticsData }) {
  const { infrastructure, customMetrics, logs, integrations, synthetics, apm, observability, monitorBreakdown, sloBreakdown, governance, scorecard, rum, fleet } = data;

  return (
    <div className="space-y-10">

      {/* ── Key metrics ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Hosts" value={infrastructure.totalHosts} sub={infrastructure.hostTier} color="text-violet-700" />
        <StatCard label="Log Indexes" value={logs.totalIndexes} sub={`${logs.pipelines} pipelines`} color="text-blue-700" />
        <StatCard label="Integrations" value={integrations.total} sub={`${integrations.configured} configured`} color="text-green-700" />
        <StatCard label="APM Services" value={apm.totalServices} sub={`${apm.svcInCatalog} in catalog`} color="text-amber-700" />
        <StatCard label="Monitors" value={observability.monitors} sub={monitorBreakdown.mutedCount > 0 ? `${monitorBreakdown.mutedCount} muted` : 'none muted'} color={monitorBreakdown.mutedCount > 0 ? 'text-amber-700' : 'text-ink'} />
        <StatCard label="SLOs" value={sloBreakdown.total} sub={Object.keys(sloBreakdown.byType).join(' · ') || 'none'} color="text-teal-700" />
        <StatCard label="Dashboards" value={observability.dashboards} color="text-indigo-700" />
        {scorecard && <StatCard label="Health Score" value={`${scorecard.overallScore}%`} sub={scorecard.overallGrade} color={scorecard.overallScore >= 90 ? 'text-green-700' : scorecard.overallScore >= 70 ? 'text-amber-700' : 'text-red-700'} />}
      </div>

      {/* ── Infrastructure & allotment ───────────────────────────────────── */}
      <section>
        <SectionHeader title="Infrastructure & Allotment" aiPrompt="Analyze this org's infrastructure and allotment data. Review the host count and tier, UST tag coverage (env, service, version, team), custom metrics utilization vs allotment, and top cardinality drivers. Identify the key cost risks, gaps in observability coverage, and the top 3 actionable recommendations to optimize infrastructure spending and tagging hygiene." />
        <div className="grid grid-cols-3 gap-4">

          {/* Host footprint */}
          <div className="card col-span-1 space-y-3">
            <div className="font-semibold text-ink text-sm">Host Footprint</div>
            <div className="text-4xl font-bold text-violet-700">{infrastructure.totalHosts}</div>
            <div className="text-xs text-ink-muted">Tier: {infrastructure.hostTier}</div>
            {infrastructure.containers != null && (
              <div className="text-xs text-ink-muted">Containers: {infrastructure.containers.toLocaleString()}</div>
            )}
            {infrastructure.cloudAccounts.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {infrastructure.cloudAccounts.map(ca => (
                  <span key={ca.provider} className="text-xs bg-surface-sunken text-ink-muted px-2 py-0.5 rounded-full">
                    {ca.provider}: {ca.n}
                  </span>
                ))}
              </div>
            )}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide">UST Coverage</div>
              {(['env', 'service', 'version', 'team'] as const).map(k => (
                <div key={k} className="flex items-center justify-between text-xs">
                  <code className="text-ink-muted">{k}</code>
                  <CoveragePill pct={infrastructure.tagCoverage[k]} />
                </div>
              ))}
            </div>
          </div>

          {/* Custom metrics allotment */}
          <div className="card col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-ink text-sm">Custom Metrics Allotment</div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                customMetrics.risk === 'high' ? 'bg-red-100 text-red-700'
                : customMetrics.risk === 'medium' ? 'bg-amber-100 text-amber-700'
                : 'bg-green-100 text-green-700'
              }`}>
                {customMetrics.risk.toUpperCase()} RISK
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-surface-subtle rounded-lg p-3">
                <div className="text-xl font-bold text-ink">{customMetrics.estimated.toLocaleString()}</div>
                <div className="text-xs text-ink-muted">Estimated volume</div>
              </div>
              <div className="bg-violet-50 rounded-lg p-3">
                <div className="text-xl font-bold text-violet-700">{customMetrics.allotmentAt100PerHost.toLocaleString()}</div>
                <div className="text-xs text-ink-muted">Allotment @ 100/host</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-xl font-bold text-blue-700">{customMetrics.allotmentAt200PerHost.toLocaleString()}</div>
                <div className="text-xs text-ink-muted">Allotment @ 200/host</div>
              </div>
            </div>

            <Gauge pct={customMetrics.utilizationPct} label="Utilization vs 100/host allotment" risk={customMetrics.risk} />

            {customMetrics.topDrivers.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Top Cardinality Drivers</div>
                <div className="space-y-1.5">
                  {customMetrics.topDrivers.slice(0, 6).map(d => (
                    <div key={d.key} className="flex items-center gap-2">
                      <code className="text-xs text-violet-700 w-40 truncate shrink-0">{d.key}</code>
                      <div className="flex-1 h-1.5 bg-surface-sunken rounded-full">
                        <div
                          className="h-full bg-violet-400 rounded-full"
                          style={{ width: `${Math.min((d.uniqueValues / (customMetrics.topDrivers[0]?.uniqueValues || 1)) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-ink-muted w-20 text-right shrink-0">
                        {d.uniqueValues} values · ~{d.estimatedMetrics.toLocaleString()} CM
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Log pipeline ────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Log Pipeline" aiPrompt="Analyze this org's log pipeline configuration. Review all log indexes, their retention periods, daily event limits, exclusion filters, and Flex tier usage. Identify indexes that are rate-limited, indexes without exclusion filters (cost risk), indexes with long retention that could be moved to Flex, and any pipeline gaps. Provide the top 3 recommendations to reduce log costs and improve pipeline efficiency." />
        <div className="space-y-4">

          {/* Summary row */}
          <div className="grid grid-cols-5 gap-3">
            <StatCard label="Log Indexes" value={logs.totalIndexes} />
            <StatCard label="Pipelines" value={logs.pipelines} sub={`${logs.enabledPipelines} enabled`} />
            <StatCard
              label="Daily Event Limit"
              value={logs.totalDailyLimitEvents > 0 ? (logs.totalDailyLimitEvents / 1e6).toFixed(0) + 'M' : '∞'}
              sub={logs.totalDailyLimitEvents === 0 ? 'Uncapped — cost risk' : 'events/day total'}
              color={logs.totalDailyLimitEvents === 0 ? 'text-red-600' : 'text-ink'}
            />
            <StatCard
              label="Exclusion Filters"
              value={logs.totalExclusionFilters}
              sub={logs.totalExclusionFilters === 0 ? '0% cost protection' : 'across all indexes'}
              color={logs.totalExclusionFilters === 0 ? 'text-red-600' : 'text-green-700'}
            />
            <StatCard
              label="Rate Limited"
              value={logs.rateLimitedCount}
              sub={logs.rateLimitedCount > 0 ? 'hitting daily cap' : 'none hitting cap'}
              color={logs.rateLimitedCount > 0 ? 'text-red-600' : 'text-ink'}
            />
          </div>

          {/* Retention distribution */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-ink text-sm">Retention Distribution</div>
              <div className="flex gap-3 text-xs text-ink-faint">
                <span><span className="inline-block w-3 h-2 bg-green-400 rounded mr-1" />≤7d</span>
                <span><span className="inline-block w-3 h-2 bg-blue-400 rounded mr-1" />≤15d</span>
                <span><span className="inline-block w-3 h-2 bg-violet-400 rounded mr-1" />≤30d</span>
                <span><span className="inline-block w-3 h-2 bg-amber-400 rounded mr-1" />≤90d</span>
                <span><span className="inline-block w-3 h-2 bg-red-400 rounded mr-1" />&gt;90d</span>
              </div>
            </div>
            <RetentionBar dist={logs.retentionDistribution} />
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(logs.retentionDistribution).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([label, count]) => (
                <span key={label} className="text-xs bg-surface-sunken text-ink-muted px-2 py-0.5 rounded">
                  {label}: {count} index{count > 1 ? 'es' : ''}
                </span>
              ))}
            </div>
            {logs.flexIndexCount > 0 && (
              <div className="mt-3 text-xs bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded-lg">
                ✓ {logs.flexIndexCount} Flex Log index{logs.flexIndexCount > 1 ? 'es' : ''} detected — warm-tier cost optimization active
              </div>
            )}
            {logs.flexIndexCount === 0 && logs.totalIndexes > 0 && (
              <div className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-lg">
                ⚠ No Flex Log indexes detected — consider moving low-query indexes to Flex tier to reduce indexing costs
              </div>
            )}
          </div>

          {/* Index table */}
          <DataTable
            columns={indexColumns}
            data={logs.indexDetails}
            rowKey={(idx) => idx.name}
            emptyMessage="No log indexes found"
            tableId="analytics-log-indexes"
          />
        </div>
      </section>

      {/* ── Synthetics ──────────────────────────────────────────────────────── */}
      {(synthetics.apiTests + synthetics.browserTests) > 0 && (
        <section>
          <SectionHeader title="Synthetics Usage" aiPrompt="Analyze this org's Datadog Synthetics usage. Review the mix of API vs browser tests, estimated monthly run volumes, test status distribution, and location spread. Browser tests cost significantly more than API tests. Identify opportunities to replace or consolidate browser tests with API tests where appropriate, flag tests with unusually high run volumes, and provide the top 3 recommendations to optimize synthetic test coverage while reducing costs." />
          <div className="grid grid-cols-4 gap-3 mb-4">
            <StatCard label="API Tests" value={synthetics.apiTests} />
            <StatCard label="Browser Tests" value={synthetics.browserTests} color={synthetics.browserTests > 0 ? 'text-amber-700' : 'text-ink'} />
            <StatCard
              label="Est. Monthly Runs"
              value={synthetics.estimatedMonthlyRuns > 1e6
                ? `${(synthetics.estimatedMonthlyRuns / 1e6).toFixed(1)}M`
                : synthetics.estimatedMonthlyRuns.toLocaleString()}
              sub="based on default frequency"
            />
            <StatCard
              label="Browser vs API Ratio"
              value={synthetics.apiTests + synthetics.browserTests > 0
                ? `${Math.round(synthetics.browserTests / (synthetics.apiTests + synthetics.browserTests) * 100)}%`
                : '—'}
              sub="browser (higher cost)"
              color={synthetics.browserTests / (synthetics.apiTests + synthetics.browserTests || 1) > 0.5 ? 'text-amber-700' : 'text-ink'}
            />
          </div>
          {synthetics.details.length > 0 && (
            <DataTable
              columns={syntheticsColumns}
              data={synthetics.details}
              rowKey={(t) => t.name}
              tableId="analytics-synthetics"
            />
          )}
        </section>
      )}

      {/* ── APM & Observability ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="APM & Observability" aiPrompt="Analyze this org's APM and observability maturity. Review the APM service count and what percentage are registered in the Service Catalog, how many services have monitors and SLOs configured, and the overall monitor and dashboard counts. Identify observability gaps (services without monitors, missing SLOs, low catalog coverage) and provide the top 3 recommendations to improve APM coverage, reliability tracking, and operational readiness." />
        <div className="grid grid-cols-6 gap-3">
          <StatCard label="APM Services" value={apm.totalServices} color="text-violet-700" />
          <StatCard label="In Service Catalog" value={apm.svcInCatalog} sub={`${apm.totalServices > 0 ? Math.round(apm.svcInCatalog / apm.totalServices * 100) : 0}%`} />
          <StatCard label="With Monitor" value={apm.svcWithMonitor} />
          <StatCard label="With SLO" value={apm.svcWithSLO} />
          <StatCard label="Monitors" value={observability.monitors} color="text-blue-700" />
          <StatCard label="Dashboards" value={observability.dashboards} color="text-blue-700" />
        </div>
      </section>

      {/* ── Integrations ────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Integrations" aiPrompt="Analyze this org's Datadog integration footprint. Review total integrations detected, how many are configured vs enabled, the breakdown by integration type, and which specific integrations are present. Identify integrations that are configured but not enabled (potential waste or gaps), critical integrations that may be missing based on the infrastructure in use (cloud providers, databases, etc.), and provide the top 3 recommendations to improve integration coverage and data collection." />
        <div className="grid grid-cols-3 gap-4">
          <div className="card space-y-3">
            <div className="font-semibold text-ink text-sm">Summary</div>
            <div className="space-y-2">
              {[
                { label: 'Total detected', value: integrations.total, color: 'text-ink' },
                { label: 'Configured', value: integrations.configured, color: 'text-blue-700' },
                { label: 'Enabled', value: integrations.enabled, color: 'text-green-700' },
              ].map(r => (
                <div key={r.label} className="flex justify-between text-sm">
                  <span className="text-ink-muted">{r.label}</span>
                  <span className={`font-semibold ${r.color}`}>{r.value}</span>
                </div>
              ))}
            </div>
            {integrations.byType.length > 0 && (
              <div className="pt-2 border-t border-border">
                <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">By Type</div>
                <div className="flex flex-wrap gap-1">
                  {integrations.byType.map(t => (
                    <span key={t.type} className="text-xs bg-surface-sunken text-ink-muted px-2 py-0.5 rounded">
                      {t.type}: {t.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="col-span-2 max-h-96 overflow-y-auto">
            <DataTable
              columns={integrationColumns}
              data={integrations.list}
              rowKey={(i) => i.name}
              emptyMessage="No integrations found in this scan"
              tableId="analytics-integrations"
            />
          </div>
        </div>
      </section>
      {/* ── Monitor Intelligence ─────────────────────────────────────────── */}
      {monitorBreakdown.total > 0 && (
        <section>
          <SectionHeader title="Monitor Intelligence" aiPrompt="Analyze this org's monitor configuration. Review the monitor state distribution (OK, Alert, No Data), type breakdown, muted monitors, monitors without notification channels, and monitors missing env/service/team tags. Identify the top risks (unnotified alerts, data gaps, muted monitors) and provide the top 3 recommendations to improve monitor coverage and reduce alert fatigue." />
          <div className="grid grid-cols-3 gap-4">

            {/* State distribution */}
            <div className="card space-y-3">
              <div className="font-semibold text-ink text-sm">Alert State Distribution</div>
              <div className="space-y-2">
                {Object.entries(monitorBreakdown.byState).sort((a, b) => b[1] - a[1]).map(([state, count]) => {
                  const pct = Math.round((count / monitorBreakdown.total) * 100);
                  const color = state === 'Alert' ? 'bg-red-400' : state === 'Warn' ? 'bg-amber-400' : state === 'No Data' ? 'bg-gray-300' : 'bg-green-400';
                  const textColor = state === 'Alert' ? 'text-red-700' : state === 'Warn' ? 'text-amber-700' : state === 'No Data' ? 'text-ink-muted' : 'text-green-700';
                  return (
                    <div key={state}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-ink-muted">{state}</span>
                        <span className={`font-semibold ${textColor}`}>{count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Type breakdown */}
            <div className="card space-y-3">
              <div className="font-semibold text-ink text-sm">Monitor Types</div>
              <div className="space-y-1.5">
                {Object.entries(monitorBreakdown.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <span className="text-ink-muted capitalize">{type}</span>
                    <span className="font-semibold text-ink bg-surface-sunken px-2 py-0.5 rounded-full">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Coverage gaps */}
            <div className="card space-y-3">
              <div className="font-semibold text-ink text-sm">Coverage Gaps</div>
              <div className="space-y-2">
                {[
                  { label: 'Muted', count: monitorBreakdown.mutedCount, risk: monitorBreakdown.mutedCount > 0 },
                  { label: 'No notification channel', count: monitorBreakdown.withoutNotification, risk: monitorBreakdown.withoutNotification > 0 },
                  { label: 'Missing env tag', count: monitorBreakdown.withoutEnvTag, risk: monitorBreakdown.withoutEnvTag > monitorBreakdown.total * 0.2 },
                  { label: 'Missing service tag', count: monitorBreakdown.withoutServiceTag, risk: monitorBreakdown.withoutServiceTag > monitorBreakdown.total * 0.2 },
                  { label: 'Missing team tag', count: monitorBreakdown.withoutTeamTag, risk: monitorBreakdown.withoutTeamTag > monitorBreakdown.total * 0.5 },
                ].map(({ label, count, risk }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-ink-muted">{label}</span>
                    <span className={`font-semibold px-2 py-0.5 rounded-full ${risk && count > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── SLO & Reliability ───────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="SLO & Reliability" aiPrompt="Analyze this org's SLO configuration. Review the SLO count, types (metric vs monitor-based), service coverage, and tagging hygiene on SLOs. Compare the number of SLOs against APM services to identify services missing reliability targets. Provide the top 3 recommendations to improve SLO coverage and reliability tracking." />
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total SLOs" value={sloBreakdown.total} color={sloBreakdown.total === 0 ? 'text-red-600' : 'text-teal-700'} sub={sloBreakdown.total === 0 ? 'None defined' : undefined} />
          <StatCard label="Metric SLOs" value={sloBreakdown.byType['metric'] ?? 0} color="text-blue-700" />
          <StatCard label="Monitor SLOs" value={sloBreakdown.byType['monitor'] ?? 0} color="text-violet-700" />
          <StatCard
            label="Services with SLO"
            value={apm.totalServices > 0 ? `${Math.round(apm.svcWithSLO / apm.totalServices * 100)}%` : '—'}
            sub={`${apm.svcWithSLO} / ${apm.totalServices}`}
            color={apm.totalServices > 0 && apm.svcWithSLO / apm.totalServices < 0.5 ? 'text-amber-700' : 'text-green-700'}
          />
        </div>
        {sloBreakdown.total === 0 && (
          <div className="mt-3 card bg-amber-50 border-amber-200 text-amber-800 text-sm">
            No SLOs detected. SLOs are essential for tracking reliability targets — consider defining at minimum one SLO per critical service for error rate and latency.
          </div>
        )}
        {sloBreakdown.total > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="card space-y-2">
              <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide">SLO Tag Coverage</div>
              {(['env', 'service'] as const).map(tag => {
                const count = tag === 'env' ? sloBreakdown.withEnvTag : sloBreakdown.withServiceTag;
                const pct = sloBreakdown.total > 0 ? Math.round(count / sloBreakdown.total * 100) : 0;
                return (
                  <div key={tag} className="flex items-center justify-between text-xs">
                    <code className="text-ink-muted">{tag}</code>
                    <CoveragePill pct={pct} />
                  </div>
                );
              })}
            </div>
            <div className="card space-y-2">
              <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Service Coverage</div>
              <div className="text-xs text-ink-muted">
                <span className="font-semibold text-ink">{apm.svcWithSLO}</span> of <span className="font-semibold text-ink">{apm.totalServices}</span> APM services have at least one SLO
              </div>
              {apm.totalServices > 0 && apm.svcWithSLO < apm.totalServices && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  {apm.totalServices - apm.svcWithSLO} service{apm.totalServices - apm.svcWithSLO > 1 ? 's' : ''} have no SLO defined
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Governance & Access ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Governance & Access" aiPrompt="Analyze this org's governance and access control posture. Review the user count, role count, RBAC configuration, team structure, and unified tagging compliance findings. Identify governance gaps (missing teams, poor tag coverage, access control risks) and provide the top 3 recommendations to improve governance hygiene and team ownership visibility." />
        <div className="grid grid-cols-3 gap-4">

          {/* Users & roles */}
          <div className="card space-y-4">
            <div className="font-semibold text-ink text-sm">Users & Access</div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-surface-subtle rounded-lg p-3">
                <div className="text-2xl font-bold text-ink">{governance.userCount ?? '—'}</div>
                <div className="text-xs text-ink-muted mt-0.5">Users</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-2xl font-bold text-blue-700">{governance.roleCount ?? '—'}</div>
                <div className="text-xs text-ink-muted mt-0.5">Roles</div>
              </div>
            </div>
          </div>

          {/* Governance findings */}
          <div className="card col-span-2 space-y-2">
            <div className="font-semibold text-ink text-sm">Governance & Tagging Findings</div>
            {governance.findings.length === 0 ? (
              <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                ✓ No governance or tagging findings — org is in good shape
              </div>
            ) : (
              <div className="space-y-2">
                {governance.findings.map((f, i) => (
                  <div key={i} className={`rounded-lg px-3 py-2 border text-xs ${
                    f.severity === 'critical' ? 'bg-red-50 border-red-200 text-red-800' :
                    f.severity === 'high' ? 'bg-orange-50 border-orange-200 text-orange-800' :
                    f.severity === 'medium' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                    'bg-surface-subtle border-border text-ink-muted'
                  }`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`font-semibold uppercase text-[10px] px-1.5 py-0.5 rounded ${
                        f.severity === 'critical' ? 'bg-red-200 text-red-800' :
                        f.severity === 'high' ? 'bg-orange-200 text-orange-800' :
                        f.severity === 'medium' ? 'bg-amber-200 text-amber-800' :
                        'bg-surface-sunken text-ink-muted'
                      }`}>{f.severity}</span>
                      <span className="font-medium">{f.ruleName}</span>
                    </div>
                    <div className="text-ink-muted">{f.description}</div>
                    {f.recommendation && <div className="mt-1 text-ink-muted italic">{f.recommendation}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── RUM Applications ────────────────────────────────────────────────── */}
      {rum && (
        <section>
          <SectionHeader title="Real User Monitoring (RUM)" aiPrompt="Analyze this org's RUM application configuration. Review the number of RUM applications, their types (browser, iOS, Android, Flutter, React Native), and framework coverage. Identify any missing application types that should be instrumented based on the org's tech stack, highlight gaps in mobile vs web coverage, and provide the top 3 recommendations to improve frontend observability and session replay value." />
          {rum.total === 0 ? (
            <div className="card bg-amber-50 border-amber-200 text-amber-800 text-sm">
              No RUM applications detected. RUM provides frontend performance visibility, error tracking, and session replay — consider instrumenting your web and mobile apps.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <div className="card space-y-3">
                <div className="font-semibold text-ink text-sm">Summary</div>
                <div className="text-4xl font-bold text-violet-700">{rum.total}</div>
                <div className="text-xs text-ink-muted">RUM applications</div>
                {Object.keys(rum.byType).length > 0 && (
                  <div className="pt-2 border-t border-border space-y-1.5">
                    <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide">By Type</div>
                    {Object.entries(rum.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between text-xs">
                        <span className="text-ink-muted capitalize">{type}</span>
                        <span className="font-semibold text-ink bg-surface-sunken px-2 py-0.5 rounded-full">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="col-span-2">
                <DataTable
                  columns={rumColumns}
                  data={rum.apps}
                  rowKey={(app) => app.id}
                  tableId="analytics-rum-apps"
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Fleet Management ─────────────────────────────────────────────────── */}
      {fleet && (Object.keys(fleet.agentVersions).length > 0 || Object.keys(fleet.platforms).length > 0 || fleet.installedChecks.length > 0) && (
        <section>
          <SectionHeader title="Fleet Management" aiPrompt="Analyze this org's Datadog Agent fleet. Review the agent version distribution (outdated agents are a security and feature risk), OS platform breakdown, and the top installed agent checks (integrations running on hosts). Identify agents running outdated versions, unusual platform diversity that may indicate config drift, and checks that suggest installed technologies not yet configured as formal Datadog integrations. Provide the top 3 fleet hygiene recommendations." />
          <div className="grid grid-cols-3 gap-4">

            {/* Agent versions */}
            <div className="card space-y-3">
              <div className="font-semibold text-ink text-sm">Agent Version Distribution</div>
              {Object.keys(fleet.agentVersions).length === 0 ? (
                <div className="text-xs text-ink-faint">No version data</div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(fleet.agentVersions).sort((a, b) => b[1] - a[1]).map(([ver, count]) => {
                    const total = Object.values(fleet.agentVersions).reduce((s, n) => s + n, 0);
                    const pct = Math.round((count / total) * 100);
                    const majorNum = parseInt(ver.replace('.x', ''));
                    const isOld = majorNum < 7;
                    return (
                      <div key={ver}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className={`font-mono ${isOld ? 'text-red-600' : 'text-ink-muted'}`}>Agent {ver}</span>
                          <span className={`font-semibold ${isOld ? 'text-red-600' : 'text-ink-muted'}`}>{count} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${isOld ? 'bg-red-400' : 'bg-green-400'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Platforms */}
            <div className="card space-y-3">
              <div className="font-semibold text-ink text-sm">OS Platforms</div>
              {Object.keys(fleet.platforms).length === 0 ? (
                <div className="text-xs text-ink-faint">No platform data</div>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(fleet.platforms).sort((a, b) => b[1] - a[1]).map(([platform, count]) => (
                    <div key={platform} className="flex items-center justify-between text-xs">
                      <span className="text-ink-muted">{platform}</span>
                      <span className="font-semibold text-ink bg-surface-sunken px-2 py-0.5 rounded-full">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top installed checks */}
            <div className="card space-y-3">
              <div className="font-semibold text-ink text-sm">Top Installed Checks</div>
              {fleet.installedChecks.length === 0 ? (
                <div className="text-xs text-ink-faint">No check data</div>
              ) : (
                <div className="space-y-1.5">
                  {fleet.installedChecks.map(({ name, count }) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <code className="text-ink-muted">{name}</code>
                      <span className="font-semibold text-ink-muted bg-surface-sunken px-2 py-0.5 rounded-full">{count} host{count > 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </section>
      )}

      {/* ── Health Scorecard ─────────────────────────────────────────────────── */}
      {scorecard && (
        <section>
          <SectionHeader title="Health Scorecard" aiPrompt="Review this org's overall Datadog health scorecard. Analyze the overall score and grade, individual category scores (tagging, monitors, logs, dashboards, synthetics, integrations, governance), and the top findings across all categories. Prioritize the highest-severity issues and provide the top 3 most impactful improvements the team should tackle first to raise the overall health score." />
          <div className="space-y-4">

            {/* Overall score */}
            <div className="card">
              <div className="flex items-center gap-6">
                <div className="text-center shrink-0">
                  <div className={`text-5xl font-bold ${
                    scorecard.overallScore >= 90 ? 'text-green-600' :
                    scorecard.overallScore >= 70 ? 'text-amber-600' : 'text-red-600'
                  }`}>{scorecard.overallScore}%</div>
                  <div className="text-xs font-semibold text-ink-muted mt-1 uppercase tracking-wide">{scorecard.overallGrade.replace('_', ' ')}</div>
                </div>
                <div className="flex-1 grid grid-cols-3 md:grid-cols-5 gap-3">
                  {scorecard.categories.map(cat => (
                    <div key={cat.category} className="text-center">
                      <div className={`text-lg font-bold ${
                        cat.percentage >= 90 ? 'text-green-600' :
                        cat.percentage >= 70 ? 'text-amber-600' : 'text-red-600'
                      }`}>{cat.percentage}%</div>
                      <div className="text-[10px] text-ink-muted capitalize leading-tight mt-0.5">
                        {cat.category.replace(/_/g, ' ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Top findings */}
            {scorecard.topFindings.length > 0 && (
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 bg-surface-subtle border-b border-border text-xs font-semibold text-ink-muted uppercase tracking-wide">
                  Top Findings
                </div>
                <div className="divide-y divide-border">
                  {scorecard.topFindings.filter(f => f.severity !== 'info').map((f, i) => (
                    <div key={i} className="px-4 py-3 flex items-start gap-3">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                        f.severity === 'critical' ? 'bg-red-100 text-red-700' :
                        f.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                        f.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-surface-sunken text-ink-muted'
                      }`}>{f.severity}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-ink">{f.title || f.ruleName}</div>
                        <div className="text-xs text-ink-muted mt-0.5">{f.description}</div>
                        {f.recommendation && (
                          <div className="text-xs text-violet-600 mt-1">→ {f.recommendation}</div>
                        )}
                      </div>
                      <span className="text-[10px] text-ink-faint bg-surface-sunken px-1.5 py-0.5 rounded shrink-0 ml-auto capitalize">
                        {f.category.replace(/_/g, ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

    </div>
  );
}

function SectionHeader({ title, aiPrompt }: { title: string; aiPrompt?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <div className="flex-1 border-t border-border" />
      {aiPrompt && <AISectionInsight section={title} prompt={aiPrompt} />}
    </div>
  );
}

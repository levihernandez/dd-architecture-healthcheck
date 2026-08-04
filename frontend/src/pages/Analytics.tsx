import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import LoadingState, { EmptyState } from '../components/common/LoadingState';
import { AISectionInsight } from '../components/analytics/AISectionInsight';
import type { AnalyticsData } from '../types';

// ── Mini components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-gray-900' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="card text-center py-4">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-xs font-semibold text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Gauge({ pct, label, risk }: { pct: number; label: string; risk: 'low' | 'medium' | 'high' }) {
  const color = risk === 'high' ? '#ef4444' : risk === 'medium' ? '#f59e0b' : '#22c55e';
  const clamp = Math.min(pct, 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span className="font-semibold" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
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
  if (total === 0) return <div className="text-xs text-gray-400">No retention data</div>;
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

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const [expandedIndex, setExpandedIndex] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  return (
    <div className="max-w-6xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics & Allotments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Infrastructure footprint, log pipeline, integrations, and usage estimates across your Datadog account
          </p>
        </div>
      </div>

      {!selectedScanId ? <EmptyState message="Select a scan to view analytics" /> :
        isLoading ? <LoadingState /> :
        !data ? <EmptyState message="No analytics data available" /> :
        <AnalyticsBody data={data} expandedIndex={expandedIndex} setExpandedIndex={setExpandedIndex} />
      }
    </div>
  );
}

function AnalyticsBody({ data, expandedIndex, setExpandedIndex }: {
  data: AnalyticsData;
  expandedIndex: string | null;
  setExpandedIndex: (v: string | null) => void;
}) {
  const { infrastructure, customMetrics, logs, integrations, synthetics, apm, observability, monitorBreakdown, sloBreakdown, governance, scorecard, rum, fleet } = data;

  return (
    <div className="space-y-10">

      {/* ── Key metrics ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Hosts" value={infrastructure.totalHosts} sub={infrastructure.hostTier} color="text-violet-700" />
        <StatCard label="Log Indexes" value={logs.totalIndexes} sub={`${logs.pipelines} pipelines`} color="text-blue-700" />
        <StatCard label="Integrations" value={integrations.total} sub={`${integrations.configured} configured`} color="text-green-700" />
        <StatCard label="APM Services" value={apm.totalServices} sub={`${apm.svcInCatalog} in catalog`} color="text-amber-700" />
        <StatCard label="Monitors" value={observability.monitors} sub={monitorBreakdown.mutedCount > 0 ? `${monitorBreakdown.mutedCount} muted` : 'none muted'} color={monitorBreakdown.mutedCount > 0 ? 'text-amber-700' : 'text-gray-900'} />
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
            <div className="font-semibold text-gray-800 text-sm">Host Footprint</div>
            <div className="text-4xl font-bold text-violet-700">{infrastructure.totalHosts}</div>
            <div className="text-xs text-gray-500">Tier: {infrastructure.hostTier}</div>
            {infrastructure.containers != null && (
              <div className="text-xs text-gray-500">Containers: {infrastructure.containers.toLocaleString()}</div>
            )}
            {infrastructure.cloudAccounts.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {infrastructure.cloudAccounts.map(ca => (
                  <span key={ca.provider} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {ca.provider}: {ca.n}
                  </span>
                ))}
              </div>
            )}
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">UST Coverage</div>
              {(['env', 'service', 'version', 'team'] as const).map(k => (
                <div key={k} className="flex items-center justify-between text-xs">
                  <code className="text-gray-600">{k}</code>
                  <CoveragePill pct={infrastructure.tagCoverage[k]} />
                </div>
              ))}
            </div>
          </div>

          {/* Custom metrics allotment */}
          <div className="card col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-gray-800 text-sm">Custom Metrics Allotment</div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                customMetrics.risk === 'high' ? 'bg-red-100 text-red-700'
                : customMetrics.risk === 'medium' ? 'bg-amber-100 text-amber-700'
                : 'bg-green-100 text-green-700'
              }`}>
                {customMetrics.risk.toUpperCase()} RISK
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xl font-bold text-gray-900">{customMetrics.estimated.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Estimated volume</div>
              </div>
              <div className="bg-violet-50 rounded-lg p-3">
                <div className="text-xl font-bold text-violet-700">{customMetrics.allotmentAt100PerHost.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Allotment @ 100/host</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-xl font-bold text-blue-700">{customMetrics.allotmentAt200PerHost.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Allotment @ 200/host</div>
              </div>
            </div>

            <Gauge pct={customMetrics.utilizationPct} label="Utilization vs 100/host allotment" risk={customMetrics.risk} />

            {customMetrics.topDrivers.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Top Cardinality Drivers</div>
                <div className="space-y-1.5">
                  {customMetrics.topDrivers.slice(0, 6).map(d => (
                    <div key={d.key} className="flex items-center gap-2">
                      <code className="text-xs text-violet-700 w-40 truncate shrink-0">{d.key}</code>
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full">
                        <div
                          className="h-full bg-violet-400 rounded-full"
                          style={{ width: `${Math.min((d.uniqueValues / (customMetrics.topDrivers[0]?.uniqueValues || 1)) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-20 text-right shrink-0">
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
              color={logs.totalDailyLimitEvents === 0 ? 'text-red-600' : 'text-gray-900'}
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
              color={logs.rateLimitedCount > 0 ? 'text-red-600' : 'text-gray-900'}
            />
          </div>

          {/* Retention distribution */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-gray-800 text-sm">Retention Distribution</div>
              <div className="flex gap-3 text-xs text-gray-400">
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
                <span key={label} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
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
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Index</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Retention</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Daily Limit</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Excl. Filters</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Filter Query</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.indexDetails.map(idx => (
                  <tr key={idx.name} className={`hover:bg-gray-50 ${expandedIndex === idx.name ? 'bg-violet-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-gray-800">{idx.name}</code>
                        {idx.isFlex && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Flex</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${
                        (idx.retentionDays ?? 0) > 90 ? 'text-red-600' :
                        (idx.retentionDays ?? 0) > 30 ? 'text-amber-700' : 'text-gray-700'
                      }`}>
                        {idx.retentionDays != null ? `${idx.retentionDays}d` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {idx.dailyLimitEvents != null
                        ? idx.dailyLimitEvents >= 1e6
                          ? `${(idx.dailyLimitEvents / 1e6).toFixed(0)}M`
                          : `${(idx.dailyLimitEvents / 1e3).toFixed(0)}K`
                        : <span className="text-red-500 font-semibold">∞ no limit</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${idx.exclusionFilters === 0 ? 'text-red-500' : 'text-green-700'}`}>
                        {idx.exclusionFilters}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">
                      <code>{idx.filterQuery || '*'}</code>
                    </td>
                    <td className="px-4 py-3">
                      {idx.isRateLimited && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Rate limited</span>
                      )}
                    </td>
                  </tr>
                ))}
                {logs.indexDetails.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-gray-400">No log indexes found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Synthetics ──────────────────────────────────────────────────────── */}
      {(synthetics.apiTests + synthetics.browserTests) > 0 && (
        <section>
          <SectionHeader title="Synthetics Usage" aiPrompt="Analyze this org's Datadog Synthetics usage. Review the mix of API vs browser tests, estimated monthly run volumes, test status distribution, and location spread. Browser tests cost significantly more than API tests. Identify opportunities to replace or consolidate browser tests with API tests where appropriate, flag tests with unusually high run volumes, and provide the top 3 recommendations to optimize synthetic test coverage while reducing costs." />
          <div className="grid grid-cols-4 gap-3 mb-4">
            <StatCard label="API Tests" value={synthetics.apiTests} />
            <StatCard label="Browser Tests" value={synthetics.browserTests} color={synthetics.browserTests > 0 ? 'text-amber-700' : 'text-gray-900'} />
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
              color={synthetics.browserTests / (synthetics.apiTests + synthetics.browserTests || 1) > 0.5 ? 'text-amber-700' : 'text-gray-900'}
            />
          </div>
          {synthetics.details.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Test</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Locations</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Est. Runs/mo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {synthetics.details.map((t, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-xs text-gray-800 max-w-xs truncate">{t.name}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          t.type === 'browser' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        }`}>{t.type}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">{t.status}</td>
                      <td className="px-4 py-2 text-xs text-right text-gray-600">{t.locations}</td>
                      <td className="px-4 py-2 text-xs text-right font-semibold text-gray-700">{t.estimatedMonthlyRuns.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <div className="font-semibold text-gray-800 text-sm">Summary</div>
            <div className="space-y-2">
              {[
                { label: 'Total detected', value: integrations.total, color: 'text-gray-900' },
                { label: 'Configured', value: integrations.configured, color: 'text-blue-700' },
                { label: 'Enabled', value: integrations.enabled, color: 'text-green-700' },
              ].map(r => (
                <div key={r.label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{r.label}</span>
                  <span className={`font-semibold ${r.color}`}>{r.value}</span>
                </div>
              ))}
            </div>
            {integrations.byType.length > 0 && (
              <div className="pt-2 border-t border-gray-100">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">By Type</div>
                <div className="flex flex-wrap gap-1">
                  {integrations.byType.map(t => (
                    <span key={t.type} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      {t.type}: {t.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card col-span-2 p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Integration</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Enabled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
                {integrations.list.map(i => (
                  <tr key={i.name} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs font-medium text-gray-800">{i.name}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{i.type ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{i.status ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        i.isEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {i.isEnabled ? 'Yes' : 'No'}
                      </span>
                    </td>
                  </tr>
                ))}
                {integrations.list.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-gray-400">No integrations found in this scan</td></tr>
                )}
              </tbody>
            </table>
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
              <div className="font-semibold text-gray-800 text-sm">Alert State Distribution</div>
              <div className="space-y-2">
                {Object.entries(monitorBreakdown.byState).sort((a, b) => b[1] - a[1]).map(([state, count]) => {
                  const pct = Math.round((count / monitorBreakdown.total) * 100);
                  const color = state === 'Alert' ? 'bg-red-400' : state === 'Warn' ? 'bg-amber-400' : state === 'No Data' ? 'bg-gray-300' : 'bg-green-400';
                  const textColor = state === 'Alert' ? 'text-red-700' : state === 'Warn' ? 'text-amber-700' : state === 'No Data' ? 'text-gray-500' : 'text-green-700';
                  return (
                    <div key={state}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600">{state}</span>
                        <span className={`font-semibold ${textColor}`}>{count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Type breakdown */}
            <div className="card space-y-3">
              <div className="font-semibold text-gray-800 text-sm">Monitor Types</div>
              <div className="space-y-1.5">
                {Object.entries(monitorBreakdown.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 capitalize">{type}</span>
                    <span className="font-semibold text-gray-800 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Coverage gaps */}
            <div className="card space-y-3">
              <div className="font-semibold text-gray-800 text-sm">Coverage Gaps</div>
              <div className="space-y-2">
                {[
                  { label: 'Muted', count: monitorBreakdown.mutedCount, risk: monitorBreakdown.mutedCount > 0 },
                  { label: 'No notification channel', count: monitorBreakdown.withoutNotification, risk: monitorBreakdown.withoutNotification > 0 },
                  { label: 'Missing env tag', count: monitorBreakdown.withoutEnvTag, risk: monitorBreakdown.withoutEnvTag > monitorBreakdown.total * 0.2 },
                  { label: 'Missing service tag', count: monitorBreakdown.withoutServiceTag, risk: monitorBreakdown.withoutServiceTag > monitorBreakdown.total * 0.2 },
                  { label: 'Missing team tag', count: monitorBreakdown.withoutTeamTag, risk: monitorBreakdown.withoutTeamTag > monitorBreakdown.total * 0.5 },
                ].map(({ label, count, risk }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">{label}</span>
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
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">SLO Tag Coverage</div>
              {(['env', 'service'] as const).map(tag => {
                const count = tag === 'env' ? sloBreakdown.withEnvTag : sloBreakdown.withServiceTag;
                const pct = sloBreakdown.total > 0 ? Math.round(count / sloBreakdown.total * 100) : 0;
                return (
                  <div key={tag} className="flex items-center justify-between text-xs">
                    <code className="text-gray-600">{tag}</code>
                    <CoveragePill pct={pct} />
                  </div>
                );
              })}
            </div>
            <div className="card space-y-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Service Coverage</div>
              <div className="text-xs text-gray-600">
                <span className="font-semibold text-gray-900">{apm.svcWithSLO}</span> of <span className="font-semibold text-gray-900">{apm.totalServices}</span> APM services have at least one SLO
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
            <div className="font-semibold text-gray-800 text-sm">Users & Access</div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-2xl font-bold text-gray-900">{governance.userCount ?? '—'}</div>
                <div className="text-xs text-gray-500 mt-0.5">Users</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-2xl font-bold text-blue-700">{governance.roleCount ?? '—'}</div>
                <div className="text-xs text-gray-500 mt-0.5">Roles</div>
              </div>
            </div>
          </div>

          {/* Governance findings */}
          <div className="card col-span-2 space-y-2">
            <div className="font-semibold text-gray-800 text-sm">Governance & Tagging Findings</div>
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
                    'bg-gray-50 border-gray-200 text-gray-700'
                  }`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`font-semibold uppercase text-[10px] px-1.5 py-0.5 rounded ${
                        f.severity === 'critical' ? 'bg-red-200 text-red-800' :
                        f.severity === 'high' ? 'bg-orange-200 text-orange-800' :
                        f.severity === 'medium' ? 'bg-amber-200 text-amber-800' :
                        'bg-gray-200 text-gray-700'
                      }`}>{f.severity}</span>
                      <span className="font-medium">{f.ruleName}</span>
                    </div>
                    <div className="text-gray-600">{f.description}</div>
                    {f.recommendation && <div className="mt-1 text-gray-500 italic">{f.recommendation}</div>}
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
                <div className="font-semibold text-gray-800 text-sm">Summary</div>
                <div className="text-4xl font-bold text-violet-700">{rum.total}</div>
                <div className="text-xs text-gray-500">RUM applications</div>
                {Object.keys(rum.byType).length > 0 && (
                  <div className="pt-2 border-t border-gray-100 space-y-1.5">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">By Type</div>
                    {Object.entries(rum.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between text-xs">
                        <span className="text-gray-600 capitalize">{type}</span>
                        <span className="font-semibold text-gray-800 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="card col-span-2 p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Application</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Framework</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rum.apps.map(app => (
                      <tr key={app.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-xs font-medium text-gray-800">{app.name ?? app.id}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            app.type === 'browser' ? 'bg-blue-100 text-blue-700' :
                            app.type === 'ios' ? 'bg-purple-100 text-purple-700' :
                            app.type === 'android' ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{app.type ?? 'unknown'}</span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">{app.framework ?? '—'}</td>
                        <td className="px-4 py-2 text-xs text-gray-400">
                          {app.createdAt ? new Date(app.createdAt).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
              <div className="font-semibold text-gray-800 text-sm">Agent Version Distribution</div>
              {Object.keys(fleet.agentVersions).length === 0 ? (
                <div className="text-xs text-gray-400">No version data</div>
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
                          <span className={`font-mono ${isOld ? 'text-red-600' : 'text-gray-700'}`}>Agent {ver}</span>
                          <span className={`font-semibold ${isOld ? 'text-red-600' : 'text-gray-600'}`}>{count} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
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
              <div className="font-semibold text-gray-800 text-sm">OS Platforms</div>
              {Object.keys(fleet.platforms).length === 0 ? (
                <div className="text-xs text-gray-400">No platform data</div>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(fleet.platforms).sort((a, b) => b[1] - a[1]).map(([platform, count]) => (
                    <div key={platform} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">{platform}</span>
                      <span className="font-semibold text-gray-800 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top installed checks */}
            <div className="card space-y-3">
              <div className="font-semibold text-gray-800 text-sm">Top Installed Checks</div>
              {fleet.installedChecks.length === 0 ? (
                <div className="text-xs text-gray-400">No check data</div>
              ) : (
                <div className="space-y-1.5">
                  {fleet.installedChecks.map(({ name, count }) => (
                    <div key={name} className="flex items-center justify-between text-xs">
                      <code className="text-gray-700">{name}</code>
                      <span className="font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{count} host{count > 1 ? 's' : ''}</span>
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
                  <div className="text-xs font-semibold text-gray-500 mt-1 uppercase tracking-wide">{scorecard.overallGrade.replace('_', ' ')}</div>
                </div>
                <div className="flex-1 grid grid-cols-3 md:grid-cols-5 gap-3">
                  {scorecard.categories.map(cat => (
                    <div key={cat.category} className="text-center">
                      <div className={`text-lg font-bold ${
                        cat.percentage >= 90 ? 'text-green-600' :
                        cat.percentage >= 70 ? 'text-amber-600' : 'text-red-600'
                      }`}>{cat.percentage}%</div>
                      <div className="text-[10px] text-gray-500 capitalize leading-tight mt-0.5">
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
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Top Findings
                </div>
                <div className="divide-y divide-gray-100">
                  {scorecard.topFindings.filter(f => f.severity !== 'info').map((f, i) => (
                    <div key={i} className="px-4 py-3 flex items-start gap-3">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                        f.severity === 'critical' ? 'bg-red-100 text-red-700' :
                        f.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                        f.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{f.severity}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-gray-800">{f.title || f.ruleName}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{f.description}</div>
                        {f.recommendation && (
                          <div className="text-xs text-violet-600 mt-1">→ {f.recommendation}</div>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0 ml-auto capitalize">
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
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <div className="flex-1 border-t border-gray-200" />
      {aiPrompt && <AISectionInsight section={title} prompt={aiPrompt} />}
    </div>
  );
}

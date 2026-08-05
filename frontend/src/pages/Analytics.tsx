import { useState } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl, ddUrl } from '../utils/ddUrl';
import { EmptyState } from '../components/common/LoadingState';
import { AISectionInsight } from '../components/analytics/AISectionInsight';
import { CostBadge, RecommendationList } from '../components/analytics/SegmentInsights';
import InfoTip from '../components/ui/InfoTip';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards } from '../components/ui/Skeleton';
import DataTable, { type Column } from '../components/common/DataTable';
import { CATEGORICAL, STATUS, sequentialStep, trackTint } from '../lib/chartColors';
import type { AnalyticsData, CostFigure } from '../types';

// Datadog products with no dedicated collector in this app yet — listed explicitly
// so scan-coverage gaps are answerable at a glance instead of silently omitted.
const UNCOVERED_PRODUCTS = [
  'Continuous Profiler', 'CI Visibility / Test Optimization', 'Application Security (ASM) detail',
  'Cloud SIEM', 'Sensitive Data Scanner', 'Universal Service Monitoring', 'Data Streams Monitoring',
  'Data Jobs Monitoring', 'LLM Observability', 'Serverless', 'Observability Pipelines',
  'On-Call', 'Feature Flags', 'Workflow Automation', 'Product Analytics',
];

// ── Mini components ────────────────────────────────────────────────────────────

type StatusSegment = { key: string; label: string; value: number; color: string };

function StatCard({ label, value, sub, color = 'text-ink', breakdown }: {
  label: string; value: string | number; sub?: string; color?: string; breakdown?: StatusSegment[];
}) {
  const total = breakdown?.reduce((s, seg) => s + seg.value, 0) ?? 0;
  return (
    <div className="card text-center py-4">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-xs font-semibold text-ink-muted mt-1">{label}</div>
      {sub && <div className="text-xs text-ink-faint mt-0.5">{sub}</div>}
      {breakdown && total > 0 && (
        <div className="mt-2.5">
          <div className="flex h-1.5 gap-0.5 rounded-full overflow-hidden">
            {breakdown.filter((seg) => seg.value > 0).map((seg) => (
              <div
                key={seg.key}
                title={`${seg.label}: ${seg.value.toLocaleString()} (${Math.round((seg.value / total) * 100)}%)`}
                style={{ width: `${(seg.value / total) * 100}%`, backgroundColor: seg.color }}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 mt-1.5">
            {breakdown.filter((seg) => seg.value > 0).map((seg) => (
              <span key={seg.key} className="inline-flex items-center gap-1 text-[10px] text-ink-faint">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                {seg.label} {seg.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function dashboardOwnershipSub(breakdown: AnalyticsData['observability']['dashboardBreakdown']): string | undefined {
  const [top, ...rest] = breakdown.byAuthor;
  const othersCount = rest.reduce((sum, a) => sum + a.count, 0);
  const parts: string[] = [];
  if (top) parts.push(`${top.count} by ${top.author.split('@')[0]}`);
  if (othersCount > 0) parts.push(`${othersCount} other${othersCount > 1 ? 's' : ''}`);
  if (breakdown.ootb > 0) parts.push(`${breakdown.ootb} OOTB`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function Gauge({ pct, label, risk }: { pct: number; label: string; risk: 'low' | 'medium' | 'high' }) {
  const color = risk === 'high' ? STATUS.critical : risk === 'medium' ? STATUS.warning : STATUS.good;
  const clamp = Math.min(pct, 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-muted mb-1">
        <span>{label}</span>
        <span className="font-semibold" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: trackTint(color) }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamp}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/**
 * A single bar divided into proportional, colored segments with a hover
 * tooltip per segment — used for any "share of total" breakdown where not
 * every segment is wide enough to carry its own direct label.
 */
// Cheap relative-luminance check so direct labels stay readable against
// both light sequential steps and saturated categorical/status hues.
function readableTextColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0b0b0b' : '#ffffff';
}

function ProportionBar({ segments, unitLabel = '' }: {
  segments: Array<{ key: string; label: string; value: number; color: string }>;
  unitLabel?: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div className="text-xs text-ink-faint">No data</div>;
  return (
    <div className="flex h-5 gap-0.5 bg-surface-sunken rounded-full">
      {segments.filter((seg) => seg.value > 0).map((seg, i, arr) => {
        const pct = (seg.value / total) * 100;
        return (
          <div
            key={seg.key}
            className={clsx(
              'group relative flex items-center justify-center transition-[filter] hover:brightness-110',
              i === 0 && 'rounded-l-full',
              i === arr.length - 1 && 'rounded-r-full'
            )}
            style={{ width: `${pct}%`, backgroundColor: seg.color }}
          >
            {pct > 12 && (
              <span className="text-xs font-semibold" style={{ color: readableTextColor(seg.color) }}>{seg.label}</span>
            )}
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded bg-gray-800 text-white border border-gray-700 text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-popover">
              {seg.label}: {seg.value.toLocaleString()}{unitLabel} ({Math.round(pct)}%)
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CoveragePill({ pct }: { pct: number }) {
  const cls = pct >= 80 ? 'bg-green-500/15 text-green-400' : pct >= 50 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400';
  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cls}`}>{pct}%</span>;
}

// Retention is an ordered magnitude (days ascending), not a set of independent
// categories — encoded as one sequential ramp (light = short retention, dark =
// long) rather than arbitrary per-bucket hues.
function RetentionBar({ dist }: { dist: Record<string, number> }) {
  const entries = Object.entries(dist).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  return (
    <ProportionBar
      unitLabel=" idx"
      segments={entries.map(([days, count], i) => ({
        key: days, label: days, value: count,
        color: sequentialStep(i, entries.length),
      }))}
    />
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
      {idx.isFlex && <span className="text-xs bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded font-medium">Flex</span>}
    </div>
  ) },
  { key: 'retentionDays', header: 'Retention', sortable: true, sortAccessor: (idx) => idx.retentionDays ?? 0, render: (idx) => (
    <span className={`text-xs font-semibold ${
      (idx.retentionDays ?? 0) > 90 ? 'text-red-400' :
      (idx.retentionDays ?? 0) > 30 ? 'text-amber-400' : 'text-ink-muted'
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
    <span className={`text-xs font-semibold ${idx.exclusionFilters === 0 ? 'text-red-500' : 'text-green-400'}`}>{idx.exclusionFilters}</span>
  ) },
  { key: 'filterQuery', header: 'Filter Query', render: (idx) => (
    <code className="text-xs text-ink-muted max-w-xs truncate block">{idx.filterQuery || '*'}</code>
  ) },
  { key: 'isRateLimited', header: 'Status', sortable: true, sortAccessor: (idx) => (idx.isRateLimited ? 1 : 0), render: (idx) => (
    idx.isRateLimited ? <span className="text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-medium">Rate limited</span> : null
  ) },
];

const syntheticsColumns: Column<SyntheticDetail>[] = [
  { key: 'name', header: 'Test', sortable: true, render: (t) => <span className="text-xs text-ink max-w-xs truncate block">{t.name}</span> },
  { key: 'type', header: 'Type', sortable: true, render: (t) => (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${t.type === 'browser' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'}`}>{t.type}</span>
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
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${i.isEnabled ? 'bg-green-500/15 text-green-400' : 'bg-surface-sunken text-ink-muted'}`}>{i.isEnabled ? 'Yes' : 'No'}</span>
  ) },
];

const rumColumns: Column<RumApp>[] = [
  { key: 'name', header: 'Application', sortable: true, sortAccessor: (a) => a.name ?? a.id, render: (a) => <span className="text-xs font-medium text-ink">{a.name ?? a.id}</span> },
  { key: 'type', header: 'Type', sortable: true, render: (a) => (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
      a.type === 'browser' ? 'bg-blue-500/15 text-blue-400' :
      a.type === 'ios' ? 'bg-emerald-500/15 text-emerald-400' :
      a.type === 'android' ? 'bg-green-500/15 text-green-400' : 'bg-surface-sunken text-ink-muted'
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

const SEGMENTS_KEY = 'dd-hc:analytics-segment';

function AnalyticsBody({ data }: { data: AnalyticsData }) {
  const { infrastructure, customMetrics, logs, integrations, synthetics, apm, observability, monitorBreakdown, sloBreakdown, governance, scorecard, rum, fleet, security, incidents, costManagement, productProxies } = data;
  const { orgs, selectedOrgId } = useOrgAndScanFilters();
  const orgBase = ddBaseUrl(orgs.find((o) => o.id === selectedOrgId)?.site ?? 'datadoghq.com');

  const segments = [
    { id: 'infra', label: 'Infrastructure', icon: '🖥️', available: true },
    { id: 'logs', label: 'Log Pipeline', icon: '📄', available: true },
    { id: 'synthetics', label: 'Synthetics', icon: '🌐', available: (synthetics.apiTests + synthetics.browserTests) > 0 },
    { id: 'apm', label: 'APM & Observability', icon: '🔵', available: true },
    { id: 'integrations', label: 'Integrations', icon: '🔌', available: true },
    { id: 'monitors', label: 'Monitor Intelligence', icon: '🔔', available: monitorBreakdown.total > 0 },
    { id: 'slo', label: 'SLO & Reliability', icon: '🎯', available: true },
    { id: 'governance', label: 'Governance & Access', icon: '🔐', available: true },
    { id: 'rum', label: 'RUM', icon: '📱', available: Boolean(rum) },
    {
      id: 'fleet', label: 'Fleet Management', icon: '🖧', available: Boolean(fleet) &&
        (Object.keys(fleet.agentVersions).length > 0 || Object.keys(fleet.platforms).length > 0 || fleet.installedChecks.length > 0),
    },
    { id: 'security', label: 'Security & Incidents', icon: '🛡️', available: Boolean(security) && (security.total > 0 || incidents.total > 0) },
    { id: 'proxies', label: 'DB & Network', icon: '🗄️', available: true },
    { id: 'gaps', label: 'Scan Coverage Gaps', icon: '❔', available: true },
    { id: 'scorecard', label: 'Scorecard', icon: '📋', available: Boolean(scorecard) },
  ];
  const visibleSegments = segments.filter((s) => s.available);

  const [rawActiveSegment, setActiveSegment] = useState(() => {
    try { return localStorage.getItem(SEGMENTS_KEY) ?? segments[0].id; } catch { return segments[0].id; }
  });
  const activeSegment = visibleSegments.some((s) => s.id === rawActiveSegment) ? rawActiveSegment : visibleSegments[0]?.id;

  function selectSegment(id: string) {
    setActiveSegment(id);
    try { localStorage.setItem(SEGMENTS_KEY, id); } catch { /* ignore */ }
  }

  return (
    <div className="space-y-10">

      {/* ── Key metrics — each broken down by status, not just a bare count ── */}
      <div className="section-card grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Hosts" value={infrastructure.totalHosts} sub={infrastructure.hostTier}
          breakdown={[
            { key: 'tagged', label: 'env-tagged', value: Math.round(infrastructure.totalHosts * infrastructure.tagCoverage.env / 100), color: STATUS.good },
            { key: 'untagged', label: 'untagged', value: infrastructure.totalHosts - Math.round(infrastructure.totalHosts * infrastructure.tagCoverage.env / 100), color: STATUS.critical },
          ]}
        />
        <StatCard
          label="Log Indexes" value={logs.totalIndexes} sub={`${logs.pipelines} pipelines`}
          breakdown={[
            { key: 'healthy', label: 'healthy', value: logs.totalIndexes - logs.rateLimitedCount, color: STATUS.good },
            { key: 'rate-limited', label: 'rate-limited', value: logs.rateLimitedCount, color: STATUS.critical },
          ]}
        />
        <StatCard
          label="Integrations" value={integrations.total} sub={`${integrations.installed} installed`}
          breakdown={[
            { key: 'installed', label: 'installed', value: integrations.installed, color: STATUS.good },
            { key: 'idle', label: 'idle', value: integrations.idle, color: STATUS.warning },
            { key: 'broken', label: 'broken', value: integrations.broken, color: STATUS.critical },
            { key: 'not-installed', label: 'not installed', value: integrations.notInstalled, color: STATUS.serious },
          ]}
        />
        <StatCard
          label="APM Services" value={apm.totalServices} sub={`${apm.svcInCatalog} in catalog`}
          breakdown={[
            { key: 'in-catalog', label: 'in catalog', value: apm.svcInCatalog, color: STATUS.good },
            { key: 'not-in-catalog', label: 'not in catalog', value: Math.max(apm.totalServices - apm.svcInCatalog, 0), color: STATUS.serious },
          ]}
        />
        <StatCard
          label="Monitors" value={observability.monitors}
          sub={monitorBreakdown.mutedCount > 0 ? `${monitorBreakdown.mutedCount} muted` : 'none muted'}
          color={monitorBreakdown.mutedCount > 0 ? 'text-amber-400' : undefined}
          breakdown={Object.entries(monitorBreakdown.byState).map(([state, count]) => ({
            key: state, label: state,
            value: count,
            color: state === 'Alert' ? STATUS.critical : state === 'Warn' ? STATUS.warning : state === 'No Data' ? STATUS.serious : STATUS.good,
          }))}
        />
        <StatCard
          label="SLOs" value={sloBreakdown.total} sub={Object.keys(sloBreakdown.byType).join(' · ') || 'none'}
          breakdown={Object.entries(sloBreakdown.byType).map(([type, count], i) => ({
            key: type, label: type, value: count, color: CATEGORICAL[i % CATEGORICAL.length],
          }))}
        />
        <StatCard
          label="Dashboards" value={observability.dashboards} sub={dashboardOwnershipSub(observability.dashboardBreakdown)}
          breakdown={[
            { key: 'custom', label: 'custom', value: Math.max(observability.dashboards - observability.dashboardBreakdown.ootb, 0), color: STATUS.good },
            { key: 'ootb', label: 'out-of-the-box', value: observability.dashboardBreakdown.ootb, color: CATEGORICAL[6] },
          ]}
        />
        {scorecard && <StatCard label="Health Score" value={`${scorecard.overallScore}%`} sub={scorecard.overallGrade} color={scorecard.overallScore >= 90 ? 'text-green-400' : scorecard.overallScore >= 70 ? 'text-amber-400' : 'text-red-400'} />}
      </div>

      {/* ── Segment tabs ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {visibleSegments.map((seg) => (
          <button
            key={seg.id}
            onClick={() => selectSegment(seg.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
              activeSegment === seg.id
                ? 'border-dd-purple text-dd-purple'
                : 'border-transparent text-ink-muted hover:text-ink hover:border-border-strong'
            )}
          >
            <span className="text-xs">{seg.icon}</span>
            {seg.label}
          </button>
        ))}
      </div>

      {/* ── Infrastructure & allotment ───────────────────────────────────── */}
      {activeSegment === 'infra' && (
      <section className="section-card">
        <SectionHeader title="Infrastructure & Allotment" category="unified_tagging" cost={infrastructure.cost} aiPrompt="Analyze this org's infrastructure and allotment data. Review the host count and tier, UST tag coverage (env, service, version, team), custom metrics utilization vs allotment, and top cardinality drivers. Identify the key cost risks, gaps in observability coverage, and the top 3 actionable recommendations to optimize infrastructure spending and tagging hygiene." />
        <div className="grid grid-cols-3 gap-4">

          {/* Host footprint */}
          <div className="card col-span-1 space-y-3">
            <div className="font-semibold text-ink text-sm flex items-center">
              Host Footprint
              <InfoTip text="Infra Hosts are billed per unique host reporting to Datadog each hour. Tier reflects fleet size, which drives default custom-metrics allotment below." />
            </div>
            <div className="text-4xl font-bold text-violet-400">{infrastructure.totalHosts}</div>
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
              <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide flex items-center">
                UST Coverage
                <InfoTip text="Unified Service Tagging: the % of hosts carrying env/service/version/team tags. This is the foundation every filter, dashboard, and cost-attribution view depends on." />
              </div>
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
              <div className="font-semibold text-ink text-sm flex items-center">
                Custom Metrics Allotment
                <InfoTip text="Every unique (metric name × tag-value combination) sent via DogStatsD, custom APM spans, or integrations counts as one billable custom metric. Volume above your contracted allotment bills on-demand, typically at a premium rate." />
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                customMetrics.risk === 'high' ? 'bg-red-500/15 text-red-400'
                : customMetrics.risk === 'medium' ? 'bg-amber-500/15 text-amber-400'
                : 'bg-green-500/15 text-green-400'
              }`}>
                {customMetrics.risk.toUpperCase()} RISK
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-surface-subtle rounded-lg p-3">
                <div className="text-xl font-bold text-ink">{customMetrics.estimated.toLocaleString()}</div>
                <div className="text-xs text-ink-muted">Estimated volume</div>
              </div>
              <div className="bg-violet-500/10 rounded-lg p-3">
                <div className="text-xl font-bold text-violet-400">{customMetrics.allotmentAt100PerHost.toLocaleString()}</div>
                <div className="text-xs text-ink-muted">Allotment @ 100/host</div>
              </div>
              <div className="bg-blue-500/10 rounded-lg p-3">
                <div className="text-xl font-bold text-blue-400">{customMetrics.allotmentAt200PerHost.toLocaleString()}</div>
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
                      <code className="text-xs text-ink-muted w-40 truncate shrink-0">{d.key}</code>
                      <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: trackTint(CATEGORICAL[6]) }}>
                        <div
                          className="h-full rounded-r-full transition-all"
                          style={{
                            width: `${Math.min((d.uniqueValues / (customMetrics.topDrivers[0]?.uniqueValues || 1)) * 100, 100)}%`,
                            backgroundColor: CATEGORICAL[6],
                          }}
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
        <div className="mt-3 grid grid-cols-2 gap-3">
          <RecommendationList items={infrastructure.recommendations} />
          <RecommendationList items={customMetrics.recommendations} />
        </div>
      </section>
      )}

      {/* ── Log pipeline ────────────────────────────────────────────────────── */}
      {activeSegment === 'logs' && (
      <section className="section-card">
        <SectionHeader title="Log Pipeline" category="logs_health" cost={logs.cost} aiPrompt="Analyze this org's log pipeline configuration. Review all log indexes, their retention periods, daily event limits, exclusion filters, and Flex tier usage. Identify indexes that are rate-limited, indexes without exclusion filters (cost risk), indexes with long retention that could be moved to Flex, and any pipeline gaps. Provide the top 3 recommendations to reduce log costs and improve pipeline efficiency." />
        <div className="space-y-4">

          {/* Summary row */}
          <div className="grid grid-cols-5 gap-3">
            <StatCard label="Log Indexes" value={logs.totalIndexes} />
            <StatCard label="Pipelines" value={logs.pipelines} sub={`${logs.enabledPipelines} enabled`} />
            <StatCard
              label="Daily Event Limit"
              value={logs.totalDailyLimitEvents > 0 ? (logs.totalDailyLimitEvents / 1e6).toFixed(0) + 'M' : '∞'}
              sub={logs.totalDailyLimitEvents === 0 ? 'Uncapped — cost risk' : 'events/day total'}
              color={logs.totalDailyLimitEvents === 0 ? 'text-red-400' : 'text-ink'}
            />
            <StatCard
              label="Exclusion Filters"
              value={logs.totalExclusionFilters}
              sub={logs.totalExclusionFilters === 0 ? '0% cost protection' : 'across all indexes'}
              color={logs.totalExclusionFilters === 0 ? 'text-red-400' : 'text-green-400'}
            />
            <StatCard
              label="Rate Limited"
              value={logs.rateLimitedCount}
              sub={logs.rateLimitedCount > 0 ? 'hitting daily cap' : 'none hitting cap'}
              color={logs.rateLimitedCount > 0 ? 'text-red-400' : 'text-ink'}
            />
          </div>

          <RecommendationList items={logs.recommendations} />

          {/* Retention distribution */}
          <div className="card">
            <div className="font-semibold text-ink text-sm flex items-center mb-3">
              Retention Distribution
              <InfoTip text="How long each index keeps logs searchable, shortest to longest. Longer retention costs more per GB indexed — Flex tier keeps long-retention data at a much lower cost for infrequent queries." />
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
              <div className="mt-3 text-xs bg-blue-500/10 border border-blue-500/30 text-blue-400 px-3 py-2 rounded-lg">
                ✓ {logs.flexIndexCount} Flex Log index{logs.flexIndexCount > 1 ? 'es' : ''} detected — warm-tier cost optimization active
              </div>
            )}
            {logs.flexIndexCount === 0 && logs.totalIndexes > 0 && (
              <div className="mt-3 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 px-3 py-2 rounded-lg">
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
            searchable
            pageSize={10}
          />
        </div>
      </section>
      )}

      {/* ── Synthetics ──────────────────────────────────────────────────────── */}
      {activeSegment === 'synthetics' && (synthetics.apiTests + synthetics.browserTests) > 0 && (
        <section className="section-card">
          <SectionHeader title="Synthetics Usage" category="synthetics_health" cost={synthetics.cost} aiPrompt="Analyze this org's Datadog Synthetics usage. Review the mix of API vs browser tests, estimated monthly run volumes, test status distribution, and location spread. Browser tests cost significantly more than API tests. Identify opportunities to replace or consolidate browser tests with API tests where appropriate, flag tests with unusually high run volumes, and provide the top 3 recommendations to optimize synthetic test coverage while reducing costs." />
          <div className="grid grid-cols-4 gap-3 mb-4">
            <StatCard label="API Tests" value={synthetics.apiTests} />
            <StatCard label="Browser Tests" value={synthetics.browserTests} color={synthetics.browserTests > 0 ? 'text-amber-400' : 'text-ink'} />
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
              color={synthetics.browserTests / (synthetics.apiTests + synthetics.browserTests || 1) > 0.5 ? 'text-amber-400' : 'text-ink'}
            />
          </div>
          <div className="mb-4">
            <RecommendationList items={synthetics.recommendations} />
          </div>
          {synthetics.details.length > 0 && (
            <DataTable
              columns={syntheticsColumns}
              data={synthetics.details}
              rowKey={(t) => t.name}
              tableId="analytics-synthetics"
              searchable
              pageSize={10}
            />
          )}
        </section>
      )}

      {/* ── APM & Observability ─────────────────────────────────────────────── */}
      {activeSegment === 'apm' && (
      <section className="section-card">
        <SectionHeader title="APM & Observability" category="service_architecture" cost={apm.cost} aiPrompt="Analyze this org's APM and observability maturity. Review the APM service count and what percentage are registered in the Service Catalog, how many services have monitors and SLOs configured, and the overall monitor and dashboard counts. Identify observability gaps (services without monitors, missing SLOs, low catalog coverage) and provide the top 3 recommendations to improve APM coverage, reliability tracking, and operational readiness." />
        <div className="grid grid-cols-6 gap-3">
          <StatCard label="APM Services" value={apm.totalServices} />
          <StatCard label="In Service Catalog" value={apm.svcInCatalog} sub={`${apm.totalServices > 0 ? Math.round(apm.svcInCatalog / apm.totalServices * 100) : 0}%`} />
          <StatCard label="With Monitor" value={apm.svcWithMonitor} />
          <StatCard label="With SLO" value={apm.svcWithSLO} />
          <StatCard label="Monitors" value={observability.monitors} />
          <StatCard label="Dashboards" value={observability.dashboards} sub={dashboardOwnershipSub(observability.dashboardBreakdown)} />
        </div>
        <div className="mt-3">
          <RecommendationList items={apm.recommendations} />
        </div>
      </section>
      )}

      {/* ── Integrations ────────────────────────────────────────────────────── */}
      {activeSegment === 'integrations' && (
      <section className="section-card">
        <SectionHeader title="Integrations" category="integration_hygiene" aiPrompt="Analyze this org's Datadog integration footprint. Review total integrations detected, how many are installed vs idle vs broken, the breakdown by integration type, and which specific integrations are present. Identify integrations that are configured but not enabled (potential waste or gaps), integrations with a broken/error status that need attention, critical integrations that may be missing based on the infrastructure in use (cloud providers, databases, etc.), and provide the top 3 recommendations to improve integration coverage and data collection." />
        <div className="grid grid-cols-3 gap-4">
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-ink text-sm flex items-center">
                Summary
                <InfoTip text="Installed: actively enabled and receiving data. Idle: configured but not enabled — a silent data gap. Broken: the last probe hit an error or permission problem. Not installed: nothing configured at all." />
              </div>
              <a
                href={ddUrl.integrations(orgBase)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-violet-400 hover:text-violet-300 font-medium shrink-0"
              >
                Open in Datadog ↗
              </a>
            </div>
            <div className="space-y-2">
              {[
                { label: 'Total detected', value: integrations.total, color: 'text-ink' },
                { label: 'Installed', value: integrations.installed, color: 'text-green-400' },
                { label: 'Idle', value: integrations.idle, color: 'text-amber-400' },
                { label: 'Broken', value: integrations.broken, color: 'text-red-400' },
                { label: 'Not installed', value: integrations.notInstalled, color: 'text-ink-faint' },
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

          <div className="col-span-2 space-y-3">
            <RecommendationList items={integrations.recommendations} />
            <div className="max-h-96 overflow-y-auto">
              <DataTable
                columns={integrationColumns}
                data={integrations.list}
                rowKey={(i) => i.name}
                emptyMessage="No integrations found in this scan"
                tableId="analytics-integrations"
                searchable
              />
            </div>
          </div>
        </div>
      </section>
      )}
      {/* ── Monitor Intelligence ─────────────────────────────────────────── */}
      {activeSegment === 'monitors' && monitorBreakdown.total > 0 && (
        <section className="section-card">
          <SectionHeader title="Monitor Intelligence" category="monitors_health" aiPrompt="Analyze this org's monitor configuration. Review the monitor state distribution (OK, Alert, No Data), type breakdown, muted monitors, monitors without notification channels, and monitors missing env/service/team tags. Identify the top risks (unnotified alerts, data gaps, muted monitors) and provide the top 3 recommendations to improve monitor coverage and reduce alert fatigue." />
          <div className="grid grid-cols-3 gap-4">

            {/* State distribution */}
            <div className="card space-y-3">
              <div className="font-semibold text-ink text-sm">Alert State Distribution</div>
              <div className="space-y-2">
                {Object.entries(monitorBreakdown.byState).sort((a, b) => b[1] - a[1]).map(([state, count]) => {
                  const pct = Math.round((count / monitorBreakdown.total) * 100);
                  const color = state === 'Alert' ? STATUS.critical : state === 'Warn' ? STATUS.warning : state === 'No Data' ? STATUS.serious : STATUS.good;
                  const textColor = state === 'Alert' ? 'text-red-400' : state === 'Warn' ? 'text-amber-400' : state === 'No Data' ? 'text-ink-muted' : 'text-green-400';
                  return (
                    <div key={state}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-ink-muted">{state}</span>
                        <span className={`font-semibold ${textColor}`}>{count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: trackTint(color) }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Type breakdown */}
            <div className="card space-y-3">
              <div className="font-semibold text-ink text-sm">Monitor Types</div>
              <div className="space-y-2">
                {Object.entries(monitorBreakdown.byType).sort((a, b) => b[1] - a[1]).map(([type, count], i) => {
                  const max = Math.max(...Object.values(monitorBreakdown.byType));
                  const color = CATEGORICAL[i % CATEGORICAL.length];
                  return (
                    <div key={type}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-ink-muted capitalize flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          {type}
                        </span>
                        <span className="font-semibold text-ink">{count}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: trackTint(color) }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${(count / max) * 100}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Coverage gaps */}
            <div className="card space-y-3">
              <div className="font-semibold text-ink text-sm flex items-center">
                Coverage Gaps
                <InfoTip text="Muted monitors don't alert at all. No-notification monitors alert into the void — nobody gets paged. Both are common causes of silently missed incidents." />
              </div>
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
                    <span className={`font-semibold px-2 py-0.5 rounded-full ${risk && count > 0 ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'}`}>
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-3">
            <RecommendationList items={monitorBreakdown.recommendations} />
          </div>
        </section>
      )}

      {/* ── SLO & Reliability ───────────────────────────────────────────────── */}
      {activeSegment === 'slo' && (
      <section className="section-card">
        <SectionHeader title="SLO & Reliability" aiPrompt="Analyze this org's SLO configuration. Review the SLO count, types (metric vs monitor-based), service coverage, and tagging hygiene on SLOs. Compare the number of SLOs against APM services to identify services missing reliability targets. Provide the top 3 recommendations to improve SLO coverage and reliability tracking." />
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total SLOs" value={sloBreakdown.total} color={sloBreakdown.total === 0 ? 'text-red-400' : undefined} sub={sloBreakdown.total === 0 ? 'None defined' : undefined} />
          <StatCard label="Metric SLOs" value={sloBreakdown.byType['metric'] ?? 0} />
          <StatCard label="Monitor SLOs" value={sloBreakdown.byType['monitor'] ?? 0} />
          <StatCard
            label="Services with SLO"
            value={apm.totalServices > 0 ? `${Math.round(apm.svcWithSLO / apm.totalServices * 100)}%` : '—'}
            sub={`${apm.svcWithSLO} / ${apm.totalServices}`}
            color={apm.totalServices > 0 && apm.svcWithSLO / apm.totalServices < 0.5 ? 'text-amber-400' : 'text-green-400'}
          />
        </div>
        {sloBreakdown.total === 0 && (
          <div className="mt-3 card bg-amber-500/10 border-amber-500/30 text-amber-400 text-sm">
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
                <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                  {apm.totalServices - apm.svcWithSLO} service{apm.totalServices - apm.svcWithSLO > 1 ? 's' : ''} have no SLO defined
                </div>
              )}
            </div>
          </div>
        )}
        <div className="mt-3">
          <RecommendationList items={sloBreakdown.recommendations} />
        </div>
      </section>
      )}

      {/* ── Governance & Access ─────────────────────────────────────────────── */}
      {activeSegment === 'governance' && (
      <section className="section-card">
        <SectionHeader title="Governance & Access" category="governance" aiPrompt="Analyze this org's governance and access control posture. Review the user count, role count, RBAC configuration, team structure, and unified tagging compliance findings. Identify governance gaps (missing teams, poor tag coverage, access control risks) and provide the top 3 recommendations to improve governance hygiene and team ownership visibility." />
        <div className="grid grid-cols-3 gap-4">

          {/* Users & roles */}
          <div className="card space-y-4">
            <div className="font-semibold text-ink text-sm flex items-center">
              Users & Access
              <InfoTip text="Role count is a proxy for access-control granularity — very few custom roles usually means broad, non-least-privilege access rather than fine-grained permissions." />
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-surface-subtle rounded-lg p-3">
                <div className="text-2xl font-bold text-ink">{governance.userCount ?? '—'}</div>
                <div className="text-xs text-ink-muted mt-0.5">Users</div>
              </div>
              <div className="bg-blue-500/10 rounded-lg p-3">
                <div className="text-2xl font-bold text-blue-400">{governance.roleCount ?? '—'}</div>
                <div className="text-xs text-ink-muted mt-0.5">Roles</div>
              </div>
            </div>
          </div>

          {/* Governance findings */}
          <div className="card col-span-2 space-y-2">
            <div className="font-semibold text-ink text-sm">Governance & Tagging Findings</div>
            {governance.findings.length === 0 ? (
              <div className="text-xs text-green-400 bg-green-500/10 border border-green-500/30 rounded px-3 py-2">
                ✓ No governance or tagging findings — org is in good shape
              </div>
            ) : (
              <div className="space-y-2">
                {governance.findings.map((f, i) => (
                  <div key={i} className={`rounded-lg px-3 py-2 border text-xs ${
                    f.severity === 'critical' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                    f.severity === 'high' ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' :
                    f.severity === 'medium' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                    'bg-surface-subtle border-border text-ink-muted'
                  }`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`font-semibold uppercase text-[10px] px-1.5 py-0.5 rounded ${
                        f.severity === 'critical' ? 'bg-red-200 text-red-400' :
                        f.severity === 'high' ? 'bg-orange-200 text-orange-400' :
                        f.severity === 'medium' ? 'bg-amber-200 text-amber-400' :
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
        <div className="mt-3">
          <RecommendationList items={governance.recommendations} />
        </div>
      </section>
      )}

      {/* ── RUM Applications ────────────────────────────────────────────────── */}
      {activeSegment === 'rum' && rum && (
        <section className="section-card">
          <SectionHeader title="Real User Monitoring (RUM)" cost={rum.cost} aiPrompt="Analyze this org's RUM application configuration. Review the number of RUM applications, their types (browser, iOS, Android, Flutter, React Native), and framework coverage. Identify any missing application types that should be instrumented based on the org's tech stack, highlight gaps in mobile vs web coverage, and provide the top 3 recommendations to improve frontend observability and session replay value." />
          {rum.total === 0 ? (
            <div className="card bg-amber-500/10 border-amber-500/30 text-amber-400 text-sm">
              No RUM applications detected. RUM provides frontend performance visibility, error tracking, and session replay — consider instrumenting your web and mobile apps.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <div className="card space-y-3">
                <div className="font-semibold text-ink text-sm">Summary</div>
                <div className="text-4xl font-bold text-violet-400">{rum.total}</div>
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
              <div className="col-span-2 space-y-3">
                <RecommendationList items={rum.recommendations} />
                <DataTable
                  columns={rumColumns}
                  data={rum.apps}
                  rowKey={(app) => app.id}
                  tableId="analytics-rum-apps"
                  searchable
                  pageSize={10}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Fleet Management ─────────────────────────────────────────────────── */}
      {activeSegment === 'fleet' && fleet && (Object.keys(fleet.agentVersions).length > 0 || Object.keys(fleet.platforms).length > 0 || fleet.installedChecks.length > 0) && (
        <section className="section-card">
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
                          <span className={`font-mono ${isOld ? 'text-red-400' : 'text-ink-muted'}`}>Agent {ver}</span>
                          <span className={`font-semibold ${isOld ? 'text-red-400' : 'text-ink-muted'}`}>{count} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: trackTint(isOld ? STATUS.critical : STATUS.good) }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: isOld ? STATUS.critical : STATUS.good }}
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
          <div className="mt-3">
            <RecommendationList items={fleet.recommendations} />
          </div>
        </section>
      )}

      {/* ── Security Posture ─────────────────────────────────────────────────── */}
      {activeSegment === 'security' && security && (security.total > 0 || incidents.total > 0) && (
        <section className="section-card">
          <SectionHeader title="Security Posture & Incidents" category="security_posture" cost={security.cost} aiPrompt="Analyze this org's security findings (CSPM/AppSec/Cloud SIEM) and incident management data. Identify unresolved critical/high findings, stale open incidents, and any cloud providers missing Cloud Cost Management configuration. Provide the top 3 recommendations to reduce security risk and improve incident response hygiene." />
          <div className="grid grid-cols-3 gap-4 mb-4">
            <StatCard label="Security Findings" value={security.total} sub={security.unresolvedCritical > 0 ? `${security.unresolvedCritical} unresolved critical/high` : 'none critical/high open'} color={security.unresolvedCritical > 0 ? 'text-red-400' : 'text-ink'} />
            <StatCard label="Open Incidents" value={incidents.open} sub={`${incidents.total} total`} color={incidents.open > 0 ? 'text-amber-400' : 'text-ink'} />
            <StatCard label="Cloud Cost Mgmt" value={`${costManagement.providers.filter((p) => p.configured).length}/${costManagement.providers.length || 0}`} sub="providers configured" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="card space-y-2">
              <div className="font-semibold text-ink text-sm">Findings by Severity</div>
              {Object.keys(security.bySeverity).length === 0 ? (
                <div className="text-xs text-ink-faint">No findings detected</div>
              ) : (
                Object.entries(security.bySeverity).sort((a, b) => b[1] - a[1]).map(([sev, n]) => (
                  <div key={sev} className="flex justify-between text-xs">
                    <span className="text-ink-muted capitalize">{sev}</span>
                    <span className="font-semibold text-ink">{n}</span>
                  </div>
                ))
              )}
            </div>
            <div className="card space-y-2">
              <div className="font-semibold text-ink text-sm flex items-center">
                Findings by Product (CSPM/ASM/etc)
                <InfoTip text="CSPM (Cloud Security Posture Mgmt) flags misconfigured cloud resources. CWS (Cloud Workload Security) flags runtime threats on hosts. ASM (App Sec Mgmt) flags application-layer vulnerabilities." />
              </div>
              {Object.keys(security.byCategory).length === 0 ? (
                <div className="text-xs text-ink-faint">No findings detected</div>
              ) : (
                Object.entries(security.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
                  <div key={cat} className="flex justify-between text-xs">
                    <span className="text-ink-muted uppercase">{cat}</span>
                    <span className="font-semibold text-ink">{n}</span>
                  </div>
                ))
              )}
            </div>
            <div className="card space-y-2">
              <div className="font-semibold text-ink text-sm">Incidents by Severity</div>
              {Object.keys(incidents.bySeverity).length === 0 ? (
                <div className="text-xs text-ink-faint">No incidents detected</div>
              ) : (
                Object.entries(incidents.bySeverity).sort((a, b) => b[1] - a[1]).map(([sev, n]) => (
                  <div key={sev} className="flex justify-between text-xs">
                    <span className="text-ink-muted capitalize">{sev}</span>
                    <span className="font-semibold text-ink">{n}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="mt-3">
            <RecommendationList items={security.recommendations} />
          </div>
        </section>
      )}

      {/* ── Database / Network Monitoring proxy detection ─────────────────── */}
      {activeSegment === 'proxies' && (
      <section className="section-card">
        <SectionHeader title="Database & Network Monitoring Signals" category="network_cloud" cost={productProxies.cost} aiPrompt="Analyze the inferred DBM (Database Monitoring), CNM (Cloud Network Monitor, formerly Network Performance Monitoring), and NDM (Network Device Monitoring) signals, which are proxy-detected from matching integration names since there is no dedicated collector for these products. Note that a 0 count may mean the product isn't in use or simply isn't detectable by this heuristic. Suggest what to manually verify." />
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="DBM (proxy)" value={productProxies.dbm} sub="Postgres/MySQL/Oracle/MongoDB/SQL Server integrations" color={productProxies.dbm > 0 ? 'text-green-400' : 'text-ink-faint'} />
          <StatCard label="CNM (proxy)" value={productProxies.npm} sub="Network integrations matched" color={productProxies.npm > 0 ? 'text-green-400' : 'text-ink-faint'} />
          <StatCard label="NDM (proxy)" value={productProxies.ndm} sub="SNMP/device integrations matched" color={productProxies.ndm > 0 ? 'text-green-400' : 'text-ink-faint'} />
        </div>
        <div className="mt-3">
          <RecommendationList items={productProxies.recommendations} />
        </div>
      </section>
      )}

      {/* ── Honest gap list ─────────────────────────────────────────────────── */}
      {activeSegment === 'gaps' && (
      <section className="section-card">
        <div className="card">
          <h2 className="text-sm font-semibold text-ink mb-1">Not Yet Covered by This Scan</h2>
          <p className="text-xs text-ink-faint mb-3">
            These Datadog products have no dedicated collector in this tool yet, so analytics above can't
            reflect them — this is a gap in this app's scan coverage, not necessarily in your org.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {UNCOVERED_PRODUCTS.map((p) => (
              <div key={p} className="text-xs bg-surface-subtle rounded px-2 py-1.5 text-ink-muted">{p}</div>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* ── Health Scorecard ─────────────────────────────────────────────────── */}
      {activeSegment === 'scorecard' && scorecard && (
        <section className="section-card">
          <SectionHeader title="Health Scorecard" aiPrompt="Review this org's overall Datadog health scorecard. Analyze the overall score and grade, individual category scores (tagging, monitors, logs, dashboards, synthetics, integrations, governance), and the top findings across all categories. Prioritize the highest-severity issues and provide the top 3 most impactful improvements the team should tackle first to raise the overall health score." />
          <div className="space-y-4">

            {/* Overall score */}
            <div className="card">
              <div className="flex items-center gap-6">
                <div className="text-center shrink-0">
                  <div className={`text-5xl font-bold ${
                    scorecard.overallScore >= 90 ? 'text-green-400' :
                    scorecard.overallScore >= 70 ? 'text-amber-400' : 'text-red-400'
                  }`}>{scorecard.overallScore}%</div>
                  <div className="text-xs font-semibold text-ink-muted mt-1 uppercase tracking-wide">{scorecard.overallGrade.replace('_', ' ')}</div>
                </div>
                <div className="flex-1 grid grid-cols-3 md:grid-cols-5 gap-3">
                  {scorecard.categories.map(cat => (
                    <div key={cat.category} className="text-center">
                      <div className={`text-lg font-bold ${
                        cat.percentage >= 90 ? 'text-green-400' :
                        cat.percentage >= 70 ? 'text-amber-400' : 'text-red-400'
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
                        f.severity === 'critical' ? 'bg-red-500/15 text-red-400' :
                        f.severity === 'high' ? 'bg-orange-500/15 text-orange-400' :
                        f.severity === 'medium' ? 'bg-amber-500/15 text-amber-400' :
                        'bg-surface-sunken text-ink-muted'
                      }`}>{f.severity}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-ink">{f.title || f.ruleName}</div>
                        <div className="text-xs text-ink-muted mt-0.5">{f.description}</div>
                        {f.recommendation && (
                          <div className="text-xs text-violet-400 mt-1">→ {f.recommendation}</div>
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

function SectionHeader({ title, aiPrompt, category, cost }: { title: string; aiPrompt?: string; category?: string; cost?: CostFigure | null }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <CostBadge cost={cost} />
      <div className="flex-1 border-t border-border" />
      {aiPrompt && <AISectionInsight section={title} prompt={aiPrompt} category={category} />}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { usageApi, scansApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import type { UsageProductSummary } from '../types';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton';
import DataTable, { type Column } from '../components/common/DataTable';
import EvidenceTable from '../components/common/EvidenceTable';
import { CATEGORICAL, CHART_INK, trackTint } from '../lib/chartColors';
import SectionGate from '../components/SectionGate';

function fmt(value: number | null, unit: string): string {
  if (value === null) return '—';
  if (unit.includes('bytes')) {
    if (value >= 1e12) return `${(value / 1e12).toFixed(1)} TB`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
    return `${value.toLocaleString()} B`;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function money(n: number) {
  return n > 0 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '';
}

// Friendly labels for the usage_summary metric keys Datadog's usage API commonly returns.
// Not exhaustive — any numeric key not listed here still renders via humanizeMetricKey().
const KNOWN_USAGE_METRICS: Array<{ label: string; key: string; unit: string }> = [
  { label: 'Infra Hosts (p99)', key: 'agent_host_top99p', unit: 'hosts' },
  { label: 'APM Hosts (p99)', key: 'apm_host_top99p', unit: 'hosts' },
  { label: 'Containers (avg)', key: 'container_avg', unit: 'containers' },
  { label: 'Custom Metrics (avg)', key: 'custom_ts_avg', unit: 'timeseries' },
  { label: 'RUM Sessions', key: 'rum_total_sessions_sum', unit: 'sessions' },
  { label: 'Log Ingestion', key: 'logs_ingested_bytes_sum', unit: 'bytes ingested' },
  { label: 'Log Indexed Events', key: 'indexed_events_count_sum', unit: 'events' },
  { label: 'Synthetics API Tests', key: 'synthetics_check_calls_count_sum', unit: 'calls' },
  { label: 'Synthetics Browser Tests', key: 'synthetics_browser_check_calls_count_sum', unit: 'calls' },
  { label: 'Cloud Network Mon. Hosts (p99)', key: 'npm_host_top99p', unit: 'hosts' },
  { label: 'NDM Devices (p99)', key: 'ndm_router_top99p', unit: 'devices' },
  { label: 'CSPM Hosts (p99)', key: 'cspm_host_top99p', unit: 'hosts' },
  { label: 'CWS Hosts (p99)', key: 'cws_host_top99p', unit: 'hosts' },
  { label: 'ASM Hosts (p99)', key: 'appsec_host_top99p', unit: 'hosts' },
  { label: 'Profiled Hosts (p99)', key: 'profiling_host_top99p', unit: 'hosts' },
  { label: 'CI Pipeline Indexed Spans', key: 'ci_pipeline_indexed_spans_sum', unit: 'spans' },
  { label: 'CI Test Indexed Spans', key: 'ci_test_indexed_spans_sum', unit: 'spans' },
  { label: 'Fargate Tasks (avg)', key: 'fargate_tasks_count_avg', unit: 'tasks' },
  { label: 'Lambda Functions', key: 'lambda_functions_count', unit: 'functions' },
  { label: 'Lambda Invocations', key: 'lambda_invocations_sum', unit: 'invocations' },
  { label: 'DBM Hosts (avg)', key: 'dbm_host_count_avg', unit: 'hosts' },
  { label: 'Estimated On-Demand Cost', key: 'estimated_on_demand_cost', unit: 'USD' },
];

function humanizeMetricKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b(sum|avg|count|top99p|top95p)\b/gi, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const productColumns: Column<UsageProductSummary>[] = [
  { key: 'name', header: 'Product', sortable: true, render: (p) => (
    <div className="flex items-center gap-2">
      {p.hasOnDemand && <span className="text-red-500 text-xs font-bold">ON-DEMAND</span>}
      <span className="font-medium text-ink text-sm">{p.name}</span>
    </div>
  ) },
  { key: 'value', header: 'Usage', sortable: true, sortAccessor: (p) => p.value ?? -1, render: (p) => (
    <div className="text-right">
      {p.value !== null ? (
        <span title={`${p.value.toLocaleString()} ${p.unit}`} className="font-mono text-sm text-ink-muted">{fmt(p.value, p.unit)}</span>
      ) : (
        <span className="text-ink-faint text-xs">no data</span>
      )}
    </div>
  ) },
  { key: 'unit', header: 'Unit', render: (p) => <span className="text-sm text-ink-muted">{p.value !== null ? p.unit : ''}</span> },
  { key: 'committedCost', header: 'Committed', sortable: true, render: (p) => <span className="font-mono text-sm text-green-400">{money(p.committedCost)}</span> },
  { key: 'onDemandCost', header: 'On-Demand', sortable: true, render: (p) => (
    p.hasOnDemand ? <span className="font-mono text-sm text-red-400 font-semibold">{money(p.onDemandCost)}</span> : <span className="text-ink-faint">—</span>
  ) },
  { key: 'status', header: 'Status', render: (p) => {
    const totalCost = p.committedCost + p.onDemandCost;
    const onDemandPct = totalCost > 0 ? (p.onDemandCost / totalCost) * 100 : 0;
    if (p.hasOnDemand) {
      return (
        <div className="flex items-center gap-2 min-w-32">
          <div className="flex-1 bg-surface-sunken rounded-full h-2">
            <div className="bg-red-500 h-2 rounded-full" style={{ width: `${Math.min(100, onDemandPct)}%` }} />
          </div>
          <span className="text-xs text-red-400 font-medium whitespace-nowrap">{onDemandPct.toFixed(0)}% OD</span>
        </div>
      );
    }
    if (totalCost > 0) return <span className="text-xs text-green-400 font-medium">✓ In allotment</span>;
    return <span className="text-xs text-ink-faint">—</span>;
  } },
];

const chargeColumns: Column<{ charge_type: string; product_name: string; cost: number }>[] = [
  { key: 'product_name', header: 'Product', sortable: true, render: (c) => <span className="text-sm text-ink">{c.product_name}</span> },
  { key: 'charge_type', header: 'Type', sortable: true, render: (c) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.charge_type === 'on_demand' ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'}`}>
      {c.charge_type === 'on_demand' ? 'On-Demand' : 'Committed'}
    </span>
  ) },
  { key: 'cost', header: 'Cost', sortable: true, render: (c) => <span className="font-mono text-sm font-semibold text-ink">{money(c.cost)}</span> },
];

function ProductSpendGraph({ orgId, productName }: { orgId: string; productName: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['usage-product-cost-history', orgId, productName],
    queryFn: () => usageApi.productCostHistory(orgId, productName),
    enabled: Boolean(orgId && productName),
  });

  if (isLoading) {
    return <div className="text-xs text-ink-faint py-2">Loading {productName}'s spend history…</div>;
  }

  const history = data?.history ?? [];
  if (history.length < 2) {
    return (
      <div className="text-xs text-ink-faint py-2">
        Not enough scan history yet to chart {productName}'s spend over time — each completed scan adds one
        month to this graph, so it fills in as you re-run scans.
      </div>
    );
  }

  return (
    <div className="py-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-ink-muted">{productName} — spend by month</span>
        <div className="flex items-center gap-3 text-[11px] text-ink-faint">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Committed</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> On-demand</span>
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barCategoryGap="25%">
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => m.slice(5)}
              tick={{ fontSize: 10, fill: CHART_INK.muted }}
              axisLine={{ stroke: CHART_INK.gridline }}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(15, 23, 42, 0.06)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as { month: string; committedCost: number; onDemandCost: number; totalCost: number };
                return (
                  <div className="bg-gray-800 text-white border border-gray-700 text-xs px-2.5 py-1.5 rounded shadow-popover whitespace-nowrap">
                    <div className="font-semibold mb-0.5">{p.month}</div>
                    <div className="text-green-400">Committed: {money(p.committedCost) || '$0'}</div>
                    {p.onDemandCost > 0 && <div className="text-red-400">On-demand: {money(p.onDemandCost)}</div>}
                    <div className="text-ink-faint mt-0.5">Total: {money(p.totalCost) || '$0'}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="committedCost" stackId="cost" name="Committed" fill="#4ade80" />
            <Bar dataKey="onDemandCost" stackId="cost" name="On-Demand" fill="#f87171" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function UsageBarChart({ history, metricKey, unit }: {
  history: Array<Record<string, unknown>>;
  metricKey: string;
  unit: string;
}) {
  const points = history.map(m => ({
    month: typeof m.date === 'string' ? m.date.slice(0, 7) : '?',
    value: typeof m[metricKey] === 'number' ? (m[metricKey] as number) : 0,
  }));
  if (points.every(p => p.value === 0)) return null;
  return (
    <div className="h-14">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 2, right: 4, bottom: 0, left: 4 }} barCategoryGap="20%">
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => m.slice(5)}
            tick={{ fontSize: 9, fill: CHART_INK.muted }}
            axisLine={{ stroke: CHART_INK.gridline }}
            tickLine={false}
            interval={points.length > 8 ? 1 : 0}
          />
          <Tooltip
            cursor={{ fill: 'rgba(15, 23, 42, 0.06)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { month: string; value: number };
              return (
                <div className="bg-gray-800 text-white border border-gray-700 text-xs px-2 py-1 rounded shadow-popover whitespace-nowrap">
                  {p.month}: <span className="font-semibold">{fmt(p.value, unit)}</span>
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {points.map((p, i) => (
              <Cell key={i} fill={i === points.length - 1 ? CATEGORICAL[0] : trackTint(CATEGORICAL[0], 0.35)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Usage() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const { data, isLoading, error } = useQuery({
    queryKey: ['usage', selectedOrgId, selectedScanId],
    queryFn: () => usageApi.get(selectedOrgId, selectedScanId || undefined),
    enabled: Boolean(selectedOrgId),
  });

  const { data: costFindings = [] } = useQuery({
    queryKey: ['findings', selectedScanId, 'cost_optimization'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'cost_optimization' }),
    enabled: Boolean(selectedScanId),
  });

  if (!selectedOrgId) {
    return (
      <div className="max-w-5xl mx-auto">
        <PageHeader title="Plan & Usage" subtitle="Current consumption vs. contracted allotments and on-demand charges" />
        <div className="card text-center py-16 text-ink-faint">
          <div className="text-4xl mb-3">📊</div>
          <div className="font-semibold text-ink-muted">Select an organization to view usage data</div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <PageHeader title="Plan & Usage" subtitle="Current consumption vs. contracted allotments and on-demand charges" />
        <SkeletonCards count={3} />
        <SkeletonTable rows={6} cols={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <PageHeader title="Plan & Usage" subtitle="Current consumption vs. contracted allotments and on-demand charges" />
        <div className="card text-center py-16">
          <div className="text-4xl mb-3">📭</div>
          <div className="font-semibold text-ink mb-2">No usage data available yet</div>
          <div className="text-sm text-ink-muted max-w-md mx-auto">
            Run a new scan to collect usage data from the Datadog Usage API.
            The usage collector requires <strong>Usage Read</strong> permissions on your app key.
          </div>
        </div>
      </div>
    );
  }

  const onDemandProducts = data.products.filter(p => p.hasOnDemand);
  const inAllotmentProducts = data.products.filter(p => !p.hasOnDemand && (p.committedCost > 0 || p.value !== null));
  const orderedProducts = [...onDemandProducts, ...inAllotmentProducts];
  const totalCommitted = data.costCharges.filter(c => c.charge_type === 'committed').reduce((s, c) => s + c.cost, 0);
  const totalOnDemand = data.costCharges.filter(c => c.charge_type === 'on_demand').reduce((s, c) => s + c.cost, 0);
  const totalCost = totalCommitted + totalOnDemand;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Plan & Usage"
        subtitle={`${data.reportMonth} usage — collected ${new Date(data.collectedAt).toLocaleDateString()}`}
        actions={onDemandProducts.length > 0 ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2 text-right">
            <div className="text-xs text-red-500 font-semibold uppercase tracking-wide">On-Demand Charges</div>
            <div className="text-xl font-bold text-red-400">{money(totalOnDemand)}</div>
            <div className="text-xs text-red-400">{onDemandProducts.length} product{onDemandProducts.length !== 1 ? 's' : ''} over allotment</div>
          </div>
        ) : undefined}
      />

      {/* Cost summary cards */}
      {totalCost > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card border-l-4 border-dd-purple text-center py-4">
            <div className="text-xs text-ink-muted uppercase tracking-wide mb-1">Total Estimated Cost</div>
            <div className="text-2xl font-bold text-ink">{money(totalCost)}</div>
            <div className="text-xs text-ink-faint mt-1">{data.reportMonth}</div>
          </div>
          <div className="card border-l-4 border-green-400 bg-green-500/5 text-center py-4">
            <div className="text-xs text-green-500 uppercase tracking-wide mb-1">Committed Spend</div>
            <div className="text-2xl font-bold text-green-400">{money(totalCommitted)}</div>
            <div className="text-xs text-ink-faint mt-1">In-allotment usage</div>
          </div>
          <div className={`card border-l-4 text-center py-4 ${totalOnDemand > 0 ? 'border-red-400 bg-red-500/10' : 'border-border'}`}>
            <div className="text-xs text-red-500 uppercase tracking-wide mb-1">On-Demand Charges</div>
            <div className={`text-2xl font-bold ${totalOnDemand > 0 ? 'text-red-400' : 'text-ink-faint'}`}>{totalOnDemand > 0 ? money(totalOnDemand) : '$0'}</div>
            <div className="text-xs text-ink-faint mt-1">{totalOnDemand > 0 ? 'Overage charges' : 'No overages'}</div>
          </div>
        </div>
      )}

      {/* On-demand alert */}
      {onDemandProducts.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-red-500">⚠</span>
            <span className="font-semibold text-red-400">On-Demand Charges Detected</span>
          </div>
          <p className="text-sm text-red-400 mb-3">
            The following products are generating on-demand charges above your contracted allotment.
            These are typically billed at 1.5–3× the standard committed rate.
          </p>
          <div className="flex flex-wrap gap-2">
            {onDemandProducts.map(p => (
              <div key={p.name} className="bg-surface-subtle border border-red-500/30 rounded-lg px-3 py-1.5 text-xs">
                <span className="font-semibold text-red-400">{p.name}</span>
                <span className="text-red-500 ml-1">+{money(p.onDemandCost)}/mo</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cost insights — root-cause correlation with tagging/config data, informational only */}
      {costFindings.length > 0 && (
        <SectionGate featureKey="section.usage.cost_insights">
          <div className="card border-l-4 border-amber-400 bg-amber-500/5 space-y-2">
            <div>
              <h2 className="font-bold text-ink">Cost Insights</h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Contributing factors behind this spend, correlated from tagging and configuration data collected in this scan. Informational — does not affect the overall health score.
              </p>
            </div>
            <EvidenceTable findings={costFindings} />
          </div>
        </SectionGate>
      )}

      {/* Product table */}
      <SectionGate featureKey="section.usage.product_breakdown">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-ink">Product Usage Breakdown</h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Usage metrics and estimated costs by product for {data.reportMonth}. Expand a billed product (▸) for its own spend-over-time graph.
              </p>
            </div>
            {data.products.length > 0 && (
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> In allotment</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> On-demand</span>
              </div>
            )}
          </div>
          {data.products.length > 0 ? (
            <DataTable
              columns={productColumns}
              data={orderedProducts}
              rowKey={(p) => p.name}
              tableId="usage-products"
              searchable
              pageSize={10}
              expandable={(p) => p.committedCost > 0 || p.onDemandCost > 0}
              expandedRowRender={(p) => <ProductSpendGraph orgId={selectedOrgId} productName={p.name} />}
            />
          ) : (
            <div className="card text-center py-10 text-ink-faint text-sm">
              No product usage data found in this scan.
            </div>
          )}
        </div>
      </SectionGate>

      {/* Usage trends (history sparklines) */}
      {data.usageHistory.length > 1 && (() => {
        const shown = new Set<string>();
        const curatedTiles = KNOWN_USAGE_METRICS
          .filter(({ key }) => typeof data.latestUsage[key] === 'number')
          .map(({ label, key, unit }) => { shown.add(key); return { label, key, unit }; });

        // Any other numeric usage-history key this scan collected but that isn't in the
        // curated list above — surfaced rather than silently dropped, since the backend
        // already returns every usage_summary metric with no allowlist.
        const extraTiles = Object.entries(data.latestUsage)
          .filter(([key, val]) => typeof val === 'number' && !shown.has(key))
          .map(([key]) => ({ label: humanizeMetricKey(key), key, unit: '' }));

        const tiles = [...curatedTiles, ...extraTiles];
        if (tiles.length === 0) return null;

        return (
          <SectionGate featureKey="section.usage.usage_trends">
            <div className="card border-l-4 border-dd-purple">
              <h2 className="font-bold text-ink mb-4">Usage Trends — Last {data.usageHistory.length} Months</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                {tiles.map(({ label, key, unit }) => {
                  const latestVal = typeof data.latestUsage[key] === 'number' ? (data.latestUsage[key] as number) : null;
                  if (latestVal === null) return null;
                  return (
                    <div key={key}>
                      <div className="text-xs font-semibold text-ink-muted mb-1">{label}</div>
                      <div className="text-lg font-bold text-ink font-mono mb-1">{fmt(latestVal, unit)}</div>
                      <UsageBarChart history={data.usageHistory} metricKey={key} unit={unit} />
                    </div>
                  );
                })}
              </div>
            </div>
          </SectionGate>
        );
      })()}

      {/* Raw charges table (if cost data available) */}
      {data.costCharges.length > 0 && (
        <SectionGate featureKey="section.usage.all_charges">
          <div className="space-y-2">
            <div>
              <h2 className="font-bold text-ink">All Charges — {data.reportMonth}</h2>
              <p className="text-xs text-ink-muted mt-0.5">From Datadog estimated cost API (committed + on-demand)</p>
            </div>
            <DataTable
              columns={chargeColumns}
              data={[...data.costCharges].sort((a, b) => b.cost - a.cost)}
              rowKey={(c) => `${c.product_name}-${c.charge_type}`}
              tableId="usage-charges"
              searchable
              pageSize={10}
            />
          </div>
        </SectionGate>
      )}

      {/* Permission note */}
      <div className="text-xs text-ink-faint text-center pb-4">
        Usage data requires <strong>Usage Read</strong> permission on your Datadog app key.
        Cost data requires <strong>Billing Read</strong> permission.
        Re-run a scan to refresh.
      </div>
    </div>
  );
}

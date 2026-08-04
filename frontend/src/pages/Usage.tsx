import { useQuery } from '@tanstack/react-query';
import { usageApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import type { UsageProductSummary } from '../types';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton';
import DataTable, { type Column } from '../components/common/DataTable';

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
  { key: 'committedCost', header: 'Committed', sortable: true, render: (p) => <span className="font-mono text-sm text-green-700">{money(p.committedCost)}</span> },
  { key: 'onDemandCost', header: 'On-Demand', sortable: true, render: (p) => (
    p.hasOnDemand ? <span className="font-mono text-sm text-red-600 font-semibold">{money(p.onDemandCost)}</span> : <span className="text-ink-faint">—</span>
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
          <span className="text-xs text-red-600 font-medium whitespace-nowrap">{onDemandPct.toFixed(0)}% OD</span>
        </div>
      );
    }
    if (totalCost > 0) return <span className="text-xs text-green-600 font-medium">✓ In allotment</span>;
    return <span className="text-xs text-ink-faint">—</span>;
  } },
];

const chargeColumns: Column<{ charge_type: string; product_name: string; cost: number }>[] = [
  { key: 'product_name', header: 'Product', sortable: true, render: (c) => <span className="text-sm text-ink">{c.product_name}</span> },
  { key: 'charge_type', header: 'Type', sortable: true, render: (c) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.charge_type === 'on_demand' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
      {c.charge_type === 'on_demand' ? 'On-Demand' : 'Committed'}
    </span>
  ) },
  { key: 'cost', header: 'Cost', sortable: true, render: (c) => <span className="font-mono text-sm font-semibold text-ink">{money(c.cost)}</span> },
];

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
  const max = Math.max(...points.map(p => p.value));
  return (
    <div className="flex items-end gap-1 h-12">
      {points.map((p, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
          <div
            className="w-full rounded-sm bg-violet-500 transition-all"
            style={{ height: `${max > 0 ? Math.round((p.value / max) * 40) : 0}px`, minHeight: p.value > 0 ? 2 : 0 }}
            title={`${p.month}: ${fmt(p.value, unit)}`}
          />
          <span className="text-[9px] text-ink-faint leading-none">{p.month.slice(5)}</span>
        </div>
      ))}
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
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-right">
            <div className="text-xs text-red-500 font-semibold uppercase tracking-wide">On-Demand Charges</div>
            <div className="text-xl font-bold text-red-600">{money(totalOnDemand)}</div>
            <div className="text-xs text-red-400">{onDemandProducts.length} product{onDemandProducts.length !== 1 ? 's' : ''} over allotment</div>
          </div>
        ) : undefined}
      />

      {/* Cost summary cards */}
      {totalCost > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card text-center py-4">
            <div className="text-xs text-ink-muted uppercase tracking-wide mb-1">Total Estimated Cost</div>
            <div className="text-2xl font-bold text-ink">{money(totalCost)}</div>
            <div className="text-xs text-ink-faint mt-1">{data.reportMonth}</div>
          </div>
          <div className="card text-center py-4">
            <div className="text-xs text-green-600 uppercase tracking-wide mb-1">Committed Spend</div>
            <div className="text-2xl font-bold text-green-700">{money(totalCommitted)}</div>
            <div className="text-xs text-ink-faint mt-1">In-allotment usage</div>
          </div>
          <div className={`card text-center py-4 ${totalOnDemand > 0 ? 'bg-red-50 border-red-200' : ''}`}>
            <div className="text-xs text-red-500 uppercase tracking-wide mb-1">On-Demand Charges</div>
            <div className={`text-2xl font-bold ${totalOnDemand > 0 ? 'text-red-600' : 'text-ink-faint'}`}>{totalOnDemand > 0 ? money(totalOnDemand) : '$0'}</div>
            <div className="text-xs text-ink-faint mt-1">{totalOnDemand > 0 ? 'Overage charges' : 'No overages'}</div>
          </div>
        </div>
      )}

      {/* On-demand alert */}
      {onDemandProducts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-red-500">⚠</span>
            <span className="font-semibold text-red-800">On-Demand Charges Detected</span>
          </div>
          <p className="text-sm text-red-700 mb-3">
            The following products are generating on-demand charges above your contracted allotment.
            These are typically billed at 1.5–3× the standard committed rate.
          </p>
          <div className="flex flex-wrap gap-2">
            {onDemandProducts.map(p => (
              <div key={p.name} className="bg-white border border-red-200 rounded-lg px-3 py-1.5 text-xs">
                <span className="font-semibold text-red-700">{p.name}</span>
                <span className="text-red-500 ml-1">+{money(p.onDemandCost)}/mo</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Product table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-ink">Product Usage Breakdown</h2>
            <p className="text-xs text-ink-muted mt-0.5">Usage metrics and estimated costs by product for {data.reportMonth}</p>
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
          />
        ) : (
          <div className="card text-center py-10 text-ink-faint text-sm">
            No product usage data found in this scan.
          </div>
        )}
      </div>

      {/* Usage trends (history sparklines) */}
      {data.usageHistory.length > 1 && (
        <div className="card">
          <h2 className="font-bold text-ink mb-4">Usage Trends — Last {data.usageHistory.length} Months</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {[
              { label: 'Infra Hosts (p99)', key: 'agent_host_top99p', unit: 'hosts' },
              { label: 'APM Hosts (p99)', key: 'apm_host_top99p', unit: 'hosts' },
              { label: 'Containers (avg)', key: 'container_avg', unit: 'containers' },
              { label: 'Custom Metrics (avg)', key: 'custom_ts_avg', unit: 'timeseries' },
              { label: 'RUM Sessions', key: 'rum_total_sessions_sum', unit: 'sessions' },
              { label: 'Log Ingestion', key: 'logs_ingested_bytes_sum', unit: 'bytes ingested' },
            ].map(({ label, key, unit }) => {
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
      )}

      {/* Raw charges table (if cost data available) */}
      {data.costCharges.length > 0 && (
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
          />
        </div>
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

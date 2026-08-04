import { useQuery } from '@tanstack/react-query';
import { usageApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import type { UsageProductSummary } from '../types';

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

function ProductRow({ p }: { p: UsageProductSummary }) {
  const totalCost = p.committedCost + p.onDemandCost;
  const onDemandPct = totalCost > 0 ? (p.onDemandCost / totalCost) * 100 : 0;

  return (
    <tr className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${p.hasOnDemand ? 'bg-red-50/40' : ''}`}>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          {p.hasOnDemand && <span className="text-red-500 text-xs font-bold">ON-DEMAND</span>}
          <span className="font-medium text-gray-900 text-sm">{p.name}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-right font-mono text-sm text-gray-700">
        {p.value !== null ? (
          <span title={`${p.value.toLocaleString()} ${p.unit}`}>{fmt(p.value, p.unit)}</span>
        ) : (
          <span className="text-gray-400 text-xs">no data</span>
        )}
      </td>
      <td className="py-3 px-4 text-right text-sm text-gray-600">{p.value !== null ? p.unit : ''}</td>
      <td className="py-3 px-4 text-right font-mono text-sm text-green-700">{money(p.committedCost)}</td>
      <td className="py-3 px-4 text-right font-mono text-sm">
        {p.hasOnDemand ? (
          <span className="text-red-600 font-semibold">{money(p.onDemandCost)}</span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="py-3 px-4">
        {p.hasOnDemand ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div
                className="bg-red-500 h-2 rounded-full"
                style={{ width: `${Math.min(100, onDemandPct)}%` }}
              />
            </div>
            <span className="text-xs text-red-600 font-medium whitespace-nowrap">{onDemandPct.toFixed(0)}% OD</span>
          </div>
        ) : totalCost > 0 ? (
          <span className="text-xs text-green-600 font-medium">✓ In allotment</span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
    </tr>
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
          <span className="text-[9px] text-gray-400 leading-none">{p.month.slice(5)}</span>
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
        <div className="card text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <div className="font-semibold text-gray-600">Select an organization to view usage data</div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="card text-center py-16 text-gray-400">Loading usage data…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Plan & Usage</h1>
          <p className="text-sm text-gray-500 mt-1">Current consumption vs. contracted allotments and on-demand charges</p>
        </div>
        <div className="card text-center py-16">
          <div className="text-4xl mb-3">📭</div>
          <div className="font-semibold text-gray-700 mb-2">No usage data available yet</div>
          <div className="text-sm text-gray-500 max-w-md mx-auto">
            Run a new scan to collect usage data from the Datadog Usage API.
            The usage collector requires <strong>Usage Read</strong> permissions on your app key.
          </div>
        </div>
      </div>
    );
  }

  const onDemandProducts = data.products.filter(p => p.hasOnDemand);
  const inAllotmentProducts = data.products.filter(p => !p.hasOnDemand && (p.committedCost > 0 || p.value !== null));
  const totalCommitted = data.costCharges.filter(c => c.charge_type === 'committed').reduce((s, c) => s + c.cost, 0);
  const totalOnDemand = data.costCharges.filter(c => c.charge_type === 'on_demand').reduce((s, c) => s + c.cost, 0);
  const totalCost = totalCommitted + totalOnDemand;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Plan & Usage</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data.reportMonth} usage — collected {new Date(data.collectedAt).toLocaleDateString()}
          </p>
        </div>
        {onDemandProducts.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-right">
            <div className="text-xs text-red-500 font-semibold uppercase tracking-wide">On-Demand Charges</div>
            <div className="text-xl font-bold text-red-600">{money(totalOnDemand)}</div>
            <div className="text-xs text-red-400">{onDemandProducts.length} product{onDemandProducts.length !== 1 ? 's' : ''} over allotment</div>
          </div>
        )}
      </div>

      {/* Cost summary cards */}
      {totalCost > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card text-center py-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Estimated Cost</div>
            <div className="text-2xl font-bold text-gray-900">{money(totalCost)}</div>
            <div className="text-xs text-gray-400 mt-1">{data.reportMonth}</div>
          </div>
          <div className="card text-center py-4">
            <div className="text-xs text-green-600 uppercase tracking-wide mb-1">Committed Spend</div>
            <div className="text-2xl font-bold text-green-700">{money(totalCommitted)}</div>
            <div className="text-xs text-gray-400 mt-1">In-allotment usage</div>
          </div>
          <div className={`card text-center py-4 ${totalOnDemand > 0 ? 'bg-red-50 border-red-200' : ''}`}>
            <div className="text-xs text-red-500 uppercase tracking-wide mb-1">On-Demand Charges</div>
            <div className={`text-2xl font-bold ${totalOnDemand > 0 ? 'text-red-600' : 'text-gray-400'}`}>{totalOnDemand > 0 ? money(totalOnDemand) : '$0'}</div>
            <div className="text-xs text-gray-400 mt-1">{totalOnDemand > 0 ? 'Overage charges' : 'No overages'}</div>
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
      <div className="card overflow-hidden p-0">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Product Usage Breakdown</h2>
            <p className="text-xs text-gray-500 mt-0.5">Usage metrics and estimated costs by product for {data.reportMonth}</p>
          </div>
          {data.products.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> In allotment</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> On-demand</span>
            </div>
          )}
        </div>
        {data.products.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</th>
                <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Usage</th>
                <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Committed</th>
                <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">On-Demand</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {/* On-demand first */}
              {onDemandProducts.map(p => <ProductRow key={p.name} p={p} />)}
              {inAllotmentProducts.map(p => <ProductRow key={p.name} p={p} />)}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-10 text-gray-400 text-sm">
            No product usage data found in this scan.
          </div>
        )}
      </div>

      {/* Usage trends (history sparklines) */}
      {data.usageHistory.length > 1 && (
        <div className="card">
          <h2 className="font-bold text-gray-900 mb-4">Usage Trends — Last {data.usageHistory.length} Months</h2>
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
                  <div className="text-xs font-semibold text-gray-700 mb-1">{label}</div>
                  <div className="text-lg font-bold text-gray-900 font-mono mb-1">{fmt(latestVal, unit)}</div>
                  <UsageBarChart history={data.usageHistory} metricKey={key} unit={unit} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Raw charges table (if cost data available) */}
      {data.costCharges.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900">All Charges — {data.reportMonth}</h2>
            <p className="text-xs text-gray-500 mt-0.5">From Datadog estimated cost API (committed + on-demand)</p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Cost</th>
              </tr>
            </thead>
            <tbody>
              {[...data.costCharges]
                .sort((a, b) => b.cost - a.cost)
                .map((c, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-4 text-sm text-gray-800">{c.product_name}</td>
                    <td className="py-2.5 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.charge_type === 'on_demand'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {c.charge_type === 'on_demand' ? 'On-Demand' : 'Committed'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-sm font-semibold text-gray-900">{money(c.cost)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Permission note */}
      <div className="text-xs text-gray-400 text-center pb-4">
        Usage data requires <strong>Usage Read</strong> permission on your Datadog app key.
        Cost data requires <strong>Billing Read</strong> permission.
        Re-run a scan to refresh.
      </div>
    </div>
  );
}

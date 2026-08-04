import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { taggingApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import LoadingState, { EmptyState } from '../components/common/LoadingState';
import type { CloudAlignmentResult } from '../types';

const STATUS_CONFIG = {
  aligned: { label: '✓ Aligned', color: 'bg-green-100 text-green-700', border: 'border-green-300' },
  missing_in_dd: { label: '✗ Missing in DD', color: 'bg-red-100 text-red-700', border: 'border-red-300' },
  key_drift: { label: '⚠ Key Drift', color: 'bg-amber-100 text-amber-700', border: 'border-amber-300' },
  value_drift: { label: '⚡ Value Drift', color: 'bg-orange-100 text-orange-700', border: 'border-orange-300' },
  dd_only: { label: 'DD Only', color: 'bg-blue-100 text-blue-700', border: 'border-blue-300' },
};

const PROVIDER_COLORS: Record<string, string> = {
  aws: 'bg-orange-100 text-orange-800',
  azure: 'bg-blue-100 text-blue-800',
  gcp: 'bg-green-100 text-green-800',
};

export default function CloudTagComparison() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const enabled = Boolean(selectedOrgId && selectedScanId);

  const { data: alignment, isLoading } = useQuery({
    queryKey: ['cloud-alignment', selectedOrgId, selectedScanId],
    queryFn: () => taggingApi.cloudAlignment(selectedOrgId, selectedScanId),
    enabled,
  });

  const filtered = (alignment?.rows ?? []).filter((r) =>
    statusFilter === 'all' || r.alignmentStatus === statusFilter
  );

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cloud Tag Comparison</h1>
          <p className="text-sm text-gray-500 mt-1">
            Align cloud provider tags (AWS/Azure/GCP) with Datadog tags to enable cost correlation
          </p>
        </div>
      </div>

      {!selectedScanId ? <EmptyState message="Run a scan to analyze cloud tag alignment" /> :
        isLoading ? <LoadingState /> : !alignment ? <EmptyState message="No cloud tag data found. Ensure AWS/Azure/GCP integration is configured." /> : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: 'Alignment Score', value: alignment.alignmentScore, color: 'text-violet-700', suffix: '/100' },
                { label: 'Aligned', value: alignment.alignedCount, color: 'text-green-700', suffix: '' },
                { label: 'Missing in DD', value: alignment.cloudOnlyCount, color: 'text-red-600', suffix: '' },
                { label: 'Key Drift', value: alignment.keyDriftCount, color: 'text-amber-700', suffix: '' },
                { label: 'Value Drift', value: alignment.valueDriftCount, color: 'text-orange-700', suffix: '' },
              ].map((c) => (
                <div key={c.label} className="card text-center">
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}{c.suffix}</div>
                  <div className="text-xs text-gray-500">{c.label}</div>
                </div>
              ))}
            </div>

            {/* Detected providers */}
            {alignment.detectedProviders.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Detected providers:</span>
                {alignment.detectedProviders.map((p) => (
                  <span key={p} className={`text-xs font-semibold px-2 py-1 rounded-full uppercase ${PROVIDER_COLORS[p] ?? 'bg-gray-100 text-gray-700'}`}>
                    {p}
                  </span>
                ))}
              </div>
            )}

            {/* Propagation gaps — most actionable */}
            {alignment.propagationGaps.length > 0 && (
              <section>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Propagation Gaps</h2>
                <p className="text-sm text-gray-500 mb-3">
                  Cloud tags that exist on resources but have not been propagated into Datadog telemetry.
                  Fixing these enables cost correlation without adding new tags.
                </p>
                <div className="space-y-3">
                  {alignment.propagationGaps.map((gap) => (
                    <div key={`${gap.cloudKey}-${gap.ddKey}`} className="card border-l-4 border-red-400">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <code className="text-sm font-mono text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200">{gap.cloudKey}</code>
                            <span className="text-gray-400">→</span>
                            <code className="text-sm font-mono text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200">{gap.ddKey}</code>
                          </div>
                          <p className="text-xs text-gray-500 mb-2">
                            Present on {gap.presentOnCloudResources} cloud resources — {gap.missingInDd} not yet in Datadog
                          </p>
                          <div className="text-xs">
                            <span className="font-semibold text-blue-600 uppercase tracking-wide">How: </span>
                            <span className="text-gray-600">{gap.fixRecommendation}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xl font-bold text-red-600">{gap.missingInDd}</div>
                          <div className="text-xs text-gray-400">resources missing</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Full alignment table */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-gray-900">Full Tag Comparison</h2>
                <select className="input w-auto text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All ({alignment.rows.length})</option>
                  <option value="missing_in_dd">Missing in DD ({alignment.cloudOnlyCount})</option>
                  <option value="key_drift">Key Drift ({alignment.keyDriftCount})</option>
                  <option value="value_drift">Value Drift ({alignment.valueDriftCount})</option>
                  <option value="aligned">Aligned ({alignment.alignedCount})</option>
                </select>
              </div>
              <div className="card p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Provider</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cloud Tag Key</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cloud Values</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">DD Tag Key</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((row, i) => {
                      const cfg = STATUS_CONFIG[row.alignmentStatus] ?? STATUS_CONFIG.aligned;
                      return (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase ${PROVIDER_COLORS[row.cloudProvider] ?? 'bg-gray-100 text-gray-700'}`}>
                              {row.cloudProvider}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-xs font-mono text-gray-800">{row.cloudTagKey}</code>
                            <div className="text-xs text-gray-400">{row.hostCount} hosts</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {row.cloudTagValues.slice(0, 3).map((v) => (
                                <code key={v} className="text-xs bg-orange-50 border border-orange-200 text-orange-700 px-1 rounded">{v}</code>
                              ))}
                              {row.cloudTagValues.length > 3 && <span className="text-xs text-gray-400">+{row.cloudTagValues.length - 3}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {row.ddTagKey
                              ? <code className="text-xs font-mono text-violet-700">{row.ddTagKey}</code>
                              : <span className="text-xs text-gray-400">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">
                            {row.mappingSuggestion ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                          No cloud tags detected. Ensure the Datadog AWS/Azure/GCP integration is enabled and tag collection is turned on.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
    </div>
  );
}

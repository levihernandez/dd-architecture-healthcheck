import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { taggingApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton';
import FilterChip, { FilterChipRow } from '../components/ui/FilterChip';
import DataTable, { type Column } from '../components/common/DataTable';
import type { CloudAlignmentRow } from '../types';

const STATUS_CONFIG = {
  aligned: { label: '✓ Aligned', color: 'bg-green-500/15 text-green-400', border: 'border-green-500/30' },
  missing_in_dd: { label: '✗ Missing in DD', color: 'bg-red-500/15 text-red-400', border: 'border-red-500/30' },
  key_drift: { label: '⚠ Key Drift', color: 'bg-amber-500/15 text-amber-400', border: 'border-amber-500/30' },
  value_drift: { label: '⚡ Value Drift', color: 'bg-orange-500/15 text-orange-400', border: 'border-orange-500/30' },
  dd_only: { label: 'DD Only', color: 'bg-blue-500/15 text-blue-400', border: 'border-blue-500/30' },
};

const PROVIDER_COLORS: Record<string, string> = {
  aws: 'bg-orange-500/15 text-orange-400',
  azure: 'bg-blue-500/15 text-blue-400',
  gcp: 'bg-green-500/15 text-green-400',
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

  const columns: Column<CloudAlignmentRow>[] = [
    {
      key: 'cloudProvider',
      header: 'Provider',
      sortable: true,
      render: (row) => (
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase ${PROVIDER_COLORS[row.cloudProvider] ?? 'bg-surface-sunken text-ink-muted'}`}>
          {row.cloudProvider}
        </span>
      ),
    },
    {
      key: 'cloudTagKey',
      header: 'Cloud Tag Key',
      sortable: true,
      render: (row) => (
        <>
          <code className="text-xs font-mono text-ink">{row.cloudTagKey}</code>
          <div className="text-xs text-ink-faint">{row.hostCount} hosts</div>
        </>
      ),
    },
    {
      key: 'cloudTagValues',
      header: 'Cloud Values',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.cloudTagValues.slice(0, 3).map((v) => (
            <code key={v} className="text-xs bg-orange-500/10 border border-orange-500/30 text-orange-400 px-1 rounded">{v}</code>
          ))}
          {row.cloudTagValues.length > 3 && <span className="text-xs text-ink-faint">+{row.cloudTagValues.length - 3}</span>}
        </div>
      ),
    },
    {
      key: 'ddTagKey',
      header: 'DD Tag Key',
      sortable: true,
      sortAccessor: (row) => row.ddTagKey ?? '',
      render: (row) =>
        row.ddTagKey
          ? <code className="text-xs font-mono text-violet-400">{row.ddTagKey}</code>
          : <span className="text-xs text-ink-faint">—</span>,
    },
    {
      key: 'alignmentStatus',
      header: 'Status',
      sortable: true,
      render: (row) => {
        const cfg = STATUS_CONFIG[row.alignmentStatus] ?? STATUS_CONFIG.aligned;
        return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>;
      },
    },
    {
      key: 'mappingSuggestion',
      header: 'Action',
      render: (row) => <span className="text-xs text-ink-muted max-w-xs">{row.mappingSuggestion ?? '—'}</span>,
    },
  ];

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader
        title="Cloud Tag Comparison"
        subtitle="Align cloud provider tags (AWS/Azure/GCP) with Datadog tags to enable cost correlation"
      />

      {!selectedScanId ? <EmptyState message="Run a scan to analyze cloud tag alignment" /> :
        isLoading ? (
          <div className="space-y-8">
            <SkeletonCards count={5} />
            <SkeletonTable rows={8} cols={6} />
          </div>
        ) : !alignment ? <EmptyState message="No cloud tag data found. Ensure AWS/Azure/GCP integration is configured." /> : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: 'Alignment Score', value: alignment.alignmentScore, color: 'text-violet-400', suffix: '/100' },
                { label: 'Aligned', value: alignment.alignedCount, color: 'text-green-400', suffix: '' },
                { label: 'Missing in DD', value: alignment.cloudOnlyCount, color: 'text-red-400', suffix: '' },
                { label: 'Key Drift', value: alignment.keyDriftCount, color: 'text-amber-400', suffix: '' },
                { label: 'Value Drift', value: alignment.valueDriftCount, color: 'text-orange-400', suffix: '' },
              ].map((c) => (
                <div key={c.label} className="card text-center">
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}{c.suffix}</div>
                  <div className="text-xs text-ink-muted">{c.label}</div>
                </div>
              ))}
            </div>

            {/* Detected providers */}
            {alignment.detectedProviders.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-muted">Detected providers:</span>
                {alignment.detectedProviders.map((p) => (
                  <span key={p} className={`text-xs font-semibold px-2 py-1 rounded-full uppercase ${PROVIDER_COLORS[p] ?? 'bg-surface-sunken text-ink-muted'}`}>
                    {p}
                  </span>
                ))}
              </div>
            )}

            {/* Propagation gaps — most actionable */}
            {alignment.propagationGaps.length > 0 && (
              <section>
                <h2 className="text-lg font-bold text-ink mb-1">Propagation Gaps</h2>
                <p className="text-sm text-ink-muted mb-3">
                  Cloud tags that exist on resources but have not been propagated into Datadog telemetry.
                  Fixing these enables cost correlation without adding new tags.
                </p>
                <div className="space-y-3">
                  {alignment.propagationGaps.map((gap) => (
                    <div key={`${gap.cloudKey}-${gap.ddKey}`} className="card border-l-4 border-red-400">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <code className="text-sm font-mono text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/30">{gap.cloudKey}</code>
                            <span className="text-ink-faint">→</span>
                            <code className="text-sm font-mono text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/30">{gap.ddKey}</code>
                          </div>
                          <p className="text-xs text-ink-muted mb-2">
                            Present on {gap.presentOnCloudResources} cloud resources — {gap.missingInDd} not yet in Datadog
                          </p>
                          <div className="text-xs">
                            <span className="font-semibold text-blue-400 uppercase tracking-wide">How: </span>
                            <span className="text-ink-muted">{gap.fixRecommendation}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xl font-bold text-red-400">{gap.missingInDd}</div>
                          <div className="text-xs text-ink-faint">resources missing</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Full alignment table */}
            <section>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-lg font-bold text-ink">Full Tag Comparison</h2>
                <FilterChipRow>
                  <FilterChip label="All" active={statusFilter === 'all'} count={alignment.rows.length} onClick={() => setStatusFilter('all')} />
                  <FilterChip label="Missing in DD" active={statusFilter === 'missing_in_dd'} count={alignment.cloudOnlyCount} onClick={() => setStatusFilter('missing_in_dd')} />
                  <FilterChip label="Key Drift" active={statusFilter === 'key_drift'} count={alignment.keyDriftCount} onClick={() => setStatusFilter('key_drift')} />
                  <FilterChip label="Value Drift" active={statusFilter === 'value_drift'} count={alignment.valueDriftCount} onClick={() => setStatusFilter('value_drift')} />
                  <FilterChip label="Aligned" active={statusFilter === 'aligned'} count={alignment.alignedCount} onClick={() => setStatusFilter('aligned')} />
                </FilterChipRow>
              </div>
              <DataTable
                tableId="cloud-tag-comparison"
                columns={columns}
                data={filtered}
                rowKey={(row) => `${row.cloudProvider}-${row.cloudTagKey}`}
                emptyMessage="No cloud tags detected. Ensure the Datadog AWS/Azure/GCP integration is enabled and tag collection is turned on."
                searchable
                pageSize={15}
              />
            </section>
          </>
        )}
    </div>
  );
}

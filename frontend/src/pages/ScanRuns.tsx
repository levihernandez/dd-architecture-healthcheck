import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { scansApi } from '../services/api';
import { useScans } from '../hooks/useOrgs';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ScanStatusBadge, CollectorStatusBadge } from '../components/common/StatusBadge';
import { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';
import DataTable, { type Column } from '../components/common/DataTable';
import { SkeletonTable } from '../components/ui/Skeleton';
import { formatDistanceToNow, format } from 'date-fns';
import type { ScanRun } from '../types';

export default function ScanRuns() {
  const qc = useQueryClient();
  const { orgs, selectedOrgId, setSelectedOrgId } = useOrgAndScanFilters();
  const { data: allScans = [], isLoading } = useScans(selectedOrgId);

  const startScan = useMutation({
    mutationFn: (orgId: string) => scansApi.start(orgId),
    onSuccess: () => {
      toast.success('Scan started');
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['orgs'] });
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to start scan'),
  });

  const [expandedScan, setExpandedScan] = useState<string | null>(null);

  const { data: scanDetail } = useQuery({
    queryKey: ['scan-detail', expandedScan],
    queryFn: () => scansApi.get(expandedScan!),
    enabled: Boolean(expandedScan),
    refetchInterval: (q) => {
      const d = q.state.data;
      return d?.status === 'running' || d?.status === 'pending' ? 2000 : false;
    },
  });

  const columns: Column<ScanRun>[] = [
    {
      key: 'startedAt',
      header: 'Started',
      sortable: true,
      sortAccessor: (s) => new Date(s.startedAt).getTime(),
      render: (s) => (
        <div>
          <div className="font-medium text-ink">{format(new Date(s.startedAt), 'MMM d, yyyy HH:mm')}</div>
          <div className="text-xs text-ink-faint">{formatDistanceToNow(new Date(s.startedAt), { addSuffix: true })}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (s) => (
        <div className="space-y-1">
          <ScanStatusBadge status={s.status} />
          {s.error && <div className="text-xs text-red-600 max-w-xs truncate">Error: {s.error}</div>}
        </div>
      ),
    },
    {
      key: 'findingCount',
      header: 'Findings',
      sortable: true,
      render: (s) => s.findingCount ?? '—',
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (s) =>
        s.completedAt ? (
          <span className="font-mono text-xs text-ink-muted">
            {Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)}s
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'id',
      header: 'Scan ID',
      render: (s) => <code className="text-xs text-ink-faint">{s.id.slice(0, 8)}...</code>,
    },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        <button
          className="btn-secondary text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setExpandedScan(expandedScan === s.id ? null : s.id);
          }}
        >
          {expandedScan === s.id ? 'Collapse' : 'Details'}
        </button>
      ),
    },
  ];

  const expandedScanRun = allScans.find((s) => s.id === expandedScan);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Scan Runs"
        subtitle="View and manage collection scan runs"
        actions={
          <>
            <select
              className="input w-auto"
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
            >
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button
              className="btn-primary"
              disabled={startScan.isPending || !selectedOrgId}
              onClick={() => startScan.mutate(selectedOrgId)}
            >
              {startScan.isPending ? '⟳ Starting...' : '▶ Start Scan'}
            </button>
          </>
        }
      />

      {isLoading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : allScans.length === 0 ? (
        <EmptyState
          message="No scans yet. Start a scan to collect data."
          action={
            <button className="btn-primary" onClick={() => startScan.mutate(selectedOrgId)}>
              Start First Scan
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          <DataTable
            tableId="scan-runs"
            columns={columns}
            data={allScans}
            rowKey={(scan) => scan.id}
            onRowClick={(scan) => setExpandedScan(expandedScan === scan.id ? null : scan.id)}
          />

          {expandedScanRun && scanDetail && (
            <div className="card">
              <h4 className="text-sm font-semibold text-ink mb-3">
                Collector Results — {format(new Date(expandedScanRun.startedAt), 'MMM d, yyyy HH:mm')}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {(scanDetail.collectorResults ?? []).map((r) => (
                  <div key={r.collector} className="flex items-center gap-2 bg-surface-subtle rounded p-2">
                    <CollectorStatusBadge status={r.status} />
                    <div>
                      <div className="text-xs font-medium text-ink-muted capitalize">
                        {r.collector.replace(/_/g, ' ')}
                      </div>
                      <div className="text-xs text-ink-faint">
                        {r.itemCount} items
                        {r.durationMs && ` · ${r.durationMs}ms`}
                      </div>
                      {r.error && <div className="text-xs text-red-600 truncate">{r.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

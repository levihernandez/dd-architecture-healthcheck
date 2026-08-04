import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scansApi } from '../services/api';
import { useOrgs, useScans } from '../hooks/useOrgs';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ScanStatusBadge, CollectorStatusBadge } from '../components/common/StatusBadge';
import LoadingState, { EmptyState } from '../components/common/LoadingState';
import { formatDistanceToNow, format } from 'date-fns';

export default function ScanRuns() {
  const qc = useQueryClient();
  const { orgs, selectedOrgId, setSelectedOrgId } = useOrgAndScanFilters();
  const { data: allScans = [], isLoading } = useScans(selectedOrgId);

  const startScan = useMutation({
    mutationFn: (orgId: string) => scansApi.start(orgId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['orgs'] });
    },
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

  if (isLoading) return <LoadingState />;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scan Runs</h1>
          <p className="text-gray-500 text-sm mt-1">View and manage collection scan runs</p>
        </div>
        <div className="flex gap-3">
          <select
            className="input w-auto"
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
          >
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button
            className="btn-primary"
            disabled={startScan.isPending}
            onClick={() => startScan.mutate(selectedOrgId)}
          >
            ▶ Start Scan
          </button>
        </div>
      </div>

      {allScans.length === 0 ? (
        <EmptyState
          message="No scans yet. Start a scan to collect data."
          action={
            <button className="btn-primary" onClick={() => startScan.mutate(selectedOrgId)}>
              Start First Scan
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {allScans.map((scan) => (
            <div key={scan.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <ScanStatusBadge status={scan.status} />
                    <span className="text-sm font-medium text-gray-900">
                      {format(new Date(scan.startedAt), 'MMM d, yyyy HH:mm')}
                    </span>
                    <span className="text-xs text-gray-400">
                      ({formatDistanceToNow(new Date(scan.startedAt), { addSuffix: true })})
                    </span>
                  </div>
                  <div className="mt-1 flex gap-4 text-xs text-gray-500">
                    <span>ID: <code>{scan.id.slice(0, 8)}...</code></span>
                    {scan.findingCount !== undefined && (
                      <span>{scan.findingCount} findings</span>
                    )}
                    {scan.completedAt && (
                      <span>
                        Duration: {Math.round((new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000)}s
                      </span>
                    )}
                    {scan.error && (
                      <span className="text-red-600">Error: {scan.error}</span>
                    )}
                  </div>
                </div>
                <button
                  className="btn-secondary text-xs"
                  onClick={() => setExpandedScan(expandedScan === scan.id ? null : scan.id)}
                >
                  {expandedScan === scan.id ? 'Collapse' : 'Details'}
                </button>
              </div>

              {expandedScan === scan.id && scanDetail && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Collector Results</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {(scanDetail.collectorResults ?? []).map((r) => (
                      <div key={r.collector} className="flex items-center gap-2 bg-gray-50 rounded p-2">
                        <CollectorStatusBadge status={r.status} />
                        <div>
                          <div className="text-xs font-medium text-gray-700 capitalize">
                            {r.collector.replace(/_/g, ' ')}
                          </div>
                          <div className="text-xs text-gray-500">
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
          ))}
        </div>
      )}
    </div>
  );
}

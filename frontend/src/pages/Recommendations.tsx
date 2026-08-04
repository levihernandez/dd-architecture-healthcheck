import { useQuery } from '@tanstack/react-query';
import { scansApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import EvidenceTable from '../components/common/EvidenceTable';
import LoadingState, { EmptyState } from '../components/common/LoadingState';
import { SeverityBadge } from '../components/common/StatusBadge';
import { CATEGORY_LABELS } from '../types';
import type { FindingCategory } from '../types';

export default function Recommendations() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['findings-all', selectedScanId],
    queryFn: () => scansApi.getFindings(selectedScanId),
    enabled: Boolean(selectedScanId),
  });

  const criticalAndHigh = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const medium = findings.filter((f) => f.severity === 'medium');
  const low = findings.filter((f) => f.severity === 'low');

  const byCategory = findings.reduce((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [];
    acc[f.category].push(f);
    return acc;
  }, {} as Record<FindingCategory, typeof findings>);

  if (isLoading) return <LoadingState />;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recommendations</h1>
          <p className="text-gray-500 text-sm mt-1">
            All findings prioritized by severity, with remediation guidance
          </p>
        </div>
      </div>

      {!selectedScanId ? <EmptyState message="Run a scan to see recommendations" /> : findings.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">🎉</div>
          <h3 className="text-lg font-semibold text-green-700">No findings!</h3>
          <p className="text-gray-500">Your Datadog environment passed all health checks.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Critical', count: criticalAndHigh.filter((f) => f.severity === 'critical').length, color: 'text-red-600 bg-red-50 border-red-200' },
              { label: 'High', count: criticalAndHigh.filter((f) => f.severity === 'high').length, color: 'text-orange-600 bg-orange-50 border-orange-200' },
              { label: 'Medium', count: medium.length, color: 'text-amber-600 bg-amber-50 border-amber-200' },
              { label: 'Low / Info', count: low.length + findings.filter((f) => f.severity === 'info').length, color: 'text-blue-600 bg-blue-50 border-blue-200' },
            ].map(({ label, count, color }) => (
              <div key={label} className={`card border ${color} text-center`}>
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-sm font-medium">{label}</div>
              </div>
            ))}
          </div>

          {criticalAndHigh.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                🔴 Critical & High Priority ({criticalAndHigh.length})
              </h2>
              <EvidenceTable findings={criticalAndHigh} />
            </div>
          )}

          {medium.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                🟡 Medium Priority ({medium.length})
              </h2>
              <EvidenceTable findings={medium} />
            </div>
          )}

          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Findings by Category</h2>
            <div className="space-y-3">
              {(Object.keys(byCategory) as FindingCategory[]).map((cat) => (
                <div key={cat} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-700">{CATEGORY_LABELS[cat]}</span>
                    <span className="badge bg-gray-200 text-gray-700">{byCategory[cat].length}</span>
                  </div>
                  <div className="px-4 py-2 flex flex-wrap gap-2">
                    {byCategory[cat].map((f) => (
                      <div key={f.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                        <SeverityBadge severity={f.severity} />
                        <span>{f.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { scansApi, inventoryApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import EvidenceTable from '../components/common/EvidenceTable';
import LoadingState, { EmptyState } from '../components/common/LoadingState';

export default function Integrations() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['findings', selectedScanId, 'integration_hygiene'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'integration_hygiene' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: inventory } = useQuery({
    queryKey: ['inventory-summary', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.summary(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
          <p className="text-gray-500 text-sm mt-1">Cloud integrations, notification channels, and configuration hygiene</p>
        </div>
      </div>
      {!selectedScanId ? <EmptyState message="Run a scan to see integration data" /> : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="card"><div className="text-2xl font-bold">{inventory?.integrations ?? 0}</div><div className="text-sm text-gray-500">Integrations Detected</div></div>
            <div className="card"><div className="text-2xl font-bold">{inventory?.cloudAccounts ?? 0}</div><div className="text-sm text-gray-500">Cloud Accounts</div></div>
          </div>
          {findings.length > 0 ? (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">Integration Findings</h2>
              <EvidenceTable findings={findings} />
            </div>
          ) : <div className="card text-center py-8"><div className="text-green-600 text-2xl mb-2">✓</div><p className="text-gray-700">Integrations look healthy</p></div>}
        </>
      )}
    </div>
  );
}

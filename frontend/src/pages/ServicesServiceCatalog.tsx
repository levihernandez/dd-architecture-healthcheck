import { useQuery } from '@tanstack/react-query';
import { scansApi, inventoryApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl, ddUrl } from '../utils/ddUrl';
import DataTable from '../components/common/DataTable';
import EvidenceTable from '../components/common/EvidenceTable';
import MetricCard from '../components/common/MetricCard';
import LoadingState, { EmptyState } from '../components/common/LoadingState';

export default function ServicesServiceCatalog() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');

  const { data: findings = [] } = useQuery({
    queryKey: ['findings', selectedScanId, 'service_architecture'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'service_architecture' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: services, isLoading } = useQuery({
    queryKey: ['services', selectedOrgId, selectedScanId, 1],
    queryFn: () => inventoryApi.services(selectedOrgId, selectedScanId, { pageSize: 200 }),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const svcData = services?.data ?? [];
  const total = services?.total ?? 0;
  const withCatalog = svcData.filter((s) => s.has_service_catalog).length;
  const withMonitor = svcData.filter((s) => s.has_monitor).length;
  const withSLO = svcData.filter((s) => s.has_slo).length;
  const withOwner = svcData.filter((s) => s.has_owner).length;

  if (isLoading) return <LoadingState />;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Services & Service Catalog</h1>
          <p className="text-gray-500 text-sm mt-1">APM services, ownership, and catalog coverage</p>
        </div>
      </div>

      {!selectedScanId ? <EmptyState message="Run a scan to see service data" /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Total Services" value={total} />
            <MetricCard label="In Catalog" value={`${total > 0 ? Math.round((withCatalog/total)*100) : 0}%`}
              subtitle={`${withCatalog} of ${total}`}
              color={withCatalog/total >= 0.8 ? 'green' : 'amber'} />
            <MetricCard label="Monitored" value={`${total > 0 ? Math.round((withMonitor/total)*100) : 0}%`}
              subtitle={`${withMonitor} of ${total}`}
              color={withMonitor/total >= 0.9 ? 'green' : 'red'} />
            <MetricCard label="Have SLOs" value={`${total > 0 ? Math.round((withSLO/total)*100) : 0}%`}
              subtitle={`${withSLO} of ${total}`}
              color={withSLO/total >= 0.6 ? 'green' : 'amber'} />
          </div>

          {findings.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">Service Architecture Findings ({findings.length})</h2>
              <EvidenceTable findings={findings} />
            </div>
          )}

          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Service Inventory ({total})</h2>
            </div>
            <DataTable
              columns={[
                { key: 'service_name', header: 'Service', render: (r) => (
                  <strong className="text-sm">
                    {String(r.service_name)}
                    <a href={ddUrl.service(base, String(r.service_name))} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:text-violet-600 ml-1 font-normal">↗</a>
                  </strong>
                ) },
                { key: 'env', header: 'Env', render: (r) => r.env ? <span className="badge bg-green-100 text-green-800">{String(r.env)}</span> : <span className="text-gray-300">—</span> },
                { key: 'team', header: 'Team', render: (r) => r.team ? <span className="text-sm">{String(r.team)}</span> : <span className="text-red-400 text-xs">No team</span> },
                { key: 'catalog', header: 'Catalog', render: (r) => <span className={r.has_service_catalog ? 'text-green-600' : 'text-red-400'}>{r.has_service_catalog ? '✓' : '✗'}</span> },
                { key: 'monitor', header: 'Monitor', render: (r) => <span className={r.has_monitor ? 'text-green-600' : 'text-red-400'}>{r.has_monitor ? '✓' : '✗'}</span> },
                { key: 'slo', header: 'SLO', render: (r) => <span className={r.has_slo ? 'text-green-600' : 'text-amber-500'}>{r.has_slo ? '✓' : '✗'}</span> },
                { key: 'version', header: 'Version', render: (r) => <span className={r.has_version_tag ? 'text-green-600' : 'text-gray-300'}>{r.has_version_tag ? '✓' : '✗'}</span> },
              ]}
              data={svcData}
              rowKey={(r) => String(r.id)}
              emptyMessage="No services found"
            />
          </div>
        </>
      )}
    </div>
  );
}

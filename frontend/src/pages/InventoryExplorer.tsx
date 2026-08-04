import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl, ddUrl } from '../utils/ddUrl';
import DataTable, { Pagination } from '../components/common/DataTable';
import LoadingState, { EmptyState } from '../components/common/LoadingState';
import TagPill from '../components/common/TagPill';
import MetricCard from '../components/common/MetricCard';

type ResourceTab = 'hosts' | 'services' | 'monitors';

export default function InventoryExplorer() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');
  const [tab, setTab] = useState<ResourceTab>('hosts');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data: summary } = useQuery({
    queryKey: ['inventory-summary', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.summary(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const { data: hosts, isLoading: hostsLoading } = useQuery({
    queryKey: ['hosts', selectedOrgId, selectedScanId, page, search],
    queryFn: () => inventoryApi.hosts(selectedOrgId, selectedScanId, { page, pageSize: 50, search }),
    enabled: Boolean(selectedOrgId && selectedScanId && tab === 'hosts'),
  });

  const { data: services, isLoading: servicesLoading } = useQuery({
    queryKey: ['services', selectedOrgId, selectedScanId, page, search],
    queryFn: () => inventoryApi.services(selectedOrgId, selectedScanId, { page, pageSize: 50, search }),
    enabled: Boolean(selectedOrgId && selectedScanId && tab === 'services'),
  });

  const { data: monitors, isLoading: monitorsLoading } = useQuery({
    queryKey: ['monitors', selectedOrgId, selectedScanId, page],
    queryFn: () => inventoryApi.monitors(selectedOrgId, selectedScanId, { page, pageSize: 50 }),
    enabled: Boolean(selectedOrgId && selectedScanId && tab === 'monitors'),
  });

  const isLoading = hostsLoading || servicesLoading || monitorsLoading;

  const tabData = { hosts: hosts?.data, services: services?.data, monitors: monitors?.data }[tab] ?? [];
  const tabMeta = { hosts, services, monitors }[tab];

  function CheckMark({ ok }: { ok: boolean }) {
    return <span className={ok ? 'text-green-600' : 'text-red-400'}>{ok ? '✓' : '✗'}</span>;
  }

  const hostColumns = [
    { key: 'host_name', header: 'Host', render: (r: Record<string, unknown>) => (
      <span>
        <code className="text-xs">{String(r.host_name ?? '')}</code>
        {Boolean(r.host_name) && (
          <a href={ddUrl.host(base, String(r.host_name))} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:text-violet-600 ml-1">↗</a>
        )}
      </span>
    ) },
    { key: 'env', header: 'env', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_env_tag)} /> },
    { key: 'service', header: 'service', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_service_tag)} /> },
    { key: 'version', header: 'version', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_version_tag)} /> },
    { key: 'team', header: 'team', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_team_tag)} /> },
    { key: 'tag_count', header: 'Tags', render: (r: Record<string, unknown>) => String(r.tag_count ?? 0) },
    { key: 'agent_version', header: 'Agent', render: (r: Record<string, unknown>) => <code className="text-xs text-gray-500">{String(r.agent_version ?? '—')}</code> },
  ];

  const serviceColumns = [
    { key: 'service_name', header: 'Service', render: (r: Record<string, unknown>) => <strong className="text-sm">{String(r.service_name ?? '')}</strong> },
    { key: 'env', header: 'Env', render: (r: Record<string, unknown>) => r.env ? <span className="badge bg-green-100 text-green-800">{String(r.env)}</span> : <span className="text-gray-300">—</span> },
    { key: 'version', header: 'Version', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_version_tag)} /> },
    { key: 'catalog', header: 'Catalog', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_service_catalog)} /> },
    { key: 'monitor', header: 'Monitor', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_monitor)} /> },
    { key: 'slo', header: 'SLO', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_slo)} /> },
    { key: 'owner', header: 'Owner', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_owner)} /> },
  ];

  const monitorColumns = [
    { key: 'monitor_name', header: 'Monitor', render: (r: Record<string, unknown>) => <span className="text-sm">{String(r.monitor_name ?? '')}</span> },
    { key: 'monitor_type', header: 'Type', render: (r: Record<string, unknown>) => <code className="text-xs bg-gray-100 px-1 rounded">{String(r.monitor_type ?? '')}</code> },
    { key: 'overall_state', header: 'State', render: (r: Record<string, unknown>) => {
      const state = String(r.overall_state ?? '');
      return <span className={`badge ${state === 'OK' ? 'bg-green-100 text-green-800' : state === 'Alert' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'}`}>{state || '—'}</span>;
    }},
    { key: 'priority', header: 'P', render: (r: Record<string, unknown>) => r.priority ? <span className="badge bg-purple-100 text-purple-800">P{String(r.priority)}</span> : <span className="text-gray-300">—</span> },
    { key: 'env', header: 'env', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_env_tag)} /> },
    { key: 'service', header: 'service', render: (r: Record<string, unknown>) => <CheckMark ok={Boolean(r.has_service_tag)} /> },
    { key: 'muted', header: 'Muted', render: (r: Record<string, unknown>) => r.is_muted ? <span className="badge bg-amber-100 text-amber-800">Muted</span> : null },
  ];

  const columns = { hosts: hostColumns, services: serviceColumns, monitors: monitorColumns }[tab];

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Explorer</h1>
          <p className="text-gray-500 text-sm mt-1">Browse collected resources</p>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Hosts" value={summary.hosts} />
          <MetricCard label="Services" value={summary.services} />
          <MetricCard label="Monitors" value={summary.monitors} />
          <MetricCard label="env Coverage" value={`${summary.envTagCoverage}%`}
            color={summary.envTagCoverage >= 90 ? 'green' : summary.envTagCoverage >= 70 ? 'amber' : 'red'} />
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {(['hosts', 'services', 'monitors'] as ResourceTab[]).map((t) => (
            <button
              key={t}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t
                  ? 'border-dd-purple text-dd-purple'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => { setTab(t); setPage(1); }}
            >
              {t}
              {summary && <span className="ml-1.5 text-xs text-gray-400">
                ({summary[t as keyof typeof summary] ?? 0})
              </span>}
            </button>
          ))}
          <div className="flex-1 flex items-center justify-end px-4">
            <input
              type="text" placeholder="Search..." className="input w-48 text-sm"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="py-12"><LoadingState /></div>
        ) : !selectedScanId ? (
          <div className="py-12"><EmptyState message="Select a scan to view inventory" /></div>
        ) : (
          <>
            <DataTable
              columns={columns as any}
              data={tabData}
              rowKey={(r) => String((r as Record<string, unknown>).id ?? Math.random())}
              emptyMessage={`No ${tab} found`}
            />
            {tabMeta && tabMeta.totalPages > 1 && (
              <Pagination
                page={page} totalPages={tabMeta.totalPages}
                total={tabMeta.total} pageSize={tabMeta.pageSize}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

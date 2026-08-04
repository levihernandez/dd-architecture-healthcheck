import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl, ddUrl } from '../utils/ddUrl';
import DataTable, { Pagination } from '../components/common/DataTable';
import { EmptyState } from '../components/common/LoadingState';
import MetricCard from '../components/common/MetricCard';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonTable } from '../components/ui/Skeleton';
import FilterChip, { FilterChipRow } from '../components/ui/FilterChip';

type ResourceTab = 'hosts' | 'services' | 'monitors';
type HostRow = Record<string, unknown>;

const QUICK_FILTERS: Record<ResourceTab, Array<{ id: string; label: string; test: (r: HostRow) => boolean }>> = {
  hosts: [
    { id: 'missing-env', label: 'Missing env tag', test: (r) => !r.has_env_tag },
    { id: 'missing-service', label: 'Missing service tag', test: (r) => !r.has_service_tag },
    { id: 'missing-team', label: 'Missing team tag', test: (r) => !r.has_team_tag },
  ],
  services: [
    { id: 'no-monitor', label: 'No monitor', test: (r) => !r.has_monitor },
    { id: 'no-slo', label: 'No SLO', test: (r) => !r.has_slo },
    { id: 'no-owner', label: 'No owner', test: (r) => !r.has_owner },
    { id: 'not-in-catalog', label: 'Not in catalog', test: (r) => !r.has_service_catalog },
  ],
  monitors: [
    { id: 'muted', label: 'Muted', test: (r) => Boolean(r.is_muted) },
    { id: 'alert', label: 'In alert', test: (r) => r.overall_state === 'Alert' },
    { id: 'missing-env', label: 'Missing env tag', test: (r) => !r.has_env_tag },
    { id: 'missing-service', label: 'Missing service tag', test: (r) => !r.has_service_tag },
  ],
};

export default function InventoryExplorer() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');
  const [tab, setTab] = useState<ResourceTab>('hosts');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

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

  const tabData = ({ hosts: hosts?.data, services: services?.data, monitors: monitors?.data }[tab] ?? []) as HostRow[];
  const tabMeta = { hosts, services, monitors }[tab];

  const filteredData = useMemo(() => {
    if (activeFilters.size === 0) return tabData;
    const filters = QUICK_FILTERS[tab].filter(f => activeFilters.has(f.id));
    return tabData.filter(row => filters.every(f => f.test(row)));
  }, [tabData, activeFilters, tab]);

  function toggleFilter(id: string) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function switchTab(t: ResourceTab) {
    setTab(t);
    setPage(1);
    setActiveFilters(new Set());
  }

  function CheckMark({ ok }: { ok: boolean }) {
    return <span className={ok ? 'text-emerald-600' : 'text-red-400'}>{ok ? '✓' : '✗'}</span>;
  }

  const hostColumns = [
    { key: 'host_name', header: 'Host', sortable: true, sortAccessor: (r: HostRow) => String(r.host_name ?? ''), render: (r: HostRow) => (
      <span>
        <code className="text-xs">{String(r.host_name ?? '')}</code>
        {Boolean(r.host_name) && (
          <a href={ddUrl.host(base, String(r.host_name))} target="_blank" rel="noopener noreferrer" className="text-xs text-ink-faint hover:text-dd-purple ml-1">↗</a>
        )}
      </span>
    ) },
    { key: 'env', header: 'env', sortable: true, sortAccessor: (r: HostRow) => (r.has_env_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_env_tag)} /> },
    { key: 'service', header: 'service', sortable: true, sortAccessor: (r: HostRow) => (r.has_service_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_service_tag)} /> },
    { key: 'version', header: 'version', sortable: true, sortAccessor: (r: HostRow) => (r.has_version_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_version_tag)} /> },
    { key: 'team', header: 'team', sortable: true, sortAccessor: (r: HostRow) => (r.has_team_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_team_tag)} /> },
    { key: 'tag_count', header: 'Tags', sortable: true, sortAccessor: (r: HostRow) => Number(r.tag_count ?? 0), render: (r: HostRow) => String(r.tag_count ?? 0) },
    { key: 'agent_version', header: 'Agent', render: (r: HostRow) => <code className="text-xs text-ink-faint">{String(r.agent_version ?? '—')}</code> },
  ];

  const serviceColumns = [
    { key: 'service_name', header: 'Service', sortable: true, sortAccessor: (r: HostRow) => String(r.service_name ?? ''), render: (r: HostRow) => <strong className="text-sm">{String(r.service_name ?? '')}</strong> },
    { key: 'env', header: 'Env', sortable: true, sortAccessor: (r: HostRow) => String(r.env ?? ''), render: (r: HostRow) => r.env ? <span className="badge bg-emerald-100 text-emerald-800">{String(r.env)}</span> : <span className="text-ink-faint">—</span> },
    { key: 'version', header: 'Version', sortable: true, sortAccessor: (r: HostRow) => (r.has_version_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_version_tag)} /> },
    { key: 'catalog', header: 'Catalog', sortable: true, sortAccessor: (r: HostRow) => (r.has_service_catalog ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_service_catalog)} /> },
    { key: 'monitor', header: 'Monitor', sortable: true, sortAccessor: (r: HostRow) => (r.has_monitor ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_monitor)} /> },
    { key: 'slo', header: 'SLO', sortable: true, sortAccessor: (r: HostRow) => (r.has_slo ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_slo)} /> },
    { key: 'owner', header: 'Owner', sortable: true, sortAccessor: (r: HostRow) => (r.has_owner ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_owner)} /> },
  ];

  const monitorColumns = [
    { key: 'monitor_name', header: 'Monitor', sortable: true, sortAccessor: (r: HostRow) => String(r.monitor_name ?? ''), render: (r: HostRow) => <span className="text-sm">{String(r.monitor_name ?? '')}</span> },
    { key: 'monitor_type', header: 'Type', sortable: true, sortAccessor: (r: HostRow) => String(r.monitor_type ?? ''), render: (r: HostRow) => <code className="text-xs bg-surface-sunken px-1 rounded">{String(r.monitor_type ?? '')}</code> },
    { key: 'overall_state', header: 'State', sortable: true, sortAccessor: (r: HostRow) => String(r.overall_state ?? ''), render: (r: HostRow) => {
      const state = String(r.overall_state ?? '');
      return <span className={`badge ${state === 'OK' ? 'bg-emerald-100 text-emerald-800' : state === 'Alert' ? 'bg-red-100 text-red-800' : 'bg-surface-sunken text-ink-muted'}`}>{state || '—'}</span>;
    }},
    { key: 'priority', header: 'P', sortable: true, sortAccessor: (r: HostRow) => Number(r.priority ?? 0), render: (r: HostRow) => r.priority ? <span className="badge bg-purple-100 text-purple-800">P{String(r.priority)}</span> : <span className="text-ink-faint">—</span> },
    { key: 'env', header: 'env', sortable: true, sortAccessor: (r: HostRow) => (r.has_env_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_env_tag)} /> },
    { key: 'service', header: 'service', sortable: true, sortAccessor: (r: HostRow) => (r.has_service_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_service_tag)} /> },
    { key: 'muted', header: 'Muted', sortable: true, sortAccessor: (r: HostRow) => (r.is_muted ? 1 : 0), render: (r: HostRow) => r.is_muted ? <span className="badge bg-amber-100 text-amber-800">Muted</span> : null },
  ];

  const columns = { hosts: hostColumns, services: serviceColumns, monitors: monitorColumns }[tab];
  const quickFilters = QUICK_FILTERS[tab];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Inventory Explorer" subtitle="Browse collected resources" />

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
        <div className="flex items-center border-b border-border flex-wrap">
          {(['hosts', 'services', 'monitors'] as ResourceTab[]).map((t) => (
            <button
              key={t}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t
                  ? 'border-dd-purple text-dd-purple'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
              onClick={() => switchTab(t)}
            >
              {t}
              {summary && <span className="ml-1.5 text-xs text-ink-faint">
                ({summary[t as keyof typeof summary] ?? 0})
              </span>}
            </button>
          ))}
          <div className="flex-1 flex items-center justify-end px-4 py-2">
            <input
              type="text" placeholder="Search..." className="input w-48 text-sm"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {quickFilters.length > 0 && (
          <div className="px-4 py-3 border-b border-border bg-surface-subtle">
            <FilterChipRow>
              {quickFilters.map(f => (
                <FilterChip
                  key={f.id}
                  label={f.label}
                  active={activeFilters.has(f.id)}
                  count={tabData.filter(f.test).length}
                  onClick={() => toggleFilter(f.id)}
                />
              ))}
            </FilterChipRow>
          </div>
        )}

        {isLoading ? (
          <div className="p-4"><SkeletonTable rows={8} cols={columns.length} /></div>
        ) : !selectedScanId ? (
          <div className="py-12"><EmptyState message="Select a scan to view inventory" /></div>
        ) : (
          <>
            <DataTable
              columns={columns}
              data={filteredData}
              rowKey={(r) => String((r as Record<string, unknown>).id ?? Math.random())}
              emptyMessage={activeFilters.size > 0 ? `No ${tab} match the selected filters` : `No ${tab} found`}
              tableId={`inventory-${tab}`}
            />
            {tabMeta && tabMeta.totalPages > 1 && activeFilters.size === 0 && (
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

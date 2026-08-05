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

type ResourceTab = 'hosts' | 'services' | 'monitors' | 'dashboards' | 'synthetics' | 'slos';
type HostRow = Record<string, unknown>;

const TAB_LABELS: Record<ResourceTab, string> = {
  hosts: 'Hosts', services: 'Services', monitors: 'Monitors',
  dashboards: 'Dashboards', synthetics: 'Synthetics', slos: 'SLOs',
};

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
  dashboards: [
    { id: 'no-template-vars', label: 'No template variables', test: (r) => !r.has_template_variables },
    { id: 'empty', label: 'Empty (0 widgets)', test: (r) => Number(r.widget_count ?? 0) === 0 },
  ],
  synthetics: [
    { id: 'no-notification', label: 'No notification', test: (r) => !r.has_notification },
    { id: 'missing-env', label: 'Missing env tag', test: (r) => !r.has_env_tag },
    { id: 'single-location', label: 'Single location', test: (r) => Number(r.location_count ?? 0) <= 1 },
  ],
  slos: [
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

  const { data: dashboards, isLoading: dashboardsLoading } = useQuery({
    queryKey: ['inv-dashboards', selectedOrgId, selectedScanId, page, search],
    queryFn: () => inventoryApi.dashboards(selectedOrgId, selectedScanId, { page, pageSize: 50, search }),
    enabled: Boolean(selectedOrgId && selectedScanId && tab === 'dashboards'),
  });

  const { data: synthetics, isLoading: syntheticsLoading } = useQuery({
    queryKey: ['inv-synthetics', selectedOrgId, selectedScanId, page, search],
    queryFn: () => inventoryApi.synthetics(selectedOrgId, selectedScanId, { page, pageSize: 50, search }),
    enabled: Boolean(selectedOrgId && selectedScanId && tab === 'synthetics'),
  });

  const { data: slos, isLoading: slosLoading } = useQuery({
    queryKey: ['inv-slos', selectedOrgId, selectedScanId, page, search],
    queryFn: () => inventoryApi.slos(selectedOrgId, selectedScanId, { page, pageSize: 50, search }),
    enabled: Boolean(selectedOrgId && selectedScanId && tab === 'slos'),
  });

  const isLoading = hostsLoading || servicesLoading || monitorsLoading || dashboardsLoading || syntheticsLoading || slosLoading;

  const tabData = ({
    hosts: hosts?.data, services: services?.data, monitors: monitors?.data,
    dashboards: dashboards?.data, synthetics: synthetics?.data, slos: slos?.data,
  }[tab] ?? []) as HostRow[];
  const tabMeta = { hosts, services, monitors, dashboards, synthetics, slos }[tab];

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
    return <span className={ok ? 'text-emerald-400' : 'text-red-400'}>{ok ? '✓' : '✗'}</span>;
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
    { key: 'software', header: 'Software', render: (r: HostRow) => {
      const checks = (r.installed_checks as string[] | undefined) ?? [];
      if (checks.length === 0) return <span className="text-ink-faint">—</span>;
      return (
        <span className="text-xs text-ink-muted truncate max-w-[220px] inline-block" title={checks.join(', ')}>
          {checks.slice(0, 3).join(', ')}{checks.length > 3 ? ` +${checks.length - 3}` : ''}
        </span>
      );
    } },
    { key: 'configuration', header: 'Configuration', render: (r: HostRow) => {
      const provider = String(r.cloud_provider ?? 'on-prem/unknown');
      const parts = [r.instance_type, r.region, r.availability_zone].filter(Boolean).map(String);
      return (
        <span className="text-xs">
          <span className="badge bg-surface-sunken text-ink-muted capitalize">{provider}</span>
          {parts.length > 0 && <span className="text-ink-faint ml-1">{parts.join(' · ')}</span>}
        </span>
      );
    } },
    { key: 'recommended_products', header: 'Recommended', render: (r: HostRow) => {
      const recs = (r.recommended_products as Array<{ product: string; icon: string; reason: string }> | undefined) ?? [];
      if (recs.length === 0) return <span className="text-ink-faint">—</span>;
      return (
        <span className="flex flex-wrap gap-1">
          {recs.map((rec) => (
            <span key={rec.product} title={rec.reason} className="badge bg-dd-purple/15 text-dd-purple whitespace-nowrap">
              {rec.icon} {rec.product}
            </span>
          ))}
        </span>
      );
    } },
  ];

  const serviceColumns = [
    { key: 'service_name', header: 'Service', sortable: true, sortAccessor: (r: HostRow) => String(r.service_name ?? ''), render: (r: HostRow) => <strong className="text-sm">{String(r.service_name ?? '')}</strong> },
    { key: 'env', header: 'Env', sortable: true, sortAccessor: (r: HostRow) => String(r.env ?? ''), render: (r: HostRow) => r.env ? <span className="badge bg-emerald-500/15 text-emerald-400">{String(r.env)}</span> : <span className="text-ink-faint">—</span> },
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
      return <span className={`badge ${state === 'OK' ? 'bg-emerald-500/15 text-emerald-400' : state === 'Alert' ? 'bg-red-500/15 text-red-400' : 'bg-surface-sunken text-ink-muted'}`}>{state || '—'}</span>;
    }},
    { key: 'priority', header: 'P', sortable: true, sortAccessor: (r: HostRow) => Number(r.priority ?? 0), render: (r: HostRow) => r.priority ? <span className="badge bg-emerald-500/15 text-emerald-400">P{String(r.priority)}</span> : <span className="text-ink-faint">—</span> },
    { key: 'env', header: 'env', sortable: true, sortAccessor: (r: HostRow) => (r.has_env_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_env_tag)} /> },
    { key: 'service', header: 'service', sortable: true, sortAccessor: (r: HostRow) => (r.has_service_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_service_tag)} /> },
    { key: 'muted', header: 'Muted', sortable: true, sortAccessor: (r: HostRow) => (r.is_muted ? 1 : 0), render: (r: HostRow) => r.is_muted ? <span className="badge bg-amber-500/15 text-amber-400">Muted</span> : null },
  ];

  const dashboardColumns = [
    { key: 'title', header: 'Dashboard', sortable: true, sortAccessor: (r: HostRow) => String(r.title ?? ''), render: (r: HostRow) => <span className="text-sm">{String(r.title ?? '')}</span> },
    { key: 'layout_type', header: 'Layout', sortable: true, sortAccessor: (r: HostRow) => String(r.layout_type ?? ''), render: (r: HostRow) => <code className="text-xs bg-surface-sunken px-1 rounded">{String(r.layout_type ?? '—')}</code> },
    { key: 'widget_count', header: 'Widgets', sortable: true, sortAccessor: (r: HostRow) => Number(r.widget_count ?? 0), render: (r: HostRow) => String(r.widget_count ?? 0) },
    { key: 'template_vars', header: 'Template Vars', sortable: true, sortAccessor: (r: HostRow) => (r.has_template_variables ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_template_variables)} /> },
    { key: 'author_handle', header: 'Author', render: (r: HostRow) => <span className="text-xs text-ink-faint">{String(r.author_handle ?? '—')}</span> },
  ];

  const syntheticsColumns = [
    { key: 'test_name', header: 'Test', sortable: true, sortAccessor: (r: HostRow) => String(r.test_name ?? ''), render: (r: HostRow) => <span className="text-sm">{String(r.test_name ?? '')}</span> },
    { key: 'test_type', header: 'Type', sortable: true, sortAccessor: (r: HostRow) => String(r.test_type ?? ''), render: (r: HostRow) => <code className="text-xs bg-surface-sunken px-1 rounded">{String(r.test_type ?? '')}</code> },
    { key: 'status', header: 'Status', sortable: true, sortAccessor: (r: HostRow) => String(r.status ?? ''), render: (r: HostRow) => <span className="text-xs">{String(r.status ?? '—')}</span> },
    { key: 'location_count', header: 'Locations', sortable: true, sortAccessor: (r: HostRow) => Number(r.location_count ?? 0), render: (r: HostRow) => String(r.location_count ?? 0) },
    { key: 'env', header: 'env', sortable: true, sortAccessor: (r: HostRow) => (r.has_env_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_env_tag)} /> },
    { key: 'notification', header: 'Notification', sortable: true, sortAccessor: (r: HostRow) => (r.has_notification ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_notification)} /> },
  ];

  const sloColumns = [
    { key: 'slo_name', header: 'SLO', sortable: true, sortAccessor: (r: HostRow) => String(r.slo_name ?? ''), render: (r: HostRow) => <span className="text-sm">{String(r.slo_name ?? '')}</span> },
    { key: 'slo_type', header: 'Type', sortable: true, sortAccessor: (r: HostRow) => String(r.slo_type ?? ''), render: (r: HostRow) => <code className="text-xs bg-surface-sunken px-1 rounded">{String(r.slo_type ?? '—')}</code> },
    { key: 'env', header: 'env', sortable: true, sortAccessor: (r: HostRow) => (r.has_env_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_env_tag)} /> },
    { key: 'service', header: 'service', sortable: true, sortAccessor: (r: HostRow) => (r.has_service_tag ? 1 : 0), render: (r: HostRow) => <CheckMark ok={Boolean(r.has_service_tag)} /> },
  ];

  const columns = {
    hosts: hostColumns, services: serviceColumns, monitors: monitorColumns,
    dashboards: dashboardColumns, synthetics: syntheticsColumns, slos: sloColumns,
  }[tab];
  const quickFilters = QUICK_FILTERS[tab];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Inventory Explorer" subtitle="Browse collected resources" />

      {summary && (
        <div className="grid grid-cols-4 md:grid-cols-7 gap-3">
          <MetricCard label="Hosts" value={summary.hosts} />
          <MetricCard label="Services" value={summary.services} />
          <MetricCard label="Monitors" value={summary.monitors} />
          <MetricCard label="Dashboards" value={summary.dashboards} />
          <MetricCard label="Synthetics" value={summary.syntheticsTests} />
          <MetricCard label="SLOs" value={summary.slos} />
          <MetricCard label="env Coverage" value={`${summary.envTagCoverage}%`}
            color={summary.envTagCoverage >= 90 ? 'green' : summary.envTagCoverage >= 70 ? 'amber' : 'red'} />
          <MetricCard label="Log Resources" value={summary.logsIndexes + summary.logsPipelines} />
          <MetricCard label="Integrations" value={summary.integrations} />
          <MetricCard label="Cloud Accounts" value={summary.cloudAccounts} />
          <MetricCard label="Security Findings" value={summary.securityFindings} />
          <MetricCard label="Open Incidents" value={summary.openIncidents} />
          <MetricCard label="Tag Keys" value={summary.tagKeys} />
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center border-b border-border flex-wrap">
          {(['hosts', 'services', 'monitors', 'dashboards', 'synthetics', 'slos'] as ResourceTab[]).map((t) => (
            <button
              key={t}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-dd-purple text-dd-purple'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
              onClick={() => switchTab(t)}
            >
              {TAB_LABELS[t]}
              {summary && <span className="ml-1.5 text-xs text-ink-faint">
                ({summary[t === 'synthetics' ? 'syntheticsTests' : (t as keyof typeof summary)] ?? 0})
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

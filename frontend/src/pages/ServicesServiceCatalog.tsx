import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { scansApi, inventoryApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl, ddUrl } from '../utils/ddUrl';
import DataTable from '../components/common/DataTable';
import EvidenceTable from '../components/common/EvidenceTable';
import MetricCard from '../components/common/MetricCard';
import { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';
import FilterChip, { FilterChipRow } from '../components/ui/FilterChip';
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton';
import SectionGate from '../components/SectionGate';
import type { FindingSeverity } from '../types';

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ServicesServiceCatalog() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all');

  const { data: findings = [], isLoading: findingsLoading } = useQuery({
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

  const severityCounts = useMemo(() => {
    const counts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    findings.forEach((f) => { counts[f.severity] = (counts[f.severity] ?? 0) + 1; });
    return counts;
  }, [findings]);

  const filteredFindings = severityFilter === 'all' ? findings : findings.filter((f) => f.severity === severityFilter);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Services & Service Catalog" subtitle="APM services, ownership, and catalog coverage" />

      {!selectedScanId ? <EmptyState message="Run a scan to see service data" /> : (isLoading || findingsLoading) ? (
        <div className="space-y-6">
          <SkeletonCards count={4} />
          <SkeletonTable rows={8} cols={7} />
        </div>
      ) : (
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
            <SectionGate featureKey="section.services.findings_summary">
              <div className="card">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="text-lg font-semibold text-ink">
                    Service Architecture Findings ({filteredFindings.length}{filteredFindings.length !== findings.length ? ` of ${findings.length}` : ''})
                  </h2>
                  <FilterChipRow>
                    <FilterChip label="All" active={severityFilter === 'all'} count={findings.length} onClick={() => setSeverityFilter('all')} />
                    {(['critical', 'high', 'medium', 'low', 'info'] as FindingSeverity[])
                      .filter((s) => severityCounts[s] > 0)
                      .map((s) => (
                        <FilterChip
                          key={s}
                          label={s[0].toUpperCase() + s.slice(1)}
                          active={severityFilter === s}
                          count={severityCounts[s]}
                          onClick={() => setSeverityFilter(s)}
                        />
                      ))}
                  </FilterChipRow>
                </div>
                <EvidenceTable findings={filteredFindings} />
              </div>
            </SectionGate>
          )}

          <SectionGate featureKey="section.services.service_inventory">
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-base font-semibold text-ink">Service Inventory ({total})</h2>
            </div>
            <DataTable
              tableId="services-inventory"
              selectable
              bulkActions={(selected, clear) => (
                <>
                  <button
                    className="btn-secondary text-xs px-2.5 py-1"
                    onClick={() => {
                      downloadCsv('services.csv', selected.map((r) => ({
                        service_name: r.service_name, env: r.env, team: r.team,
                        has_service_catalog: r.has_service_catalog, has_monitor: r.has_monitor,
                        has_slo: r.has_slo, has_version_tag: r.has_version_tag,
                      })));
                      toast.success(`Exported ${selected.length} service${selected.length === 1 ? '' : 's'} to CSV`);
                      clear();
                    }}
                  >
                    Export CSV
                  </button>
                </>
              )}
              columns={[
                { key: 'service_name', header: 'Service', sortable: true, render: (r) => (
                  <strong className="text-sm">
                    {String(r.service_name)}
                    <a href={ddUrl.service(base, String(r.service_name))} target="_blank" rel="noopener noreferrer" className="text-xs text-ink-faint hover:text-violet-400 ml-1 font-normal">↗</a>
                  </strong>
                ) },
                { key: 'env', header: 'Env', sortable: true, render: (r) => r.env ? <span className="badge bg-green-500/15 text-green-400">{String(r.env)}</span> : <span className="text-ink-faint">—</span> },
                { key: 'team', header: 'Team', sortable: true, render: (r) => r.team ? <span className="text-sm">{String(r.team)}</span> : <span className="text-red-400 text-xs">No team</span> },
                { key: 'catalog', header: 'Catalog', render: (r) => <span className={r.has_service_catalog ? 'text-green-400' : 'text-red-400'}>{r.has_service_catalog ? '✓' : '✗'}</span> },
                { key: 'monitor', header: 'Monitor', render: (r) => <span className={r.has_monitor ? 'text-green-400' : 'text-red-400'}>{r.has_monitor ? '✓' : '✗'}</span> },
                { key: 'slo', header: 'SLO', render: (r) => <span className={r.has_slo ? 'text-green-400' : 'text-amber-500'}>{r.has_slo ? '✓' : '✗'}</span> },
                { key: 'version', header: 'Version', render: (r) => <span className={r.has_version_tag ? 'text-green-400' : 'text-ink-faint'}>{r.has_version_tag ? '✓' : '✗'}</span> },
              ]}
              data={svcData}
              rowKey={(r) => String(r.id)}
              emptyMessage="No services found"
              searchable
              pageSize={15}
            />
          </div>
          </SectionGate>
        </>
      )}
    </div>
  );
}

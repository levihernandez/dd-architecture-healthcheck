import { useQuery } from '@tanstack/react-query';
import { scansApi, inventoryApi, analyticsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl, ddUrl } from '../utils/ddUrl';
import EvidenceTable from '../components/common/EvidenceTable';
import MetricCard from '../components/common/MetricCard';
import LoadingState, { EmptyState } from '../components/common/LoadingState';

function DDLink({ href, label = 'Open in Datadog' }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium shrink-0">
      {label} ↗
    </a>
  );
}

export default function DashboardsHealth() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['findings', selectedScanId, 'dashboards_health'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'dashboards_health' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: inventory } = useQuery({
    queryKey: ['inventory-summary', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.summary(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const { data: analytics } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const totalDashboards = inventory?.dashboards ?? 0;
  const totalMonitors = analytics?.observability.monitors ?? 0;
  const totalServices = analytics?.apm.totalServices ?? 0;
  const sloCount = analytics?.apm.slos ?? 0;

  // Rough coverage heuristic: at least 1 dashboard per 10 services is a reasonable baseline
  const dashPerService = totalServices > 0 ? (totalDashboards / totalServices).toFixed(1) : '—';
  const coverageGrade = totalServices > 0
    ? (totalDashboards / totalServices >= 0.5 ? 'good' : totalDashboards / totalServices >= 0.2 ? 'partial' : 'low')
    : 'unknown';

  if (isLoading) return <LoadingState />;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboards Health</h1>
          <p className="text-gray-500 text-sm mt-1">Dashboard coverage, quality, and observability breadth</p>
        </div>
        <DDLink href={ddUrl.dashboardList(base)} label="Dashboard List" />
      </div>

      {!selectedScanId ? <EmptyState message="Run a scan to see dashboard health data" /> : (
        <>
          {/* Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Total Dashboards" value={totalDashboards} icon="📈" />
            <MetricCard label="Dashboards / Service" value={String(dashPerService)}
              subtitle={coverageGrade === 'good' ? 'good coverage' : coverageGrade === 'partial' ? 'partial coverage' : coverageGrade === 'low' ? 'low coverage' : ''}
              color={coverageGrade === 'good' ? 'green' : coverageGrade === 'partial' ? 'amber' : 'default'} />
            <MetricCard label="Monitors" value={totalMonitors}
              subtitle="total monitors configured"
              icon="🔔" />
            <MetricCard label="SLOs" value={sloCount}
              subtitle="service level objectives"
              icon="🎯"
              color={sloCount === 0 && totalServices > 0 ? 'red' : 'default'} />
          </div>

          {/* Coverage analysis */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Coverage Analysis</h2>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-xl">📊</span>
                  <div>
                    <div className="text-sm font-medium text-gray-800">Dashboard-to-Service Ratio</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {totalDashboards} dashboards across {totalServices} services ({dashPerService} per service)
                    </div>
                    <div className={`text-xs mt-1 font-medium ${coverageGrade === 'good' ? 'text-green-600' : coverageGrade === 'partial' ? 'text-amber-600' : 'text-red-500'}`}>
                      {coverageGrade === 'good' ? '✓ Good coverage' : coverageGrade === 'partial' ? '⚠ Consider adding service dashboards' : '⚠ Low dashboard coverage'}
                    </div>
                  </div>
                </div>

                {sloCount === 0 && totalServices > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <span className="text-xl">🎯</span>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-amber-800">No SLOs configured</div>
                      <div className="text-xs text-amber-600 mt-0.5">SLOs are critical for measuring reliability. Define availability and latency SLOs for your key services.</div>
                    </div>
                    <DDLink href={ddUrl.slos(base)} label="Create SLO" />
                  </div>
                )}

                {totalMonitors > 0 && totalDashboards > 0 && (
                  <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                    <span className="text-xl">🔔</span>
                    <div>
                      <div className="text-sm font-medium text-blue-800">Monitor-to-Dashboard Ratio</div>
                      <div className="text-xs text-blue-600 mt-0.5">
                        {totalMonitors} monitors / {totalDashboards} dashboards = {(totalMonitors / totalDashboards).toFixed(1)} monitors per dashboard
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Best Practices</h2>
              <ul className="space-y-2">
                {[
                  { icon: '📋', text: 'Create a service-level dashboard for every production service', done: dashPerService !== '—' && parseFloat(String(dashPerService)) >= 0.5 },
                  { icon: '🏷', text: 'Tag dashboards with env, team, and service for discoverability', done: false },
                  { icon: '🎯', text: 'Add SLO widgets to service dashboards', done: sloCount > 0 },
                  { icon: '📐', text: 'Use template variables for env/region filtering', done: false },
                  { icon: '🔗', text: 'Link related monitors to dashboards for context', done: totalMonitors > 0 },
                ].map(({ icon, text, done }) => (
                  <li key={text} className="flex items-start gap-2 text-sm">
                    <span className={done ? 'text-green-500' : 'text-gray-300'}>{done ? '✓' : icon}</span>
                    <span className={done ? 'text-green-700' : 'text-gray-600'}>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Findings */}
          {findings.length > 0 ? (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Dashboard Findings ({findings.length})</h2>
              <EvidenceTable findings={findings} />
            </div>
          ) : (
            <div className="card bg-green-50 border-green-200 text-center py-6">
              <div className="text-green-600 text-2xl mb-2">✓</div>
              <p className="text-gray-700 font-medium">No dashboard-specific findings detected</p>
            </div>
          )}

          {/* Investigation links */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Investigate in Datadog</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {[
                { label: 'All dashboards', href: ddUrl.dashboardList(base) },
                { label: 'All SLOs', href: ddUrl.slos(base) },
                { label: 'Service catalog', href: ddUrl.serviceCatalog(base) },
                { label: 'APM services', href: ddUrl.apmServices(base) },
                { label: 'All monitors', href: ddUrl.monitorList(base) },
                { label: 'Create dashboard', href: `${base}/dashboard/new` },
              ].map(({ label, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200 hover:border-violet-300 hover:bg-violet-50/30 transition-colors group">
                  <span className="text-sm text-gray-700 group-hover:text-violet-700">{label}</span>
                  <span className="text-gray-300 group-hover:text-violet-500">↗</span>
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

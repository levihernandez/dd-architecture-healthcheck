import { useQuery } from '@tanstack/react-query';
import { scansApi, analyticsApi } from '../services/api';
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

const fmtNum = (n: number) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
};

export default function SyntheticsHealth() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['findings', selectedScanId, 'synthetics_health'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'synthetics_health' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: analytics } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const syn = analytics?.synthetics;
  const details = syn?.details ?? [];
  const apiTests = syn?.apiTests ?? 0;
  const browserTests = syn?.browserTests ?? 0;
  const totalTests = apiTests + browserTests;
  const monthlyRuns = syn?.estimatedMonthlyRuns ?? 0;

  const pausedTests = details.filter(t => t.status === 'paused');
  const alertTests = details.filter(t => t.status === 'alert');
  const singleLocationTests = details.filter(t => t.locations <= 1 && t.status !== 'paused');

  const testsByType: Record<string, number> = {};
  details.forEach(t => { testsByType[t.type] = (testsByType[t.type] ?? 0) + 1; });

  if (isLoading) return <LoadingState />;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Synthetics Health</h1>
          <p className="text-gray-500 text-sm mt-1">Synthetic test coverage, run volume, alert status, and location distribution</p>
        </div>
        <DDLink href={ddUrl.syntheticsTests(base)} label="All Tests" />
      </div>

      {!selectedScanId ? <EmptyState message="Run a scan to see synthetics health" /> : (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard label="Total Tests" value={totalTests} icon="🌐" />
            <MetricCard label="API Tests" value={apiTests}
              subtitle={totalTests > 0 ? `${Math.round((apiTests / totalTests) * 100)}% of total` : ''}
              color={apiTests === 0 ? 'amber' : 'default'} />
            <MetricCard label="Browser Tests" value={browserTests}
              subtitle={totalTests > 0 ? `${Math.round((browserTests / totalTests) * 100)}% of total` : ''} />
            <MetricCard label="Alerting" value={alertTests.length}
              subtitle={alertTests.length > 0 ? 'tests failing now' : 'all passing'}
              color={alertTests.length > 0 ? 'red' : 'green'} />
            <MetricCard label="Est. Monthly Runs" value={fmtNum(monthlyRuns)}
              subtitle="across all tests" />
          </div>

          {/* Risk signals */}
          {(pausedTests.length > 0 || alertTests.length > 0 || singleLocationTests.length > 0) && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Active Signals</h2>
              {alertTests.length > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-red-50 border-red-200">
                  <span className="text-lg">🚨</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-red-800">{alertTests.length} test{alertTests.length > 1 ? 's' : ''} currently alerting</div>
                    <div className="text-xs text-red-600 mt-0.5">
                      {alertTests.slice(0, 3).map(t => t.name).join(', ')}{alertTests.length > 3 ? ` +${alertTests.length - 3} more` : ''}
                    </div>
                  </div>
                  <DDLink href={ddUrl.syntheticsAlerts(base)} label="View alerts" />
                </div>
              )}
              {pausedTests.length > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-amber-50 border-amber-200">
                  <span className="text-lg">⏸</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-amber-800">{pausedTests.length} test{pausedTests.length > 1 ? 's' : ''} paused</div>
                    <div className="text-xs text-amber-600 mt-0.5">Paused tests provide no monitoring coverage. Review and resume or delete.
                      <br />{pausedTests.slice(0, 4).map(t => t.name).join(', ')}{pausedTests.length > 4 ? ` +${pausedTests.length - 4}` : ''}
                    </div>
                  </div>
                  <DDLink href={ddUrl.syntheticsPaused(base)} label="View paused" />
                </div>
              )}
              {singleLocationTests.length > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-blue-50 border-blue-100">
                  <span className="text-lg">📍</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-blue-800">{singleLocationTests.length} test{singleLocationTests.length > 1 ? 's' : ''} running from a single location</div>
                    <div className="text-xs text-blue-600 mt-0.5">Single-location tests can't distinguish regional outages from global ones. Use 3+ locations for critical paths.</div>
                  </div>
                  <DDLink href={ddUrl.syntheticsTests(base)} label="Edit tests" />
                </div>
              )}
            </div>
          )}

          {/* Test breakdown */}
          {details.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Test type breakdown */}
              <div className="card">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Test Type Breakdown</h2>
                <div className="space-y-2">
                  {Object.entries(testsByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                    const pct = totalTests > 0 ? Math.round((count / totalTests) * 100) : 0;
                    return (
                      <div key={type} className="flex items-center gap-3">
                        <span className="w-28 text-xs text-gray-600 capitalize">{type}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div className="h-2 bg-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-16 text-right text-xs text-gray-500 font-mono">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Location distribution */}
              <div className="card">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Location Coverage</h2>
                <div className="space-y-2">
                  {[
                    { label: '1 location', count: details.filter(t => t.locations === 1).length, risk: true },
                    { label: '2 locations', count: details.filter(t => t.locations === 2).length, risk: false },
                    { label: '3–5 locations', count: details.filter(t => t.locations >= 3 && t.locations <= 5).length, risk: false },
                    { label: '6+ locations', count: details.filter(t => t.locations >= 6).length, risk: false },
                  ].filter(r => r.count > 0).map(row => (
                    <div key={row.label} className="flex items-center gap-3">
                      <span className={`w-24 text-xs ${row.risk ? 'text-amber-600 font-medium' : 'text-gray-600'}`}>{row.label}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className={`h-2 rounded-full ${row.risk ? 'bg-amber-400' : 'bg-green-400'}`}
                          style={{ width: `${totalTests > 0 ? (row.count / totalTests) * 100 : 0}%` }} />
                      </div>
                      <span className="w-8 text-right text-xs text-gray-500 font-mono">{row.count}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-3 border-t border-gray-100 pt-2">
                  Best practice: use 3+ geographic locations for production-critical tests
                </p>
              </div>
            </div>
          )}

          {/* Test table */}
          {details.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">Test Inventory ({details.length})</h2>
                <DDLink href={ddUrl.syntheticsTests(base)} label="View all" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Test Name</th>
                      <th className="text-center px-3 py-2">Type</th>
                      <th className="text-center px-3 py-2">Status</th>
                      <th className="text-right px-3 py-2">Locations</th>
                      <th className="text-right px-3 py-2">Est. Runs/mo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {details.slice(0, 30).map((t, i) => (
                      <tr key={i} className={`hover:bg-violet-50/20 ${t.status === 'alert' ? 'bg-red-50/30' : t.status === 'paused' ? 'bg-gray-50/60' : 'bg-white'}`}>
                        <td className="px-4 py-2 text-sm text-gray-900 max-w-[220px] truncate" title={t.name}>{t.name}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded capitalize">{t.type}</span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium capitalize ${
                            t.status === 'alert' ? 'bg-red-100 text-red-700'
                            : t.status === 'paused' ? 'bg-gray-200 text-gray-600'
                            : t.status === 'ok' ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-xs font-mono ${t.locations <= 1 ? 'text-amber-600 font-semibold' : 'text-gray-700'}`}>
                            {t.locations}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-gray-500 font-mono">{fmtNum(t.estimatedMonthlyRuns)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {details.length > 30 && (
                  <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                    <span>Showing 30 of {details.length} tests</span>
                    <DDLink href={ddUrl.syntheticsTests(base)} label="View all in Datadog" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Findings */}
          {findings.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">Synthetics Findings ({findings.length})</h2>
              <EvidenceTable findings={findings} />
            </div>
          )}

          {/* Investigation links */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Investigate in Datadog</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {[
                { label: 'All synthetic tests', href: ddUrl.syntheticsTests(base) },
                { label: 'Alerting tests', href: ddUrl.syntheticsAlerts(base) },
                { label: 'Paused tests', href: ddUrl.syntheticsPaused(base) },
                { label: 'Create API test', href: `${base}/synthetics/create` },
                { label: 'CI/CD pipeline tests', href: `${base}/synthetics/ci` },
                { label: 'Private locations', href: `${base}/synthetics/settings/private-locations` },
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

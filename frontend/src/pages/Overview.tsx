import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { orgsApi, scansApi, inventoryApi } from '../services/api';
import { OrgScorecardCard } from '../components/common/ScoreCard';
import MetricCard from '../components/common/MetricCard';
import LoadingState, { EmptyState } from '../components/common/LoadingState';
import { ScanStatusBadge } from '../components/common/StatusBadge';
import { useOrgs, useScans } from '../hooks/useOrgs';
import { formatDistanceToNow } from 'date-fns';
import type { Org } from '../types';

export default function Overview() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: orgs = [], isLoading: orgsLoading } = useOrgs();

  const primaryOrg = orgs[0];
  const { data: scans = [] } = useScans(primaryOrg?.id);
  const latestScan = scans.find((s) => s.status === 'completed');

  const { data: inventory } = useQuery({
    queryKey: ['inventory-summary', primaryOrg?.id, latestScan?.id],
    queryFn: () => inventoryApi.summary(primaryOrg!.id, latestScan!.id),
    enabled: Boolean(primaryOrg?.id && latestScan?.id),
  });

  const { data: scorecard } = useQuery({
    queryKey: ['scorecard', latestScan?.id],
    queryFn: () => scansApi.getScorecard(latestScan!.id),
    enabled: Boolean(latestScan?.id),
  });

  const startScan = useMutation({
    mutationFn: (orgId: string) => scansApi.start(orgId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['orgs'] });
    },
  });

  if (orgsLoading) return <LoadingState message="Loading organizations..." />;

  if (orgs.length === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <EmptyState
          message="No organizations connected yet"
          action={
            <button className="btn-primary" onClick={() => navigate('/orgs')}>
              Connect your first Datadog org
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
          <p className="text-gray-500 text-sm mt-1">
            Architecture health status across {orgs.length} org{orgs.length !== 1 ? 's' : ''}
          </p>
        </div>
        {primaryOrg && (
          <button
            className="btn-primary"
            disabled={startScan.isPending || primaryOrg.lastScanStatus === 'running'}
            onClick={() => startScan.mutate(primaryOrg.id)}
          >
            {primaryOrg.lastScanStatus === 'running' ? '⟳ Scanning...' : '▶ Run Scan'}
          </button>
        )}
      </div>

      {/* Org pills */}
      <div className="flex flex-wrap gap-3">
        {orgs.map((org) => (
          <OrgStatusPill key={org.id} org={org} onScan={() => startScan.mutate(org.id)} />
        ))}
      </div>

      {/* Scorecard */}
      {scorecard && (
        <OrgScorecardCard
          scorecard={scorecard}
          onCategoryClick={(cat) => {
            const routes: Record<string, string> = {
              unified_tagging: '/tagging-scorecard', service_architecture: '/services',
              monitors_health: '/monitors', logs_health: '/logs', dashboards_health: '/dashboards',
              synthetics_health: '/synthetics', integration_hygiene: '/integrations',
              governance: '/governance',
            };
            navigate(routes[cat.category] ?? '/recommendations');
          }}
        />
      )}

      {/* Inventory summary */}
      {inventory && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Inventory</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Hosts" value={inventory.hosts} icon="🖥" onClick={() => navigate('/inventory')} />
            <MetricCard label="APM Services" value={inventory.services} icon="⚡" onClick={() => navigate('/services')} />
            <MetricCard label="Monitors" value={inventory.monitors} icon="🔔" onClick={() => navigate('/monitors')} />
            <MetricCard label="Dashboards" value={inventory.dashboards} icon="📈" onClick={() => navigate('/dashboards')} />
            <MetricCard label="Synthetics" value={inventory.syntheticsTests} icon="🌐" onClick={() => navigate('/synthetics')} />
            <MetricCard label="Log Indexes" value={inventory.logsIndexes} icon="📋" onClick={() => navigate('/logs')} />
            <MetricCard label="Cloud Accounts" value={inventory.cloudAccounts} icon="☁" onClick={() => navigate('/network')} />
            <MetricCard
              label="env Tag Coverage"
              value={`${inventory.envTagCoverage}%`}
              icon="🏷"
              color={inventory.envTagCoverage >= 90 ? 'green' : inventory.envTagCoverage >= 70 ? 'amber' : 'red'}
              onClick={() => navigate('/tagging-scorecard')}
            />
          </div>
        </div>
      )}

      {/* Recent scans */}
      {scans.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Scans</h2>
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Started</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Findings</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {scans.slice(0, 5).map((scan) => (
                  <tr key={scan.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/scans')}>
                    <td className="px-4 py-3 text-gray-700">
                      {formatDistanceToNow(new Date(scan.startedAt), { addSuffix: true })}
                    </td>
                    <td className="px-4 py-3">
                      <ScanStatusBadge status={scan.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-700">{scan.findingCount ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                      {scan.completedAt
                        ? `${Math.round((new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000)}s`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function OrgStatusPill({ org, onScan }: { org: Org; onScan: () => void }) {
  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-2.5 shadow-sm">
      <div>
        <div className="text-sm font-medium text-gray-900">{org.name}</div>
        <div className="text-xs text-gray-500">{org.site}</div>
      </div>
      <ScanStatusBadge status={org.lastScanStatus ?? 'pending'} />
      {org.lastScanStatus !== 'running' && (
        <button onClick={onScan} className="text-xs text-dd-purple hover:text-dd-purple-dark ml-1">
          Scan
        </button>
      )}
    </div>
  );
}

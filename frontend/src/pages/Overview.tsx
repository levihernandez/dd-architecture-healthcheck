import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { orgsApi, scansApi, inventoryApi } from '../services/api';
import { OrgScorecardCard } from '../components/common/ScoreCard';
import MetricCard from '../components/common/MetricCard';
import { EmptyState } from '../components/common/LoadingState';
import { ScanStatusBadge } from '../components/common/StatusBadge';
import PageHeader from '../components/ui/PageHeader';
import DataTable, { type Column } from '../components/common/DataTable';
import { SkeletonCards } from '../components/ui/Skeleton';
import { useOrgs, useScans } from '../hooks/useOrgs';
import { formatDistanceToNow } from 'date-fns';
import type { Org, ScanRun } from '../types';

export default function Overview() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: orgs = [], isLoading: orgsLoading } = useOrgs();

  const primaryOrg = orgs[0];
  const { data: scans = [] } = useScans(primaryOrg?.id);
  const latestScan = scans.find((s) => s.status === 'completed');

  const { data: inventory, isLoading: inventoryLoading } = useQuery({
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
    onSuccess: (_data, orgId) => {
      const org = orgs.find((o) => o.id === orgId);
      toast.success(`Scan started${org ? ` for ${org.name}` : ''}`);
      qc.invalidateQueries({ queryKey: ['scans'] });
      qc.invalidateQueries({ queryKey: ['orgs'] });
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to start scan'),
  });

  const scanColumns: Column<ScanRun>[] = [
    {
      key: 'startedAt',
      header: 'Started',
      sortable: true,
      sortAccessor: (s) => new Date(s.startedAt).getTime(),
      render: (s) => formatDistanceToNow(new Date(s.startedAt), { addSuffix: true }),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (s) => <ScanStatusBadge status={s.status} />,
    },
    {
      key: 'findingCount',
      header: 'Findings',
      sortable: true,
      render: (s) => s.findingCount ?? '—',
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (s) =>
        s.completedAt ? (
          <span className="font-mono text-xs">
            {Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)}s
          </span>
        ) : (
          '—'
        ),
    },
  ];

  if (orgsLoading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <PageHeader title="Overview" subtitle="Loading organizations..." />
        <SkeletonCards count={4} />
      </div>
    );
  }

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
      <PageHeader
        title="Overview"
        subtitle={`Architecture health status across ${orgs.length} org${orgs.length !== 1 ? 's' : ''}`}
        actions={
          primaryOrg && (
            <button
              className="btn-primary"
              disabled={startScan.isPending || primaryOrg.lastScanStatus === 'running'}
              onClick={() => startScan.mutate(primaryOrg.id)}
            >
              {primaryOrg.lastScanStatus === 'running' ? '⟳ Scanning...' : '▶ Run Scan'}
            </button>
          )
        }
      />

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
      {inventoryLoading && Boolean(primaryOrg?.id && latestScan?.id) && (
        <div>
          <h2 className="text-lg font-semibold text-ink mb-3">Inventory</h2>
          <SkeletonCards count={8} />
        </div>
      )}
      {inventory && (
        <div>
          <h2 className="text-lg font-semibold text-ink mb-3">Inventory</h2>
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-ink">Recent Scans</h2>
            <button className="text-xs text-dd-purple hover:text-dd-purple-dark" onClick={() => navigate('/scans')}>
              View all →
            </button>
          </div>
          <DataTable
            columns={scanColumns}
            data={scans.slice(0, 5)}
            rowKey={(scan) => scan.id}
            onRowClick={() => navigate('/scans')}
          />
        </div>
      )}
    </div>
  );
}

function OrgStatusPill({ org, onScan }: { org: Org; onScan: () => void }) {
  return (
    <div className="flex items-center gap-3 bg-white border border-border rounded-lg px-4 py-2.5 shadow-sm">
      <div>
        <div className="text-sm font-medium text-ink">{org.name}</div>
        <div className="text-xs text-ink-faint">{org.site}</div>
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

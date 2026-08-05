import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { orgsApi, scansApi, inventoryApi } from '../services/api';
import { OrgScorecardCard, ScoreGauge } from '../components/common/ScoreCard';
import MetricCard from '../components/common/MetricCard';
import { EmptyState } from '../components/common/LoadingState';
import { ScanStatusBadge, GradeBadge } from '../components/common/StatusBadge';
import PageHeader from '../components/ui/PageHeader';
import DataTable, { type Column } from '../components/common/DataTable';
import { SkeletonCards } from '../components/ui/Skeleton';
import { useOrgs, useScans } from '../hooks/useOrgs';
import { formatDistanceToNow } from 'date-fns';
import type { Org, ScanRun, OrgScorecard } from '../types';

type OrgOverview = Org & { scorecard: OrgScorecard | null };

export default function Overview() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: orgs = [], isLoading: orgsLoading } = useOrgs();
  const [filterOrgId, setFilterOrgId] = useState<string | null>(null);

  const { data: overview = [], isLoading: overviewLoading } = useQuery({
    queryKey: ['orgs-overview'],
    queryFn: orgsApi.overview,
  });

  const selectedOrg = filterOrgId ? orgs.find((o) => o.id === filterOrgId) : undefined;

  const { data: scans = [] } = useScans(selectedOrg?.id);
  const latestScan = scans.find((s) => s.status === 'completed');

  const { data: inventory, isLoading: inventoryLoading } = useQuery({
    queryKey: ['inventory-summary', selectedOrg?.id, latestScan?.id],
    queryFn: () => inventoryApi.summary(selectedOrg!.id, latestScan!.id),
    enabled: Boolean(selectedOrg?.id && latestScan?.id),
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
      qc.invalidateQueries({ queryKey: ['orgs-overview'] });
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

  const scoredOrgs = overview.filter((o) => o.scorecard);
  const avgScore = scoredOrgs.length
    ? Math.round(scoredOrgs.reduce((sum, o) => sum + o.scorecard!.overallScore, 0) / scoredOrgs.length)
    : null;
  const totalCritical = overview.reduce((sum, o) => sum + (o.scorecard?.criticalFindings ?? 0), 0);
  const totalHigh = overview.reduce((sum, o) => sum + (o.scorecard?.highFindings ?? 0), 0);
  const needsAttention = overview.filter((o) => o.scorecard?.overallGrade === 'critical' || o.scorecard?.overallGrade === 'needs_attention').length;

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Overview"
        subtitle={
          selectedOrg
            ? `Architecture health for ${selectedOrg.name}`
            : `Architecture health status across ${orgs.length} org${orgs.length !== 1 ? 's' : ''}`
        }
        actions={
          selectedOrg ? (
            <div className="flex items-center gap-2">
              <button className="btn-secondary" onClick={() => setFilterOrgId(null)}>
                ← All Orgs
              </button>
              <button
                className="btn-primary"
                disabled={startScan.isPending || selectedOrg.lastScanStatus === 'running'}
                onClick={() => startScan.mutate(selectedOrg.id)}
              >
                {selectedOrg.lastScanStatus === 'running' ? '⟳ Scanning...' : '▶ Run Scan'}
              </button>
            </div>
          ) : undefined
        }
      />

      {/* Org selector */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setFilterOrgId(null)}
          className={clsx(
            'text-sm font-medium px-4 py-2.5 rounded-lg border transition-all',
            !filterOrgId ? 'border-dd-purple bg-dd-purple/5 text-dd-purple-dark' : 'border-border bg-surface-subtle text-ink-muted hover:border-border-strong'
          )}
        >
          All Orgs
        </button>
        {orgs.map((org) => (
          <OrgStatusPill
            key={org.id}
            org={org}
            selected={filterOrgId === org.id}
            onSelect={() => setFilterOrgId(org.id)}
            onScan={() => startScan.mutate(org.id)}
          />
        ))}
      </div>

      {!selectedOrg ? (
        <MultiOrgRollup
          overview={overview}
          isLoading={overviewLoading}
          avgScore={avgScore}
          totalCritical={totalCritical}
          totalHigh={totalHigh}
          needsAttention={needsAttention}
          onSelectOrg={setFilterOrgId}
        />
      ) : (
        <>
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
          {inventoryLoading && Boolean(selectedOrg?.id && latestScan?.id) && (
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
                <MetricCard
                  label="Security Findings" value={inventory.securityFindings} icon="🛡"
                  color={inventory.securityFindings > 0 ? 'amber' : 'green'}
                  onClick={() => navigate('/analytics')}
                />
                <MetricCard
                  label="Open Incidents" value={inventory.openIncidents} icon="🚨"
                  color={inventory.openIncidents > 0 ? 'red' : 'green'}
                  onClick={() => navigate('/analytics')}
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
        </>
      )}
    </div>
  );
}

function MultiOrgRollup({
  overview, isLoading, avgScore, totalCritical, totalHigh, needsAttention, onSelectOrg,
}: {
  overview: OrgOverview[];
  isLoading: boolean;
  avgScore: number | null;
  totalCritical: number;
  totalHigh: number;
  needsAttention: number;
  onSelectOrg: (orgId: string) => void;
}) {
  if (isLoading) {
    return <SkeletonCards count={4} />;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Avg. Health Score" value={avgScore ?? '—'} icon="📊" color={avgScore !== null && avgScore >= 90 ? 'green' : avgScore !== null && avgScore >= 70 ? 'amber' : 'default'} />
        <MetricCard label="Orgs Needing Attention" value={needsAttention} icon="⚠" color={needsAttention > 0 ? 'red' : 'green'} />
        <MetricCard label="Critical Findings" value={totalCritical} icon="🔴" color={totalCritical > 0 ? 'red' : 'green'} />
        <MetricCard label="High Findings" value={totalHigh} icon="🟠" color={totalHigh > 0 ? 'amber' : 'green'} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-ink mb-3">By Organization</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {overview.map((org) => (
            <OrgHealthCard key={org.id} org={org} onClick={() => onSelectOrg(org.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function OrgHealthCard({ org, onClick }: { org: OrgOverview; onClick: () => void }) {
  const sc = org.scorecard;
  return (
    <div
      className="card cursor-pointer hover:shadow-md hover:border-dd-purple/40 transition-all"
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-semibold text-ink">{org.name}</div>
          <div className="text-xs text-ink-faint">{org.site}</div>
        </div>
        <ScanStatusBadge status={org.lastScanStatus ?? 'pending'} />
      </div>

      {sc ? (
        <div className="flex items-center gap-4">
          <ScoreGauge score={sc.overallScore} grade={sc.overallGrade} size="sm" />
          <div className="flex-1">
            <GradeBadge grade={sc.overallGrade} />
            <div className="mt-1.5 flex gap-3 text-xs">
              <span className={clsx('font-medium', sc.criticalFindings > 0 ? 'text-red-400' : 'text-ink-faint')}>
                {sc.criticalFindings} critical
              </span>
              <span className={clsx('font-medium', sc.highFindings > 0 ? 'text-orange-500' : 'text-ink-faint')}>
                {sc.highFindings} high
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-faint">No completed scan yet</p>
      )}

      {org.lastScanAt && (
        <p className="text-xs text-ink-faint mt-3">
          Last scan {formatDistanceToNow(new Date(org.lastScanAt), { addSuffix: true })}
        </p>
      )}
    </div>
  );
}

function OrgStatusPill({
  org, selected, onSelect, onScan,
}: { org: Org; selected: boolean; onSelect: () => void; onScan: () => void }) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 bg-surface-subtle border rounded-lg px-4 py-2.5 shadow-sm cursor-pointer transition-all',
        selected ? 'border-dd-purple ring-1 ring-dd-purple/30' : 'border-border hover:border-border-strong'
      )}
      onClick={onSelect}
    >
      <div>
        <div className="text-sm font-medium text-ink">{org.name}</div>
        <div className="text-xs text-ink-faint">{org.site}</div>
      </div>
      <ScanStatusBadge status={org.lastScanStatus ?? 'pending'} />
      {org.lastScanStatus !== 'running' && (
        <button
          onClick={(e) => { e.stopPropagation(); onScan(); }}
          className="text-xs text-dd-purple hover:text-dd-purple-dark ml-1"
        >
          Scan
        </button>
      )}
    </div>
  );
}

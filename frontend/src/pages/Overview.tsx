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
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import SectionGate from '../components/SectionGate';
import { formatDistanceToNow } from 'date-fns';
import type { Org, ScanRun, OrgScorecard } from '../types';

type OrgOverview = Org & { scorecard: OrgScorecard | null };

const GUIDE_COLLAPSED_KEY = 'dd-hc:overview-guide-collapsed';

interface GuideStep {
  n: number;
  title: string;
  hub: string;
  path?: string;
  linkLabel?: string;
  find: string;
  why: string;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    n: 1,
    title: 'Connect an organization',
    hub: 'Organizations',
    path: '/orgs',
    linkLabel: 'Org Connections',
    find: 'Sidebar → Organizations → Org Connections. Paste a read-only API key + Application key for the Datadog org you want to audit.',
    why: 'Every other page in this app is empty until an org exists — this is the only step nothing else can substitute for.',
  },
  {
    n: 2,
    title: 'Pick an industry template (optional)',
    hub: 'Organizations',
    path: '/tag-templates',
    linkLabel: 'Industry Templates',
    find: 'Sidebar → Organizations → Industry Templates. Choose the closest match (e.g. E-commerce, Healthcare, Cruise Lines) or stick with the generic baseline.',
    why: "Sets which tags beyond env/service/version this org gets scored against, and feeds the industry-specific tags into the Bits AI prompts in step 7.",
  },
  {
    n: 3,
    title: 'Run a scan',
    hub: 'Organizations',
    path: '/scans',
    linkLabel: 'Scan Runs',
    find: 'The "▶ Run Scan" button right here on Overview (once an org is selected above), or Sidebar → Organizations → Scan Runs for history.',
    why: 'The 10 read-only collectors populate every inventory count, finding, and score in this app — nothing below this point has data before a scan completes.',
  },
  {
    n: 4,
    title: 'Read the Scorecard',
    hub: 'Home',
    find: 'Right here on Overview, once an org with a completed scan is selected — the gauge plus 9 weighted category scores.',
    why: 'One number tells you if things are fine; the category breakdown tells you where to look first. Click any category to jump straight to its page.',
  },
  {
    n: 5,
    title: 'Drill into Inventory & Health Checks',
    hub: 'Inventory · Health Checks',
    path: '/inventory',
    linkLabel: 'Inventory Explorer',
    find: 'Sidebar → Inventory (raw hosts/services/dashboards counts) and Sidebar → Health Checks (Monitors, Dashboards, Logs, Synthetics, Governance — one page per category).',
    why: 'The scorecard tells you *that* something is wrong; these pages show *which specific resources* and *what exactly* needs fixing, with evidence.',
  },
  {
    n: 6,
    title: 'Go deep on tagging',
    hub: 'Tagging Intelligence',
    path: '/tagging-scorecard',
    linkLabel: 'Unified Tagging',
    find: 'Sidebar → Tagging Intelligence → Unified Tagging, Tag Explorer, Tag Normalization, Cloud Alignment, Multi-Org Governance.',
    why: 'Unified Service Tagging is weighted highest (30%) in the scorecard and is the category most orgs get wrong first — it has its own hub because of how much leverage fixing it has.',
  },
  {
    n: 7,
    title: 'Get AI-assisted analysis',
    hub: 'AI & Analysis',
    path: '/ai',
    linkLabel: 'AI Assessment',
    find: 'Sidebar → AI & Analysis → AI Assessment (executive summary), AI Chat Advisor (ask anything about this org), Recommendations (prioritized punch list).',
    why: 'Turns raw findings and percentages into prose and priority a non-engineer stakeholder can actually read and act on.',
  },
  {
    n: 8,
    title: 'Turn advice into action with Bits AI',
    hub: 'Organizations',
    path: '/tag-templates',
    linkLabel: 'How tagging works',
    find: 'Industry Templates page → "📚 How tagging works" → scroll to the bottom for "Ready to assess your maturity?" and "Ready to fix it?" — copy either prompt into Bits AI.',
    why: 'This app is read-only and never writes to your org. These prompts hand execution to Bits AI, which already runs with your org\'s real permissions, so advice actually gets applied.',
  },
  {
    n: 9,
    title: 'Export and re-scan to track progress',
    hub: 'More · Organizations',
    path: '/export',
    linkLabel: 'Export Center',
    find: 'Sidebar → More → Export Center to hand off a report (JSON/CSV/Markdown/PDF); Sidebar → Organizations → Scan Comparison after a later scan to see the trend.',
    why: "Closes the loop — proves whether the fixes from steps 6-8 actually moved the score, instead of just feeling like progress.",
  },
];

function GettingStartedGuide() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(GUIDE_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore storage failures (private browsing, quota, etc.)
      }
      return next;
    });
  }

  return (
    <div className="card border-dd-purple/30 bg-dd-purple/5">
      <button onClick={toggle} className="w-full flex items-center justify-between gap-2 text-left">
        <div>
          <h2 className="text-sm font-semibold text-ink">🧭 How to use this tool</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            The intended path through this app, step by step — where each thing lives and why it matters.
          </p>
        </div>
        <span className={clsx('text-ink-faint transition-transform text-sm shrink-0', collapsed && '-rotate-90')}>▾</span>
      </button>

      {!collapsed && (
        <div className="mt-4 space-y-3">
          {GUIDE_STEPS.map((s) => (
            <div key={s.n} className="flex gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-dd-purple/40 text-dd-purple-dark flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                {s.n}
              </div>
              <div className="min-w-0 flex-1 pb-3 border-b border-border last:border-b-0 last:pb-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-ink">{s.title}</h3>
                  <span className="text-[10px] uppercase tracking-wide font-medium text-dd-purple-dark bg-dd-purple/10 border border-dd-purple/20 rounded px-1.5 py-0.5 shrink-0">
                    {s.hub}
                  </span>
                </div>
                <p className="text-xs text-ink-muted mt-1">
                  <span className="font-medium text-ink-faint">Where: </span>{s.find}
                </p>
                <p className="text-xs text-ink-muted mt-1">
                  <span className="font-medium text-ink-faint">Why: </span>{s.why}
                </p>
                {s.path && (
                  <button
                    onClick={() => navigate(s.path!)}
                    className="text-xs text-dd-purple hover:text-dd-purple-dark mt-1.5 font-medium"
                  >
                    Go to {s.linkLabel} →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: orgs = [], isLoading: orgsLoading } = useOrgs();
  const [filterOrgId, setFilterOrgId] = useState<string | null>(null);
  const { isPageEnabled } = useFeatureFlags();
  const scanEnabled = isPageEnabled('scan');

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
                disabled={startScan.isPending || selectedOrg.lastScanStatus === 'running' || !scanEnabled}
                onClick={() => startScan.mutate(selectedOrg.id)}
                title={scanEnabled ? undefined : 'Scanning is disabled by an admin in Feature Flags'}
              >
                {selectedOrg.lastScanStatus === 'running' ? '⟳ Scanning...' : '▶ Run Scan'}
              </button>
            </div>
          ) : undefined
        }
      />

      <SectionGate featureKey="section.overview.getting_started">
        <GettingStartedGuide />
      </SectionGate>

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
            scanEnabled={scanEnabled}
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
          <SectionGate featureKey="section.overview.inventory_summary">
            <>
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
            </>
          </SectionGate>

          {/* Recent scans */}
          <SectionGate featureKey="section.overview.recent_scans">
            <>
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
          </SectionGate>
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
      <SectionGate featureKey="section.overview.stat_tiles">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Avg. Health Score" value={avgScore ?? '—'} icon="📊" color={avgScore !== null && avgScore >= 90 ? 'green' : avgScore !== null && avgScore >= 70 ? 'amber' : 'default'} />
          <MetricCard label="Orgs Needing Attention" value={needsAttention} icon="⚠" color={needsAttention > 0 ? 'red' : 'green'} />
          <MetricCard label="Critical Findings" value={totalCritical} icon="🔴" color={totalCritical > 0 ? 'red' : 'green'} />
          <MetricCard label="High Findings" value={totalHigh} icon="🟠" color={totalHigh > 0 ? 'amber' : 'green'} />
        </div>
      </SectionGate>

      <SectionGate featureKey="section.overview.by_org">
        <div>
          <h2 className="text-lg font-semibold text-ink mb-3">By Organization</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {overview.map((org) => (
              <OrgHealthCard key={org.id} org={org} onClick={() => onSelectOrg(org.id)} />
            ))}
          </div>
        </div>
      </SectionGate>
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
  org, selected, onSelect, onScan, scanEnabled,
}: { org: Org; selected: boolean; onSelect: () => void; onScan: () => void; scanEnabled: boolean }) {
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
          disabled={!scanEnabled}
          title={scanEnabled ? undefined : 'Scanning is disabled by an admin in Feature Flags'}
          className="text-xs text-dd-purple hover:text-dd-purple-dark ml-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Scan
        </button>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../services/api';
import SectionGate from '../components/SectionGate';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { EmptyState } from '../components/common/LoadingState';
import MetricCard from '../components/common/MetricCard';
import { GradeBadge } from '../components/common/StatusBadge';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton';
import DataTable, { type Column } from '../components/common/DataTable';
import { CATEGORICAL, STATUS, trackTint } from '../lib/chartColors';
import type { HostGapRow, ProductGap, ServiceMaturityRow } from '../types';

const SEVERITY_COLOR: Record<ProductGap['severity'], string> = {
  critical: STATUS.critical, high: STATUS.serious, medium: STATUS.warning, low: STATUS.good,
};
const SEVERITY_BADGE: Record<ProductGap['severity'], string> = {
  critical: 'bg-red-500/15 text-red-400', high: 'bg-orange-500/15 text-orange-400',
  medium: 'bg-amber-500/15 text-amber-400', low: 'bg-green-500/15 text-green-400',
};

function ProductGapCard({ gap }: { gap: ProductGap }) {
  const [open, setOpen] = useState(false);
  const color = SEVERITY_COLOR[gap.severity];
  return (
    <div className="card">
      <button className="w-full text-left" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center gap-3">
          <span className="text-xl shrink-0">{gap.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink text-sm">{gap.product}</span>
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${SEVERITY_BADGE[gap.severity]}`}>
                {gap.severity}
              </span>
            </div>
            <div className="text-xs text-ink-faint mt-0.5">
              {gap.hostsCoveredEstimate} / {gap.totalHosts} hosts covered · {gap.gapCount} gap
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-bold" style={{ color }}>{gap.coveragePct}%</div>
          </div>
          <span className="text-ink-faint text-xs shrink-0">{open ? '▲' : '▼'}</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ backgroundColor: trackTint(color) }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${gap.coveragePct}%`, backgroundColor: color }} />
        </div>
      </button>
      {open && (
        <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-xs">
          <p><span className="font-semibold text-violet-400 uppercase tracking-wide">Why: </span><span className="text-ink-muted">{gap.why}</span></p>
          <p><span className="font-semibold text-blue-400 uppercase tracking-wide">What: </span><span className="text-ink-muted">{gap.what}</span></p>
          <p><span className="font-semibold text-amber-400 uppercase tracking-wide">How: </span><span className="text-ink-muted">{gap.how}</span></p>
          <p><span className="font-semibold text-red-400 uppercase tracking-wide">How much: </span><span className="text-ink-muted">{gap.howMuch}</span></p>
          <p><span className="font-semibold text-green-400 uppercase tracking-wide">Improvement: </span><span className="text-ink-muted">{gap.improvement}</span></p>
        </div>
      )}
    </div>
  );
}

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`text-[10px] px-1 py-0.5 rounded font-mono ${ok ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

export default function HostInstrumentationGaps() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const enabled = Boolean(selectedOrgId && selectedScanId);

  const { data, isLoading } = useQuery({
    queryKey: ['host-gaps', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.hostGaps(selectedOrgId, selectedScanId),
    enabled,
  });

  const hostColumns: Column<HostGapRow>[] = [
    {
      key: 'hostName', header: 'Host', sortable: true,
      render: (h) => (
        <div className="flex items-center gap-1.5">
          {h.isBlindSpot && <span title="Blind spot — no APM match and no env/service tag" className="text-red-400">🕳</span>}
          <span className="font-mono text-xs text-ink">{h.hostName}</span>
        </div>
      ),
    },
    {
      key: 'cloudProvider', header: 'Location / Type', sortable: true,
      render: (h) => (
        <div className="text-xs">
          <span className="capitalize text-ink">{h.cloudProvider}</span>
          <div className="text-ink-faint">
            {[h.region, h.availabilityZone, h.instanceType].filter(Boolean).join(' · ') || 'not reported'}
          </div>
        </div>
      ),
    },
    { key: 'platform', header: 'Platform', sortable: true, render: (h) => <span className="text-xs text-ink-muted">{h.platform ?? '—'}</span> },
    { key: 'agentVersion', header: 'Agent', sortable: true, render: (h) => <span className="text-xs font-mono text-ink-faint">{h.agentVersion ?? '—'}</span> },
    {
      key: 'apm', header: 'APM', sortable: true, sortAccessor: (h) => (h.hasApm ? 1 : 0),
      render: (h) => (
        h.hasApm
          ? <span className="text-xs bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded" title={h.matchedService ?? undefined}>✓ traced</span>
          : <span className="text-xs bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded">✗ none</span>
      ),
    },
    {
      key: 'tags', header: 'Tag Compliance',
      render: (h) => (
        <div className="flex flex-wrap gap-1">
          <Flag ok={h.hasEnvTag} label="env" />
          <Flag ok={h.hasServiceTag} label="service" />
          <Flag ok={h.hasVersionTag} label="version" />
          <Flag ok={h.hasTeamTag} label="team" />
        </div>
      ),
    },
    {
      key: 'checks', header: 'Installed Checks',
      render: (h) => <span className="text-xs text-ink-faint truncate max-w-[220px] inline-block" title={h.installedChecks.join(', ')}>{h.installedChecks.join(', ') || '—'}</span>,
    },
  ];

  const serviceColumns: Column<ServiceMaturityRow>[] = [
    { key: 'serviceName', header: 'Service', sortable: true, render: (s) => <span className="text-sm font-medium text-ink">{s.serviceName}</span> },
    { key: 'env', header: 'Env', sortable: true, render: (s) => <span className="text-xs text-ink-muted">{s.env ?? '—'}</span> },
    { key: 'team', header: 'Team', sortable: true, render: (s) => <span className="text-xs text-ink-muted">{s.team ?? '—'}</span> },
    {
      key: 'score', header: 'Maturity', sortable: true,
      render: (s) => (
        <div className="flex items-center gap-2">
          <GradeBadge grade={s.grade} score={s.score} />
        </div>
      ),
    },
    {
      key: 'missing', header: 'Missing to Improve',
      render: (s) => s.missing.length === 0
        ? <span className="text-xs text-green-400">Nothing — fully mature</span>
        : <span className="text-xs text-ink-faint">{s.missing.join(', ')}</span>,
    },
  ];

  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader
        title="Instrumentation Gaps"
        subtitle="Per-host blind spots across cloud resources — what's missing, why it matters, and which product closes the gap."
      />

      {!selectedScanId ? (
        <EmptyState message="Run a scan to analyze instrumentation coverage" />
      ) : isLoading ? (
        <div className="space-y-6">
          <SkeletonCards count={4} />
          <SkeletonTable rows={8} cols={6} />
        </div>
      ) : !data || data.totalHosts === 0 ? (
        <EmptyState message="No hosts found in this scan" />
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-4 gap-4">
            <MetricCard label="Total Hosts" value={data.totalHosts} icon="🖥️" />
            <MetricCard
              label="Blind Spots"
              value={data.blindSpotCount}
              subtitle="no APM match, no env/service tag"
              icon="🕳"
              color={data.blindSpotCount > 0 ? 'red' : 'green'}
            />
            <MetricCard
              label="Product Gaps"
              value={data.productGaps.filter((g) => g.gapCount > 0).length}
              subtitle="of 4 checked products"
              icon="🧩"
              color={data.productGaps.some((g) => g.severity === 'critical') ? 'red' : 'amber'}
            />
            <MetricCard
              label="Avg Service Maturity"
              value={`${data.serviceMaturity.avgScore}%`}
              subtitle={`${data.serviceMaturity.services.length} services`}
              icon="📋"
              color={data.serviceMaturity.avgScore >= 75 ? 'green' : data.serviceMaturity.avgScore >= 50 ? 'amber' : 'red'}
            />
          </div>

          {/* Product gaps */}
          {data.productGaps.length > 0 && (
            <SectionGate featureKey="section.host_gaps.coverage_gaps">
              <section>
                <h2 className="text-lg font-bold text-ink mb-1">Product Coverage Gaps</h2>
                <p className="text-sm text-ink-muted mb-3">
                  Where instrumenting more hosts would close a real visibility gap — click a card for why/what/how/cost/impact.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {data.productGaps.map((g) => <ProductGapCard key={g.product} gap={g} />)}
                </div>
              </section>
            </SectionGate>
          )}

          {/* App breakdown */}
          {data.appBreakdown.length > 0 && (
            <SectionGate featureKey="section.host_gaps.app_breakdown">
              <section>
                <h2 className="text-lg font-bold text-ink mb-1">App Breakdown</h2>
                <p className="text-sm text-ink-muted mb-3">Hosts vs. serverless — tag coverage is only verifiable where there's a per-resource inventory today.</p>
                <div className="grid grid-cols-3 gap-3">
                  {data.appBreakdown.map((a, i) => (
                    <div key={a.type} className="card">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{a.icon}</span>
                        <span className="font-semibold text-ink text-sm">{a.label}</span>
                      </div>
                      <div className="text-2xl font-bold text-ink">{a.count.toLocaleString()}</div>
                      {a.tagCoveragePct !== null ? (
                        <div className="mt-1">
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: trackTint(CATEGORICAL[i % CATEGORICAL.length]) }}>
                            <div className="h-full rounded-full" style={{ width: `${a.tagCoveragePct}%`, backgroundColor: CATEGORICAL[i % CATEGORICAL.length] }} />
                          </div>
                          <div className="text-xs text-ink-faint mt-1">{a.tagCoveragePct}% tag coverage</div>
                        </div>
                      ) : (
                        <div className="text-xs text-amber-400 mt-1">{a.tagCoverageNote}</div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </SectionGate>
          )}

          {/* Host inventory */}
          <SectionGate featureKey="section.host_gaps.host_inventory">
            <section>
              <h2 className="text-lg font-bold text-ink mb-1">Host Inventory & Blind Spots</h2>
              <p className="text-sm text-ink-muted mb-3">
                Cloud placement, APM presence, and tag compliance per host — 🕳 marks hosts Datadog can see but nothing identifies.
              </p>
              <DataTable
                tableId="host-gaps-inventory"
                columns={hostColumns}
                data={data.hosts}
                rowKey={(h) => h.hostName}
                searchable
                pageSize={15}
              />
            </section>
          </SectionGate>

          {/* Service catalog maturity */}
          {data.serviceMaturity.services.length > 0 && (
            <SectionGate featureKey="section.host_gaps.service_catalog_maturity">
              <section>
                <h2 className="text-lg font-bold text-ink mb-1">Service Catalog Maturity</h2>
                <p className="text-sm text-ink-muted mb-3">
                  Composite score: catalog entry (30%) + monitor (30%) + SLO (20%) + version tag (10%) + owning team (10%).
                </p>
                <div className="grid grid-cols-4 gap-3 mb-3">
                  {(['excellent', 'good', 'needs_attention', 'critical'] as const).map((g) => (
                    <div key={g} className="card text-center py-3">
                      <div className="text-xl font-bold text-ink">{data.serviceMaturity.distribution[g]}</div>
                      <GradeBadge grade={g} />
                    </div>
                  ))}
                </div>
                <DataTable
                  tableId="service-maturity"
                  columns={serviceColumns}
                  data={data.serviceMaturity.services}
                  rowKey={(s) => `${s.serviceName}-${s.env ?? ''}`}
                  searchable
                  pageSize={15}
                />
              </section>
            </SectionGate>
          )}
        </>
      )}
    </div>
  );
}

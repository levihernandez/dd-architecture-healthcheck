import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi, taggingApi, tagTemplateApi, scansApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import DataTable from '../components/common/DataTable';
import { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton';
import ResourceFindingCard from '../components/tagging/ResourceFindingCard';
import SectionGate from '../components/SectionGate';

// ─── Static recommendation definitions ────────────────────────────────────────

const REQUIRED_TAGS = [
  {
    key: 'env',
    description: 'Deployment environment (production, staging, dev, qa)',
    applies: ['Infrastructure', 'APM', 'Monitors', 'Synthetics', 'Logs', 'NDM/NPM'],
    why: 'The primary pivot for filtering any dashboard, alert, or SLO. Without env, you cannot isolate production issues from test noise.',
  },
  {
    key: 'service',
    description: 'Service name matching the APM service identifier',
    applies: ['Infrastructure', 'APM', 'Monitors', 'Synthetics'],
    why: 'Enables correlation between infrastructure metrics and application performance. Required for Service Map and service-level SLOs.',
  },
  {
    key: 'version',
    description: 'Application version or release tag (semver or git SHA)',
    applies: ['Infrastructure', 'APM', 'Monitors'],
    why: 'Powers Deployment Tracking — immediately see if a new release introduced a regression in error rate or latency.',
  },
];

const SECTOR_GROUPS = [
  {
    sector: 'Cloud / AWS',
    icon: '☁️',
    detectKeys: ['region', 'availability-zone', 'aws_account_id', 'cloud_provider', 'cloud.provider.name'],
    tags: [
      { key: 'region', description: 'Cloud region (us-east-1) for geographic filtering' },
      { key: 'availability-zone', description: 'AZ for high-availability and failure domain visibility' },
      { key: 'aws_account_id', description: 'AWS account ID for multi-account cost attribution and isolation' },
      { key: 'cloud_provider', description: 'aws | azure | gcp for multi-cloud dashboards' },
    ],
  },
  {
    sector: 'Kubernetes',
    icon: '⎈',
    detectKeys: ['kube_cluster_name', 'cluster_name', 'kube_namespace', 'namespace', 'kube_deployment', 'pod_name'],
    tags: [
      { key: 'kube_cluster_name', description: 'Cluster name — auto-injected by Agent when deployed on K8s' },
      { key: 'kube_namespace', description: 'Namespace for workload isolation and team boundaries' },
      { key: 'kube_deployment', description: 'Deployment name for rollout correlation and rollback detection' },
      { key: 'pod_name', description: 'Pod name — auto-injected; enables per-pod trace and log correlation' },
    ],
  },
  {
    sector: 'Ownership',
    icon: '👥',
    detectKeys: ['team', 'owner', 'cost_center', 'business_unit'],
    tags: [
      { key: 'team', description: 'Owning team — maps directly to Datadog Teams for routing and filtering' },
      { key: 'owner', description: 'Individual or alias for on-call routing and incident ownership' },
      { key: 'cost_center', description: 'Cost attribution for FinOps and chargeback dashboards' },
      { key: 'business_unit', description: 'Business unit for executive-level rollup reporting' },
    ],
  },
  {
    sector: 'Network / NDM',
    icon: '🌐',
    detectKeys: ['device_namespace', 'device.vendor', 'interface', 'snmp_profile', 'snmp_device'],
    tags: [
      { key: 'device_namespace', description: 'NDM: scopes device polling and prevents name collisions across environments' },
      { key: 'device.vendor', description: 'Network device vendor (cisco, juniper) for templated dashboards' },
      { key: 'interface', description: 'Network interface name for flow-level bandwidth attribution' },
      { key: 'snmp_profile', description: 'SNMP profile applied — enables vendor-specific metric enrichment' },
    ],
  },
  {
    sector: 'Lifecycle / Tier',
    icon: '🏷️',
    detectKeys: ['tier', 'lifecycle', 'criticality', 'environment_type'],
    tags: [
      { key: 'tier', description: 'Service tier (frontend, backend, data) for topology grouping' },
      { key: 'lifecycle', description: 'Resource lifecycle state (active, deprecated, canary)' },
      { key: 'criticality', description: 'Business criticality (p0-critical, p1-high) for alert prioritization' },
    ],
  },
];

const CROSS_PRODUCT_TAGS = [
  {
    key: 'host',
    products: ['Infra', 'APM', 'Logs', 'CNM'],
    description: 'The universal pivot key. Automatically correlates infrastructure metrics, APM traces, logs, and network flows by hostname.',
    autoInjected: true,
  },
  {
    key: 'container_id',
    products: ['Containers', 'APM', 'Logs'],
    description: 'Auto-injected by Agent. Enables exact correlation between container metrics, application traces, and container stdout logs.',
    autoInjected: true,
  },
  {
    key: 'dd.trace_id',
    products: ['APM', 'RUM', 'Logs'],
    description: 'Injected into browser and mobile by the RUM SDK. Links a user session action all the way to the backend trace and log lines.',
    autoInjected: true,
  },
  {
    key: 'rum.session.id',
    products: ['RUM', 'Logs'],
    description: 'Injected into logs via MDC/structured logging. Allows replaying the exact user session alongside the logs it produced.',
    autoInjected: false,
  },
  {
    key: 'network.destination.service',
    products: ['CNM', 'APM'],
    description: 'Set by CNM on network flows to match APM service names. Correlates TCP/UDP traffic volume to service-level request rates.',
    autoInjected: false,
  },
  {
    key: 'source',
    products: ['Logs', 'APM'],
    description: 'Enables log pipeline routing and log-to-trace correlation (e.g. source:java enables Java trace injection).',
    autoInjected: false,
  },
  {
    key: 'dd.service',
    products: ['APM', 'Logs', 'RUM'],
    description: 'Unified service name across APM, logs, and RUM. Must match the service tag on infrastructure for the Service Map to connect.',
    autoInjected: true,
  },
];

// ─── Product layers for the hierarchy tree ───────────────────────────────────

type LayerStatus = 'tracked' | 'partial' | 'guidance';

interface ProductLayer {
  id: string;
  label: string;
  icon: string;
  status: LayerStatus;
  description: string;
  requiredTags: string[];
  inheritedTags?: string[];
  note?: string;
}

const PRODUCT_LAYERS: ProductLayer[] = [
  {
    id: 'infra',
    label: 'Infrastructure (Hosts / Agent)',
    icon: '🖥️',
    status: 'tracked',
    description: 'The base layer. Tags applied here propagate to metrics, logs collected by the Agent, and infrastructure dashboards.',
    requiredTags: ['env', 'version', 'team'],
  },
  {
    id: 'containers',
    label: 'Containers / Kubernetes',
    icon: '📦',
    status: 'partial',
    description: 'Auto-injected by Agent (cluster_name, namespace, pod_name). UST tags must also be set on pod specs or via AD annotations to flow into APM.',
    requiredTags: ['env', 'service', 'version'],
    inheritedTags: ['kube_cluster_name', 'kube_namespace', 'pod_name'],
    note: 'Set DD_ENV, DD_SERVICE, DD_VERSION in pod env or use Admission Controller for automatic UST injection.',
  },
  {
    id: 'apm',
    label: 'APM (Services / Traces)',
    icon: '🔵',
    status: 'tracked',
    description: 'Service-level tags determine Service Map topology. version enables Deployment Tracking for error rate comparison across releases.',
    requiredTags: ['env', 'service', 'version'],
  },
  {
    id: 'monitors',
    label: 'Monitors & Alerts',
    icon: '🔔',
    status: 'tracked',
    description: 'Monitors inherit tags from their query scope. Explicit env/service/team tags enable routing, suppression, and service-level scorecards.',
    requiredTags: ['env', 'service', 'team'],
  },
  {
    id: 'synthetics',
    label: 'Synthetics',
    icon: '🟣',
    status: 'tracked',
    description: 'Synthetic test tags power SLO dashboards and alert routing. env:production tests should be isolated from staging tests.',
    requiredTags: ['env', 'service'],
  },
  {
    id: 'logs',
    label: 'Logs (Indexes / Pipelines)',
    icon: '📋',
    status: 'guidance',
    description: 'Log pipelines enrich with service, env, and host from the log payload. Remapping ensures consistency with APM trace tags.',
    requiredTags: ['env', 'service', 'host'],
    inheritedTags: ['source', 'dd.trace_id'],
    note: 'Use Grok parser + remapper to normalize service and env from application log fields. Enable trace correlation by mapping dd.trace_id.',
  },
  {
    id: 'npm_ndm',
    label: 'Network (NPM / NDM / CNM)',
    icon: '🌐',
    status: 'guidance',
    description: 'NPM tags flow traffic by source/dest service and env. NDM applies device_namespace for scoping. CNM maps container-level connections.',
    requiredTags: ['device_namespace', 'env'],
    inheritedTags: ['network.destination.service', 'host'],
    note: 'NPM correlates to APM via network.destination.service matching the APM service tag. Ensure consistent service naming across both.',
  },
  {
    id: 'rum_cnm',
    label: 'RUM / Browser & Mobile',
    icon: '📱',
    status: 'guidance',
    description: 'RUM sessions inject dd.trace_id and rum.session.id enabling full front-to-back correlation with APM traces and logs.',
    requiredTags: ['env', 'service', 'version'],
    inheritedTags: ['dd.trace_id', 'rum.session.id'],
    note: 'Initialize RUM SDK with env, service, version matching your APM config. This enables the full user session → trace → log flow.',
  },
];

// ─── Helper components ────────────────────────────────────────────────────────

function CoverageBar({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return null;
  const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-500';
  const textColor = pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-xs text-ink-muted w-14 shrink-0">{label}</span>
      <div className="flex-1 bg-surface-sunken rounded-full h-1.5 min-w-0">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-medium w-8 text-right shrink-0 ${textColor}`}>{pct}%</span>
    </div>
  );
}

function TagPill({ tagKey }: { tagKey: string }) {
  return (
    <code className="inline-block px-1.5 py-0.5 bg-violet-500/10 text-violet-400 border border-violet-500/30 rounded text-xs font-mono">
      {tagKey}
    </code>
  );
}

function AppliesTo({ layers }: { layers: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {layers.map((l) => (
        <span key={l} className="text-xs bg-surface-sunken text-ink-muted px-1.5 py-0.5 rounded">
          {l}
        </span>
      ))}
    </div>
  );
}

// ─── Hierarchy tree layer card ────────────────────────────────────────────────

type LayerCoverage = Record<string, number | null>;

function HierarchyLayerCard({
  layer,
  coverage,
  isLast,
}: {
  layer: ProductLayer;
  coverage?: LayerCoverage;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);

  const statusBadge =
    layer.status === 'tracked'
      ? <span className="text-xs bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full">Tracked</span>
      : layer.status === 'partial'
      ? <span className="text-xs bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full">Partial</span>
      : <span className="text-xs bg-surface-sunken text-ink-muted px-2 py-0.5 rounded-full">Guidance only</span>;

  return (
    <div className="flex gap-0">
      {/* Connector spine */}
      <div className="flex flex-col items-center w-8 shrink-0">
        <div className="w-3 h-3 rounded-full border-2 border-violet-400 bg-surface-subtle mt-4 shrink-0 z-10" />
        {!isLast && <div className="w-0.5 bg-violet-200 flex-1 mt-1" />}
      </div>

      {/* Card */}
      <div className="flex-1 mb-4">
        <div className="card p-0 overflow-hidden">
          <button
            className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-surface-subtle"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="text-xl">{layer.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-ink">{layer.label}</span>
                {statusBadge}
              </div>
              {/* Inline coverage bars when collapsed */}
              {!open && coverage && (
                <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 max-w-md">
                  {Object.entries(coverage).map(([k, v]) =>
                    v !== null ? <CoverageBar key={k} label={k} pct={v} /> : null
                  )}
                </div>
              )}
            </div>
            <span className="text-ink-faint text-xs">{open ? '▲' : '▼'}</span>
          </button>

          {open && (
            <div className="border-t border-border px-4 py-3 space-y-3">
              <p className="text-sm text-ink-muted">{layer.description}</p>

              {/* Coverage bars */}
              {coverage && (
                <div>
                  <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                    Tag Coverage
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 max-w-lg">
                    {Object.entries(coverage).map(([k, v]) =>
                      v !== null ? <CoverageBar key={k} label={k} pct={v} /> : null
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">
                    Required Tags
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {layer.requiredTags.map((t) => <TagPill key={t} tagKey={t} />)}
                  </div>
                </div>
                {layer.inheritedTags && (
                  <div>
                    <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">
                      Auto-injected / Inherited
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {layer.inheritedTags.map((t) => (
                        <code key={t} className="inline-block px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded text-xs font-mono">
                          {t}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {layer.note && (
                <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
                  💡 {layer.note}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TagExplorer() {
  const { selectedOrgId, selectedScanId } =
    useOrgAndScanFilters();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'required' | 'template' | 'sector' | 'crossproduct'>('required');

  const enabled = Boolean(selectedOrgId && selectedScanId);

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['tags', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.tags(selectedOrgId, selectedScanId),
    enabled,
  });

  const { data: coverage } = useQuery({
    queryKey: ['tag-coverage', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.tagCoverage(selectedOrgId, selectedScanId),
    enabled,
  });

  // The org's selected tagging template (see Industry Templates) — surfaced here
  // as its own tab so the industry-specific tags it defines are checked too, not
  // just the universal UST baseline.
  const { data: activeSelection } = useQuery({
    queryKey: ['tag-template', selectedOrgId],
    queryFn: () => tagTemplateApi.get(selectedOrgId),
    enabled: Boolean(selectedOrgId),
  });
  const templateId = activeSelection?.templateId ?? 'generic';

  const { data: templateScore } = useQuery({
    queryKey: ['tagging-score', selectedOrgId, selectedScanId, templateId],
    queryFn: () => taggingApi.score(selectedOrgId, selectedScanId, templateId),
    enabled,
  });
  const templateTags = templateScore ? [...templateScore.required, ...templateScore.recommended] : [];

  // Real per-resource unified-tagging findings for the "Required (UST)" tab —
  // replaces the old static REQUIRED_TAGS-only view with actual affected
  // hosts/services/monitors/synthetics and Datadog's best-practice guidance.
  const { data: taggingFindings = [] } = useQuery({
    queryKey: ['findings', selectedScanId, 'unified_tagging'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'unified_tagging' }),
    enabled,
  });
  const findingsByTagKey = new Map<string, typeof taggingFindings>();
  for (const f of taggingFindings) {
    const key = f.tagKey ?? f.ruleId;
    if (!findingsByTagKey.has(key)) findingsByTagKey.set(key, []);
    findingsByTagKey.get(key)!.push(f);
  }

  const filtered = tags.filter(
    (t) => !search || t.tag_key.toLowerCase().includes(search.toLowerCase())
  );

  const standardKeys = new Set([
    'env', 'service', 'version', 'team', 'owner', 'cost_center',
    'region', 'tier', 'lifecycle', 'namespace', 'cluster_name',
  ]);
  const standardFound = tags.filter((t) => standardKeys.has(t.tag_key)).length;
  const customCount = tags.length - standardFound;

  const detectedKeys = new Set(coverage?.detectedTagKeys ?? tags.map((t) => t.tag_key));

  const layerCoverageMap: Record<string, LayerCoverage> = {
    infra: coverage
      ? { env: coverage.layers.hosts.env, version: coverage.layers.hosts.version, team: coverage.layers.hosts.team }
      : {},
    apm: coverage
      ? { env: coverage.layers.services.env, service: coverage.layers.services.service, version: coverage.layers.services.version, team: coverage.layers.services.team }
      : {},
    monitors: coverage
      ? { env: coverage.layers.monitors.env, service: coverage.layers.monitors.service, team: coverage.layers.monitors.team }
      : {},
    synthetics: coverage
      ? { env: coverage.layers.synthetics.env, service: coverage.layers.synthetics.service }
      : {},
  };

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader
        title="Tag Explorer"
        subtitle="Tagging recommendations, hierarchy coverage, and tag key inventory"
      />

      {!selectedScanId ? (
        <EmptyState message="Run a scan to explore tags" />
      ) : isLoading ? (
        <div className="space-y-8">
          <SkeletonCards count={4} />
          <SkeletonTable rows={8} cols={5} />
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-4">
            <div className="card text-center">
              <div className="text-3xl font-bold text-ink">{tags.length}</div>
              <div className="text-sm text-ink-muted">Unique Tag Keys</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-green-400">{standardFound}</div>
              <div className="text-sm text-ink-muted">Standard Keys Found</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-blue-400">{customCount}</div>
              <div className="text-sm text-ink-muted">Custom Keys</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-violet-400">
                {coverage?.layers.hosts.total ?? '—'}
              </div>
              <div className="text-sm text-ink-muted">Hosts Scanned</div>
            </div>
          </div>

          {/* ── Section 1: Unified Tagging Recommendations ────────────────── */}
          <SectionGate featureKey="section.tags.required_recommendations">
          <section>
            <h2 className="text-lg font-bold text-ink mb-1">
              Unified Tagging Recommendations
            </h2>
            <p className="text-sm text-ink-muted mb-4">
              A three-tier tagging strategy that enables full-stack observability, cost attribution,
              and cross-product correlation.
            </p>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 border-b border-border">
              {(
                [
                  { id: 'required', label: '🔴 Required (UST)', count: REQUIRED_TAGS.length },
                  { id: 'template', label: `🏷️ ${templateScore?.templateName ?? 'Industry Template'}`, count: templateTags.length },
                  { id: 'sector', label: '🔵 Leverage by Sector', count: SECTOR_GROUPS.length },
                  { id: 'crossproduct', label: '🟣 Cross-product Metadata', count: CROSS_PRODUCT_TAGS.length },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === tab.id
                      ? 'border-violet-600 text-violet-400'
                      : 'border-transparent text-ink-muted hover:text-ink-muted'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Required UST tags */}
            {activeTab === 'required' && (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
                  These tags form the <strong>Unified Service Tagging</strong> foundation. They
                  must be applied consistently across every resource type for Service Map, Deployment
                  Tracking, and cross-product correlation to function. Each card below is built from
                  this scan's actual findings — the specific hosts/services/monitors/synthetics tests
                  still missing the tag, and Datadog's best-practice guidance for fixing it.
                </p>
                {REQUIRED_TAGS.map((tag) => {
                  const found = detectedKeys.has(tag.key);
                  const findingsForTag = findingsByTagKey.get(tag.key) ?? [];
                  return (
                    <div key={tag.key} className="space-y-2">
                      <div className="card">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <TagPill tagKey={tag.key} />
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  found
                                    ? 'bg-green-500/15 text-green-400'
                                    : 'bg-red-500/15 text-red-400'
                                }`}
                              >
                                {found ? '✓ Detected' : '✗ Not found'}
                              </span>
                            </div>
                            <p className="text-sm text-ink-muted mt-1">{tag.description}</p>
                            <p className="text-xs text-ink-muted mt-1 italic">{tag.why}</p>
                            <div className="mt-2">
                              <span className="text-xs text-ink-faint mr-1">Applies to:</span>
                              <AppliesTo layers={tag.applies} />
                            </div>
                          </div>
                          {/* Per-layer coverage for this tag */}
                          {coverage && (
                            <div className="w-40 shrink-0 space-y-1.5">
                              <div className="text-xs text-ink-faint font-medium mb-1">Coverage by layer</div>
                              {[
                                { label: 'Hosts', val: (coverage.layers.hosts as Record<string, number | null>)[tag.key] },
                                { label: 'Services', val: (coverage.layers.services as Record<string, number | null>)[tag.key] },
                                { label: 'Monitors', val: (coverage.layers.monitors as Record<string, number | null>)[tag.key] },
                                { label: 'Synthetics', val: (coverage.layers.synthetics as Record<string, number | null>)[tag.key] },
                              ]
                                .filter((r) => r.val !== undefined && r.val !== null)
                                .map((r) => (
                                  <CoverageBar key={r.label} label={r.label} pct={r.val as number} />
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {findingsForTag.map((f) => (
                        <ResourceFindingCard
                          key={f.id}
                          title={f.title}
                          description={f.description}
                          tagKey={f.tagKey ?? tag.key}
                          severity={f.severity}
                          recommendation={f.recommendation}
                          bestPractice={f.bestPractice}
                          affectedResources={f.affectedResources}
                          affectedCount={f.affectedCount}
                          totalCount={f.totalCount}
                        />
                      ))}
                    </div>
                  );
                })}

                {/* Findings for tags not in the static REQUIRED_TAGS list above
                    (e.g. team/application/tier from ust-006/007/008) */}
                {[...findingsByTagKey.entries()]
                  .filter(([key]) => !REQUIRED_TAGS.some((t) => t.key === key))
                  .map(([key, findings]) => (
                    <div key={key} className="space-y-2">
                      {findings.map((f) => (
                        <ResourceFindingCard
                          key={f.id}
                          title={f.title}
                          description={f.description}
                          tagKey={f.tagKey ?? key}
                          severity={f.severity}
                          recommendation={f.recommendation}
                          bestPractice={f.bestPractice}
                          affectedResources={f.affectedResources}
                          affectedCount={f.affectedCount}
                          totalCount={f.totalCount}
                        />
                      ))}
                    </div>
                  ))}
              </div>
            )}

            {/* Sector tags */}
            {activeTab === 'sector' && (
              <div className="space-y-4">
                <p className="text-sm text-ink-muted bg-blue-500/10 border border-blue-500/30 rounded px-3 py-2">
                  Tags to <strong>leverage based on your platform</strong>. Detected means at least
                  one resource in this org already uses a tag from that sector — apply them more broadly
                  for full coverage.
                </p>
                {SECTOR_GROUPS.map((group) => {
                  const detected = group.detectKeys.some((k) => detectedKeys.has(k));
                  return (
                    <div key={group.sector} className="card">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-lg">{group.icon}</span>
                        <h3 className="font-semibold text-ink">{group.sector}</h3>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ml-auto ${
                            detected
                              ? 'bg-blue-500/15 text-blue-400'
                              : 'bg-surface-sunken text-ink-muted'
                          }`}
                        >
                          {detected ? '✓ Detected in org' : 'Not detected'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {group.tags.map((tag) => {
                          const tagDetected = detectedKeys.has(tag.key);
                          return (
                            <div
                              key={tag.key}
                              className={`flex items-start gap-2 p-2 rounded border ${
                                tagDetected
                                  ? 'border-blue-500/30 bg-blue-500/10'
                                  : 'border-border bg-surface-subtle'
                              }`}
                            >
                              <div className="mt-0.5">
                                <TagPill tagKey={tag.key} />
                              </div>
                              <p className="text-xs text-ink-muted leading-snug">{tag.description}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Cross-product correlation tags */}
            {activeTab === 'crossproduct' && (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted bg-violet-500/10 border border-violet-500/30 rounded px-3 py-2">
                  Tags that <strong>enable correlation across product surfaces</strong> — RUM,
                  APM, Logs, Network, and Infrastructure. Many are auto-injected by the Agent or SDKs;
                  others require configuration in your application code or log pipeline.
                </p>
                <div className="grid grid-cols-1 gap-3">
                  {CROSS_PRODUCT_TAGS.map((tag) => (
                    <div key={tag.key} className="card flex items-start gap-4">
                      <div className="shrink-0">
                        <TagPill tagKey={tag.key} />
                        {tag.autoInjected && (
                          <div className="text-xs text-green-400 mt-1 text-center">auto-injected</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap gap-1 mb-1">
                          {tag.products.map((p) => (
                            <span
                              key={p}
                              className="text-xs bg-violet-500/15 text-violet-400 px-1.5 py-0.5 rounded"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                        <p className="text-sm text-ink-muted">{tag.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active industry/org template tags */}
            {activeTab === 'template' && (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2 flex items-center justify-between gap-3">
                  <span>
                    Tags defined by your org's selected tagging template
                    {templateScore && <> — <strong>{templateScore.templateName}</strong></>}.
                  </span>
                  <Link to="/tag-templates" className="shrink-0 text-amber-400 font-medium hover:underline">Change template →</Link>
                </p>
                {templateTags.length === 0 ? (
                  <div className="card text-center text-ink-faint py-8">
                    No org-specific tags yet — using the generic baseline.{' '}
                    <Link to="/tag-templates" className="text-dd-purple hover:underline">Pick an industry template</Link> to see tags specific to your sector here.
                  </div>
                ) : (
                  templateTags.map((tag) => (
                    <div key={tag.key} className="card">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <TagPill tagKey={tag.key} />
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tag.found ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                              {tag.found ? `✓ Detected (${tag.coverage}%)` : '✗ Not found'}
                            </span>
                          </div>
                          <p className="text-sm text-ink-muted mt-1">{tag.description}</p>
                          {(tag as { why?: string }).why && (
                            <p className="text-xs text-ink-muted mt-1 italic">{(tag as { why?: string }).why}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
          </SectionGate>

          {/* ── Section 2: Hierarchical tag tree ─────────────────────────── */}
          <SectionGate featureKey="section.tags.hierarchy">
          <section>
            <h2 className="text-lg font-bold text-ink mb-1">
              Tag Hierarchy by Product Layer
            </h2>
            <p className="text-sm text-ink-muted mb-4">
              Where tags need to exist at each observability layer, coverage from the last scan, and
              how tags flow and correlate across the stack.
            </p>

            <div className="pl-2">
              {PRODUCT_LAYERS.map((layer, i) => (
                <HierarchyLayerCard
                  key={layer.id}
                  layer={layer}
                  coverage={layerCoverageMap[layer.id]}
                  isLast={i === PRODUCT_LAYERS.length - 1}
                />
              ))}
            </div>
          </section>
          </SectionGate>

          {/* ── Section 3: Tag key inventory table ───────────────────────── */}
          <SectionGate featureKey="section.tags.key_inventory">
          <section>
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-base font-semibold text-ink">
                  All Tag Keys ({filtered.length})
                </h2>
                <input
                  type="text"
                  placeholder="Search tag keys..."
                  className="input w-48 text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <DataTable
                tableId="tag-explorer-inventory"
                columns={[
                  {
                    key: 'tag_key',
                    header: 'Tag Key',
                    sortable: true,
                    sortAccessor: (r) => String(r.tag_key),
                    render: (r) => (
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono">{String(r.tag_key)}</code>
                        {r.is_standard_key ? (
                          <span className="badge bg-green-500/15 text-green-400">standard</span>
                        ) : null}
                        {r.suggested_mapping ? (
                          <span className="badge bg-amber-500/15 text-amber-400">
                            → {String(r.suggested_mapping)}
                          </span>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    key: 'host_occurrence_count',
                    header: 'Hosts',
                    sortable: true,
                    sortAccessor: (r) => Number(r.host_occurrence_count ?? 0),
                    render: (r) => String(r.host_occurrence_count ?? 0),
                  },
                  {
                    key: 'service_occurrence_count',
                    header: 'Services',
                    sortable: true,
                    sortAccessor: (r) => Number(r.service_occurrence_count ?? 0),
                    render: (r) => String(r.service_occurrence_count ?? 0),
                  },
                  {
                    key: 'unique_value_count',
                    header: 'Unique Values',
                    sortable: true,
                    sortAccessor: (r) => Number(r.unique_value_count ?? 0),
                    render: (r) => String(r.unique_value_count ?? 0),
                  },
                  {
                    key: 'top_values',
                    header: 'Sample Values',
                    render: (r) => {
                      let vals: string[] = [];
                      try {
                        vals = JSON.parse(String(r.top_values ?? '[]')).slice(0, 4);
                      } catch {
                        /* ignore */
                      }
                      return (
                        <div className="flex flex-wrap gap-1">
                          {vals.map((v: string) => (
                            <code
                              key={v}
                              className="text-xs bg-surface-sunken px-1 rounded text-ink-muted"
                            >
                              {v}
                            </code>
                          ))}
                        </div>
                      );
                    },
                  },
                ]}
                data={filtered}
                rowKey={(r) => String(r.tag_key)}
                pageSize={15}
              />
            </div>
          </section>
          </SectionGate>
        </>
      )}
    </div>
  );
}

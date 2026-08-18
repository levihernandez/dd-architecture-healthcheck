import { useQuery } from '@tanstack/react-query';
import { inventoryApi, analyticsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards } from '../components/ui/Skeleton';
import SectionGate from '../components/SectionGate';

interface ProductSignal { product: string; signal: string; value: string; detected: number; }

const PRODUCT_CONFIG: Record<string, { label: string; icon: string; description: string }> = {
  infrastructure: { label: 'Infrastructure', icon: '🖥', description: 'Host and container monitoring' },
  apm: { label: 'APM', icon: '🔍', description: 'Application Performance Monitoring' },
  logs: { label: 'Log Management', icon: '🪵', description: 'Log indexes and pipelines' },
  synthetics: { label: 'Synthetics', icon: '🧪', description: 'Synthetic monitoring tests' },
  cloud: { label: 'Cloud Accounts', icon: '☁', description: 'AWS / GCP / Azure integrations' },
  slo: { label: 'SLOs', icon: '🎯', description: 'Service level objectives' },
  monitors: { label: 'Monitors', icon: '🔔', description: 'Alerting monitors' },
  dashboards: { label: 'Dashboards', icon: '📊', description: 'Custom dashboards' },
  integrations: { label: 'Integrations', icon: '🔗', description: 'Configured third-party integrations' },
  security: { label: 'Cloud/App Security', icon: '🛡', description: 'CSPM, CWS, ASM findings' },
  incidents: { label: 'Incident Management', icon: '🚨', description: 'Declared incidents' },
  rum: { label: 'RUM', icon: '👤', description: 'Real User Monitoring sessions' },
  npm: { label: 'Cloud Network Mon.', icon: '🌊', description: 'Network flow monitoring' },
  ndm: { label: 'Network Device Mon.', icon: '🔌', description: 'SNMP device monitoring' },
  dbm: { label: 'Database Mon.', icon: '🗄', description: 'Postgres/MySQL/Oracle/MongoDB/SQL Server' },
  governance: { label: 'Governance', icon: '🛡', description: 'SSO, RBAC, teams' },
};

// Datadog products this app cannot yet detect from the current scan collectors — listed
// explicitly instead of silently omitted, so "which products aren't covered" is answerable
// at a glance rather than a guessing game.
const UNDETECTED_PRODUCTS: Array<{ label: string; icon: string; note: string }> = [
  { label: 'Continuous Profiler', icon: '⚡', note: 'no dedicated collector yet' },
  { label: 'CI Visibility / Test Optimization', icon: '🔧', note: 'no dedicated collector yet' },
  { label: 'Application Security (ASM)', icon: '🔒', note: 'bundled into generic security findings only' },
  { label: 'Cloud SIEM', icon: '🛰', note: 'no dedicated collector yet' },
  { label: 'Sensitive Data Scanner', icon: '🕵', note: 'no dedicated collector yet' },
  { label: 'Universal Service Mon.', icon: '🧭', note: 'no dedicated collector yet' },
  { label: 'Data Streams Mon.', icon: '🔗', note: 'no dedicated collector yet' },
  { label: 'Data Jobs Mon.', icon: '⚙', note: 'no dedicated collector yet' },
  { label: 'LLM Observability', icon: '🤖', note: 'no dedicated collector yet' },
  { label: 'Serverless', icon: '⚡', note: 'no dedicated collector yet' },
  { label: 'Cloud Cost Management', icon: '💵', note: 'config detection only, no usage signal' },
  { label: 'Observability Pipelines', icon: '🔀', note: 'no dedicated collector yet' },
  { label: 'On-Call', icon: '📟', note: 'no dedicated collector yet' },
  { label: 'Feature Flags', icon: '🚩', note: 'no dedicated collector yet' },
  { label: 'Workflow Automation', icon: '🔁', note: 'no dedicated collector yet' },
  { label: 'Product Analytics', icon: '📐', note: 'no dedicated collector yet' },
];

export default function ProductUsage() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const { data: signals = [], isLoading } = useQuery({
    queryKey: ['product-signals', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.productSignals(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const { data: inventory } = useQuery({
    queryKey: ['inventory-summary', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.summary(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  // Richer per-product signals (RUM, NPM/NDM, DBM) that InventorySummary doesn't carry but
  // AnalyticsData already collects — same source the Sizing Calculators use.
  const { data: analytics } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const byProduct = signals.reduce((acc: Record<string, ProductSignal[]>, s) => {
    if (!acc[s.product]) acc[s.product] = [];
    acc[s.product].push(s);
    return acc;
  }, {});

  const integrationNameHit = (keywords: string[]) =>
    analytics?.integrations.list.filter(i => keywords.some(k => i.name.toLowerCase().includes(k))).length ?? 0;

  const inferredProducts = inventory ? [
    { product: 'infrastructure', count: inventory.hosts, label: 'Hosts' },
    { product: 'apm', count: inventory.services, label: 'APM Services' },
    { product: 'logs', count: inventory.logsIndexes + inventory.logsPipelines, label: 'Log resources' },
    { product: 'synthetics', count: inventory.syntheticsTests, label: 'Tests' },
    { product: 'cloud', count: inventory.cloudAccounts, label: 'Cloud accounts' },
    { product: 'slo', count: inventory.slos, label: 'SLOs' },
    { product: 'monitors', count: inventory.monitors, label: 'Monitors' },
    { product: 'dashboards', count: inventory.dashboards, label: 'Dashboards' },
    { product: 'integrations', count: inventory.integrations, label: 'Integrations' },
    { product: 'security', count: inventory.securityFindings, label: 'Findings' },
    { product: 'incidents', count: inventory.openIncidents, label: 'Open incidents' },
    { product: 'rum', count: analytics?.rum.total ?? 0, label: 'RUM apps' },
    { product: 'npm', count: integrationNameHit(['network']), label: 'Network checks' },
    { product: 'ndm', count: integrationNameHit(['snmp', 'ndm', 'cisco', 'juniper', 'palo_alto']), label: 'Device checks' },
    { product: 'dbm', count: integrationNameHit(['postgres', 'mysql', 'sqlserver', 'oracle', 'mongodb']), label: 'DB checks' },
  ] : [];

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Product Usage" subtitle="Detected Datadog products and feature signals" />

      {!selectedScanId ? <EmptyState message="Run a scan to detect product usage" /> :
       isLoading ? <SkeletonCards count={6} /> : (
        <>
          {/* Inferred from inventory + analytics */}
          <SectionGate featureKey="section.products.product_grid">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {inferredProducts.map(({ product, count, label }) => {
                const config = PRODUCT_CONFIG[product] ?? { label: product, icon: '⬡', description: '' };
                return (
                  <div key={product} className={`card ${count > 0 ? 'border-green-500/30' : 'border-border opacity-60'}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl">{config.icon}</span>
                      <div>
                        <div className="text-sm font-semibold text-ink">{config.label}</div>
                        <div className={`text-xs font-medium ${count > 0 ? 'text-green-400' : 'text-ink-faint'}`}>
                          {count > 0 ? `✓ ${count} ${label}` : 'Not detected'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionGate>

          {/* Governance signals */}
          {byProduct.governance && (
            <SectionGate featureKey="section.products.governance_signals">
              <div className="card">
                <h2 className="text-lg font-semibold text-ink mb-3">Governance Signals</h2>
                <div className="space-y-2">
                  {byProduct.governance.map((sig) => {
                    let displayValue = sig.value;
                    let parsedValue: Record<string, unknown> | null = null;
                    try { parsedValue = JSON.parse(sig.value); } catch { /* ignore */ }

                    return (
                      <div key={sig.signal} className="flex items-start gap-4 bg-surface-subtle rounded p-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-ink-muted capitalize">
                            {sig.signal.replace(/_/g, ' ')}
                          </div>
                          {parsedValue ? (
                            <div className="mt-1 flex flex-wrap gap-2">
                              {Object.entries(parsedValue).map(([k, v]) => (
                                <span key={k} className={`text-xs px-2 py-0.5 rounded ${v ? 'bg-green-500/15 text-green-400' : 'bg-surface-sunken text-ink-muted'}`}>
                                  {k}: {String(v)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-ink-muted mt-0.5">{displayValue}</div>
                          )}
                        </div>
                        <span className={`badge ${sig.detected ? 'bg-green-500/15 text-green-400' : 'bg-surface-sunken text-ink-muted'}`}>
                          {sig.detected ? 'Detected' : 'Not detected'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </SectionGate>
          )}

          {/* Honest gap list — Datadog products this scan cannot detect yet */}
          <SectionGate featureKey="section.products.not_covered">
            <div className="card">
              <h2 className="text-lg font-semibold text-ink mb-1">Not Yet Covered by This Scan</h2>
              <p className="text-xs text-ink-faint mb-3">
                These Datadog products have no dedicated collector in this tool yet, so they can't be marked detected/not-detected above —
                that's a gap in this app's scan coverage, not necessarily in your org.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {UNDETECTED_PRODUCTS.map((p) => (
                  <div key={p.label} className="flex items-center gap-2 bg-surface-subtle rounded-lg px-3 py-2">
                    <span className="text-base shrink-0">{p.icon}</span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-ink leading-tight">{p.label}</div>
                      <div className="text-[10px] text-ink-faint leading-tight">{p.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionGate>
        </>
      )}
    </div>
  );
}

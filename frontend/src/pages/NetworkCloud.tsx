import { useQuery } from '@tanstack/react-query';
import { inventoryApi, analyticsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl, ddUrl } from '../utils/ddUrl';
import { EmptyState } from '../components/common/LoadingState';
import MetricCard from '../components/common/MetricCard';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards, SkeletonCard } from '../components/ui/Skeleton';
import SectionGate from '../components/SectionGate';

function DDLink({ href, label = 'Open in Datadog' }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-400 font-medium shrink-0">
      {label} ↗
    </a>
  );
}

const PROVIDER_INFO: Record<string, { name: string; icon: string; integrationFn: (base: string) => string }> = {
  aws: { name: 'AWS', icon: '☁', integrationFn: (b) => ddUrl.awsIntegration(b) },
  gcp: { name: 'Google Cloud', icon: '☁', integrationFn: (b) => ddUrl.gcpIntegration(b) },
  azure: { name: 'Azure', icon: '☁', integrationFn: (b) => ddUrl.azureIntegration(b) },
};

export default function NetworkCloud() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');

  const { data: signals = [], isLoading } = useQuery({
    queryKey: ['product-signals', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.productSignals(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const cloudAccounts = analytics?.infrastructure.cloudAccounts ?? [];
  const totalCloudAccounts = cloudAccounts.reduce((s, a) => s + a.n, 0);
  const totalHosts = analytics?.infrastructure.totalHosts ?? 0;

  const npmSignal = signals.find(s => s.signal === 'npm_enabled');
  const ndmSignal = signals.find(s => s.signal === 'ndm_enabled');
  const npmEnabled = npmSignal?.value === 'true' || npmSignal?.value === '1';
  const ndmEnabled = ndmSignal?.value === 'true' || ndmSignal?.value === '1';

  const networkIntegrations = analytics?.integrations.list.filter(i =>
    ['snmp', 'cisco', 'juniper', 'palo_alto', 'f5', 'fortinet', 'arista'].some(k => i.name.toLowerCase().includes(k))
  ) ?? [];

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Network & Cloud"
        subtitle="Cloud account connections, CNM/NDM product status, and network integration signals"
      />

      {!selectedScanId ? <EmptyState message="Run a scan to see network and cloud data" /> : (isLoading || analyticsLoading) ? (
        <div className="space-y-6">
          <SkeletonCards count={4} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      ) : (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Cloud Accounts" value={totalCloudAccounts} icon="☁"
              subtitle={`${cloudAccounts.length} provider${cloudAccounts.length !== 1 ? 's' : ''} connected`}
              color={totalCloudAccounts === 0 ? 'amber' : 'default'} />
            <MetricCard label="Total Hosts" value={totalHosts} icon="🖥"
              subtitle="infrastructure hosts monitored" />
            <MetricCard label="CNM" value={npmEnabled ? 'Active' : 'Not Set Up'}
              icon="🌐"
              color={npmEnabled ? 'green' : 'default'} />
            <MetricCard label="NDM" value={ndmEnabled ? 'Active' : 'Not Set Up'}
              icon="🔌"
              color={ndmEnabled ? 'green' : 'default'} />
          </div>

          {/* Cloud accounts breakdown */}
          {cloudAccounts.length > 0 && (
            <SectionGate featureKey="section.network.cloud_connections">
            <div className="card">
              <h2 className="text-base font-semibold text-ink mb-4">Cloud Provider Connections</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {cloudAccounts.map(({ provider, n }) => {
                  const info = PROVIDER_INFO[provider] ?? { name: provider, icon: '☁', integrationFn: (b: string) => ddUrl.integrations(b) };
                  return (
                    <div key={provider} className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface-subtle">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{info.icon}</span>
                        <div>
                          <div className="font-semibold text-ink">{info.name}</div>
                          <div className="text-sm text-ink-muted">{n} account{n !== 1 ? 's' : ''} connected</div>
                        </div>
                      </div>
                      <DDLink href={info.integrationFn(base)} label="Configure" />
                    </div>
                  );
                })}
              </div>
            </div>
            </SectionGate>
          )}

          {/* CNM status */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SectionGate featureKey="section.network.cnm">
            <div className={`card ${npmEnabled ? 'border-green-500/30 bg-green-500/10' : 'border-border'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🌐</span>
                  <h2 className="text-base font-semibold text-ink">Cloud Network Monitor</h2>
                </div>
                <DDLink href={ddUrl.npm(base)} label={npmEnabled ? 'View CNM' : 'Set up'} />
              </div>
              <div className={`text-sm ${npmEnabled ? 'text-green-400' : 'text-ink-muted'}`}>
                {npmEnabled
                  ? '✓ CNM is active. You can view network flow data between services, hosts, and cloud resources.'
                  : 'CNM is not detected. Enable it to visualize network traffic flows, detect DNS issues, and map service dependencies.'}
              </div>
              {npmEnabled && (
                <div className="mt-3 space-y-1">
                  {[
                    { label: 'Service-to-service flows', href: ddUrl.npmFlow(base, 'service:*') },
                    { label: 'DNS resolution monitoring', href: `${base}/network/dns` },
                    { label: 'Pod-to-pod (K8s)', href: ddUrl.npmFlow(base, 'kube_service:*') },
                  ].map(({ label, href }) => (
                    <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-between text-xs text-green-400 hover:text-green-900 py-1 border-b border-green-100 last:border-0">
                      <span>{label}</span><span>↗</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
            </SectionGate>

            <SectionGate featureKey="section.network.ndm">
            <div className={`card ${ndmEnabled ? 'border-green-500/30 bg-green-500/10' : 'border-border'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🔌</span>
                  <h2 className="text-base font-semibold text-ink">Network Device Monitoring</h2>
                </div>
                <DDLink href={ddUrl.ndm(base)} label={ndmEnabled ? 'View NDM' : 'Set up'} />
              </div>
              <div className={`text-sm ${ndmEnabled ? 'text-green-400' : 'text-ink-muted'}`}>
                {ndmEnabled
                  ? '✓ NDM is active. SNMP polling is collecting metrics from your network devices.'
                  : 'NDM is not detected. Enable it to monitor routers, switches, and firewalls via SNMP.'}
              </div>
              {networkIntegrations.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs text-ink-muted mb-2">Network integrations detected:</div>
                  <div className="flex flex-wrap gap-1">
                    {networkIntegrations.slice(0, 8).map(i => (
                      <span key={i.name} className="text-xs px-1.5 py-0.5 bg-blue-500/15 text-blue-400 rounded">{i.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </SectionGate>
          </div>

          {/* Investigation links */}
          <div className="card">
            <h2 className="text-sm font-semibold text-ink-muted mb-3">Investigate in Datadog</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {[
                { label: 'CNM network map', href: ddUrl.npm(base) },
                { label: 'NDM device list', href: ddUrl.ndm(base) },
                { label: 'Cloud integrations', href: ddUrl.integrations(base) },
                { label: 'AWS integration', href: ddUrl.awsIntegration(base) },
                { label: 'GCP integration', href: ddUrl.gcpIntegration(base) },
                { label: 'Azure integration', href: ddUrl.azureIntegration(base) },
              ].map(({ label, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border hover:border-violet-500/30 hover:bg-violet-500/30 transition-colors group">
                  <span className="text-sm text-ink-muted group-hover:text-violet-400">{label}</span>
                  <span className="text-ink-faint group-hover:text-violet-500">↗</span>
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

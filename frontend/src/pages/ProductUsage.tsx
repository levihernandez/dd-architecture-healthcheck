import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import LoadingState, { EmptyState } from '../components/common/LoadingState';

interface ProductSignal { product: string; signal: string; value: string; detected: number; }

const PRODUCT_CONFIG: Record<string, { label: string; icon: string; description: string }> = {
  governance: { label: 'Governance', icon: '🛡', description: 'SSO, RBAC, teams' },
  apm: { label: 'APM', icon: '⚡', description: 'Application Performance Monitoring' },
  logs: { label: 'Log Management', icon: '📋', description: 'Log indexes and pipelines' },
  synthetics: { label: 'Synthetics', icon: '🌐', description: 'Synthetic monitoring tests' },
  infrastructure: { label: 'Infrastructure', icon: '🖥', description: 'Host and container monitoring' },
  npm: { label: 'NPM', icon: '🔗', description: 'Network Performance Monitoring' },
  rum: { label: 'RUM', icon: '👁', description: 'Real User Monitoring' },
};

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

  const byProduct = signals.reduce((acc: Record<string, ProductSignal[]>, s) => {
    if (!acc[s.product]) acc[s.product] = [];
    acc[s.product].push(s);
    return acc;
  }, {});

  if (isLoading) return <LoadingState />;

  const inferredProducts = inventory ? [
    { product: 'infrastructure', count: inventory.hosts, label: 'Hosts' },
    { product: 'apm', count: inventory.services, label: 'APM Services' },
    { product: 'logs', count: inventory.logsIndexes + inventory.logsPipelines, label: 'Log resources' },
    { product: 'synthetics', count: inventory.syntheticsTests, label: 'Tests' },
    { product: 'cloud', count: inventory.cloudAccounts, label: 'Cloud accounts' },
    { product: 'slo', count: inventory.slos, label: 'SLOs' },
  ] : [];

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Usage</h1>
          <p className="text-gray-500 text-sm mt-1">Detected Datadog products and feature signals</p>
        </div>
      </div>

      {!selectedScanId ? <EmptyState message="Run a scan to detect product usage" /> : (
        <>
          {/* Inferred from inventory */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {inferredProducts.map(({ product, count, label }) => {
              const config = PRODUCT_CONFIG[product] ?? { label: product, icon: '⬡', description: '' };
              return (
                <div key={product} className={`card ${count > 0 ? 'border-green-200' : 'border-gray-100 opacity-60'}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">{config.icon}</span>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{config.label}</div>
                      <div className={`text-xs font-medium ${count > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        {count > 0 ? `✓ ${count} ${label}` : 'Not detected'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Governance signals */}
          {byProduct.governance && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Governance Signals</h2>
              <div className="space-y-2">
                {byProduct.governance.map((sig) => {
                  let displayValue = sig.value;
                  let parsedValue: Record<string, unknown> | null = null;
                  try { parsedValue = JSON.parse(sig.value); } catch { /* ignore */ }

                  return (
                    <div key={sig.signal} className="flex items-start gap-4 bg-gray-50 rounded p-3">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-700 capitalize">
                          {sig.signal.replace(/_/g, ' ')}
                        </div>
                        {parsedValue ? (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {Object.entries(parsedValue).map(([k, v]) => (
                              <span key={k} className={`text-xs px-2 py-0.5 rounded ${v ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {k}: {String(v)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500 mt-0.5">{displayValue}</div>
                        )}
                      </div>
                      <span className={`badge ${sig.detected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {sig.detected ? 'Detected' : 'Not detected'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { scansApi, inventoryApi, analyticsApi } from '../services/api';
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

export default function GovernanceSSOSummary() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const selectedOrg = orgs.find(o => o.id === selectedOrgId);
  const base = ddBaseUrl(selectedOrg?.site ?? 'datadoghq.com');

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['findings', selectedScanId, 'governance'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'governance' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: signals = [] } = useQuery({
    queryKey: ['product-signals', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.productSignals(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const { data: analytics } = useQuery({
    queryKey: ['analytics', selectedOrgId, selectedScanId],
    queryFn: () => analyticsApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const ssoSignal = signals.find((s) => s.signal === 'sso_status');
  const userSignal = signals.find((s) => s.signal === 'user_count');
  const roleSignal = signals.find((s) => s.signal === 'role_count');

  let ssoStatus: Record<string, unknown> = {};
  try { ssoStatus = JSON.parse(ssoSignal?.value ?? '{}'); } catch { /* ignore */ }

  const gov = analytics?.governance;
  const userCount = gov?.userCount ?? (userSignal?.value ? Number(userSignal.value) : null);
  const roleCount = gov?.roleCount ?? (roleSignal?.value ? Number(roleSignal.value) : null);
  const samlEnabled = Boolean(ssoStatus.saml_enabled);
  const idpInitiated = Boolean(ssoStatus.idp_initiated_login_enabled);
  const strictMode = Boolean(ssoStatus.strict_mode);

  const govFindings = gov?.findings ?? [];
  const criticalCount = govFindings.filter(f => f.severity === 'critical').length;
  const highCount = govFindings.filter(f => f.severity === 'high').length;

  if (isLoading) return <LoadingState />;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Governance & SSO</h1>
          <p className="text-gray-500 text-sm mt-1">
            SSO status, RBAC configuration, user management, and access governance
            <span className="ml-1 text-xs text-gray-400">(No sensitive credentials collected)</span>
          </p>
        </div>
        <DDLink href={ddUrl.userManagement(base)} label="User Management" />
      </div>

      {!selectedScanId ? <EmptyState message="Run a scan to see governance data" /> : (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Active Users" value={userCount ?? '—'} icon="👥"
              subtitle="in this org" />
            <MetricCard label="RBAC Roles" value={roleCount ?? '—'} icon="🛡"
              subtitle={roleCount && roleCount <= 3 ? 'consider custom roles' : 'roles configured'} />
            <MetricCard label="SAML SSO" value={samlEnabled ? 'Enabled' : 'Disabled'} icon="🔐"
              color={samlEnabled ? 'green' : 'red'} />
            <MetricCard label="Strict Mode" value={strictMode ? 'On' : 'Off'} icon="🔒"
              subtitle={strictMode ? 'SSO required for all' : 'local login allowed'}
              color={strictMode ? 'green' : samlEnabled ? 'amber' : 'default'} />
          </div>

          {/* SSO configuration detail */}
          {ssoSignal && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900">SSO Configuration</h2>
                <DDLink href={ddUrl.samlConfig(base)} label="SAML Settings" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { key: 'saml_enabled', label: 'SAML SSO', good: true },
                  { key: 'idp_initiated_login_enabled', label: 'IdP-Initiated Login', good: true },
                  { key: 'strict_mode', label: 'Strict Mode (SSO required)', good: true },
                  { key: 'autocreate_users_enabled', label: 'Auto-Create Users', good: null },
                  { key: 'autologin_enabled', label: 'Auto-Login', good: null },
                ].map(({ key, label, good }) => {
                  const val = Boolean(ssoStatus[key]);
                  return (
                    <div key={key} className={`rounded-lg p-3 border ${val ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">{label}</span>
                        <span className={`text-sm font-bold ${val ? 'text-green-700' : 'text-gray-400'}`}>{val ? '✓ On' : '✗ Off'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {!samlEnabled && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="text-sm font-medium text-red-800">SAML SSO is not enabled</div>
                  <div className="text-xs text-red-600 mt-0.5">Without SSO, users authenticate with local passwords. This increases risk from credential compromise and makes offboarding harder.</div>
                  <div className="mt-2"><DDLink href={ddUrl.samlConfig(base)} label="Configure SAML SSO" /></div>
                </div>
              )}
              {samlEnabled && !strictMode && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="text-sm font-medium text-amber-800">SSO Strict Mode is off</div>
                  <div className="text-xs text-amber-600 mt-0.5">Users can bypass SSO and log in with local credentials. Enable strict mode to require SSO for all authentication.</div>
                  <div className="mt-2"><DDLink href={ddUrl.samlConfig(base)} label="Enable Strict Mode" /></div>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-3 border-t border-gray-100 pt-2">
                Only high-level enablement signals are collected — no IdP metadata, certificates, or sensitive configuration.
              </p>
            </div>
          )}

          {/* Governance findings from analytics */}
          {govFindings.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">Governance Findings</h2>
                <div className="flex items-center gap-2">
                  {criticalCount > 0 && <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded font-medium">{criticalCount} critical</span>}
                  {highCount > 0 && <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded font-medium">{highCount} high</span>}
                </div>
              </div>
              <div className="space-y-3">
                {govFindings.map((f, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${f.severity === 'critical' ? 'bg-red-50 border-red-200' : f.severity === 'high' ? 'bg-orange-50 border-orange-200' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex items-start gap-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-bold uppercase ${f.severity === 'critical' ? 'bg-red-200 text-red-800' : f.severity === 'high' ? 'bg-orange-200 text-orange-800' : 'bg-amber-200 text-amber-800'}`}>
                        {f.severity}
                      </span>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{f.title}</div>
                        <div className="text-xs text-gray-600 mt-0.5">{f.description}</div>
                        {f.affectedCount > 0 && (
                          <div className="text-xs text-gray-500 mt-1">{f.affectedCount} of {f.totalCount} affected</div>
                        )}
                        {f.recommendation && (
                          <div className="text-xs text-blue-700 mt-1.5 font-medium">→ {f.recommendation}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scan findings */}
          {findings.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">Governance Findings ({findings.length})</h2>
              <EvidenceTable findings={findings} />
            </div>
          )}

          {/* Access management links */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Manage Access in Datadog</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {[
                { label: 'User Management', href: ddUrl.userManagement(base) },
                { label: 'RBAC Roles', href: ddUrl.roleManagement(base) },
                { label: 'API Keys', href: ddUrl.apiKeys(base) },
                { label: 'SAML / SSO Config', href: ddUrl.samlConfig(base) },
                { label: 'Audit Trail', href: ddUrl.auditLogs(base) },
                { label: 'Organization Settings', href: `${base}/organization-settings` },
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

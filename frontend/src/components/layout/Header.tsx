import { useOrgs, useScans } from '../../hooks/useOrgs';
import { useOrgScanContext } from '../../context/OrgScanContext';
import { useEffect } from 'react';

export default function Header() {
  const { data: orgs = [] } = useOrgs();
  const { selectedOrgId, selectedScanId, setSelectedOrgId, setSelectedScanId } = useOrgScanContext();

  // Auto-select first org on load, or recover if the stored org id no longer exists
  useEffect(() => {
    if (orgs.length === 0) return;
    if (!selectedOrgId || !orgs.some(o => o.id === selectedOrgId)) {
      setSelectedOrgId(orgs[0].id);
    }
  }, [orgs, selectedOrgId, setSelectedOrgId]);

  const orgIsValid = orgs.some(o => o.id === selectedOrgId);
  const effectiveOrgId = orgIsValid ? selectedOrgId : (orgs[0]?.id ?? '');
  const { data: scans = [] } = useScans(effectiveOrgId || undefined);
  const completedScans = scans.filter(s => s.status === 'completed');

  // Auto-select first scan when org is set, or recover if the stored scan id no longer exists
  useEffect(() => {
    if (!effectiveOrgId || completedScans.length === 0) return;
    if (!selectedScanId || !completedScans.some(s => s.id === selectedScanId)) {
      setSelectedScanId(completedScans[0].id);
    }
  }, [effectiveOrgId, completedScans, selectedScanId, setSelectedScanId]);

  const scanIsValid = completedScans.some(s => s.id === selectedScanId);
  const effectiveScanId = scanIsValid ? selectedScanId : (completedScans[0]?.id ?? '');
  const runningScans = orgs.filter(o => o.lastScanStatus === 'running').length;
  const selectedOrg = orgs.find(o => o.id === effectiveOrgId);

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center justify-between shrink-0 z-30">
      <h1 className="text-base font-semibold text-gray-900 shrink-0">
        Datadog Architecture Health Check
      </h1>

      <div className="flex items-center gap-3">
        {runningScans > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
            {runningScans} scan{runningScans > 1 ? 's' : ''} running
          </div>
        )}

        {/* Global Org selector */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400 font-medium shrink-0">Org</label>
          <select
            className="input text-sm py-1 w-auto max-w-[180px]"
            value={effectiveOrgId}
            onChange={e => setSelectedOrgId(e.target.value)}
          >
            {orgs.length === 0 && <option value="">No orgs</option>}
            {orgs.map(o => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.ddOrgName && o.ddOrgName !== o.name ? ` (${o.ddOrgName})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Global Scan selector */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400 font-medium shrink-0">Scan</label>
          <select
            className="input text-sm py-1 w-auto max-w-[170px]"
            value={effectiveScanId}
            onChange={e => setSelectedScanId(e.target.value)}
            disabled={completedScans.length === 0}
          >
            {completedScans.length === 0 && <option value="">No scans</option>}
            {completedScans.map(s => (
              <option key={s.id} value={s.id}>
                {new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                {' '}{new Date(s.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </option>
            ))}
          </select>
        </div>

        {/* Site badge */}
        {selectedOrg && (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border border-gray-200 font-mono shrink-0">
            {selectedOrg.site}
          </span>
        )}
      </div>
    </header>
  );
}

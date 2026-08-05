import { useEffect, useState } from 'react';
import { useOrgs, useScans } from '../../hooks/useOrgs';
import { useOrgScanContext } from '../../context/OrgScanContext';
import Breadcrumbs from '../ui/Breadcrumbs';
import { PopoverRoot, PopoverTrigger, PopoverContent } from '../ui/Popover';
import { DrawerRoot, DrawerTrigger, DrawerContent } from '../ui/Drawer';
import SidebarContent from './SidebarContent';
import TemplateBadge from './TemplateBadge';

export default function Header() {
  const { data: orgs = [] } = useOrgs();
  const { selectedOrgId, selectedScanId, setSelectedOrgId, setSelectedScanId } = useOrgScanContext();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  useEffect(() => {
    if (orgs.length === 0) return;
    if (!selectedOrgId || !orgs.some((o) => o.id === selectedOrgId)) {
      setSelectedOrgId(orgs[0].id);
    }
  }, [orgs, selectedOrgId, setSelectedOrgId]);

  const orgIsValid = orgs.some((o) => o.id === selectedOrgId);
  const effectiveOrgId = orgIsValid ? selectedOrgId : (orgs[0]?.id ?? '');
  const { data: scans = [] } = useScans(effectiveOrgId || undefined);
  const completedScans = scans.filter((s) => s.status === 'completed');

  useEffect(() => {
    if (!effectiveOrgId || completedScans.length === 0) return;
    if (!selectedScanId || !completedScans.some((s) => s.id === selectedScanId)) {
      setSelectedScanId(completedScans[0].id);
    }
  }, [effectiveOrgId, completedScans, selectedScanId, setSelectedScanId]);

  const scanIsValid = completedScans.some((s) => s.id === selectedScanId);
  const effectiveScanId = scanIsValid ? selectedScanId : (completedScans[0]?.id ?? '');
  const runningScans = orgs.filter((o) => o.lastScanStatus === 'running').length;
  const selectedOrg = orgs.find((o) => o.id === effectiveOrgId);
  const selectedScan = completedScans.find((s) => s.id === effectiveScanId);

  return (
    <header className="bg-surface-subtle border-b border-border px-4 md:px-6 py-2.5 flex items-center justify-between shrink-0 z-30 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <DrawerRoot open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <DrawerTrigger className="md:hidden btn-ghost !p-1.5" aria-label="Open navigation">
            ☰
          </DrawerTrigger>
          <DrawerContent side="left" widthClassName="w-72">
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </DrawerContent>
        </DrawerRoot>
        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {runningScans > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/25">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
            {runningScans} scan{runningScans > 1 ? 's' : ''} running
          </div>
        )}

        <PopoverRoot open={switcherOpen} onOpenChange={setSwitcherOpen}>
          <PopoverTrigger className="flex items-center gap-2 text-sm border border-border-strong rounded px-2.5 py-1.5 hover:bg-surface-subtle transition-colors max-w-[260px]">
            <span className="truncate text-ink font-medium">{selectedOrg?.name ?? 'No org'}</span>
            {selectedOrg && <span className="text-xs bg-surface-sunken text-ink-faint px-1.5 py-0.5 rounded font-mono shrink-0">{selectedOrg.site}</span>}
            <span className="text-ink-faint text-xs shrink-0">▾</span>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3">
            <div className="mb-3">
              <label className="label">Organization</label>
              <select
                className="input text-sm"
                value={effectiveOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
              >
                {orgs.length === 0 && <option value="">No orgs</option>}
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}{o.ddOrgName && o.ddOrgName !== o.name ? ` (${o.ddOrgName})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Scan</label>
              <select
                className="input text-sm"
                value={effectiveScanId}
                onChange={(e) => setSelectedScanId(e.target.value)}
                disabled={completedScans.length === 0}
              >
                {completedScans.length === 0 && <option value="">No scans</option>}
                {completedScans.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                    {' '}{new Date(s.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </option>
                ))}
              </select>
            </div>
            {selectedScan && (
              <div className="mt-3 pt-3 border-t border-border text-xs text-ink-faint">
                {selectedScan.findingCount ?? 0} findings · viewing this scan across the app
              </div>
            )}
          </PopoverContent>
        </PopoverRoot>

        <TemplateBadge orgId={effectiveOrgId} scanId={effectiveScanId} />

        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          className="hidden sm:flex items-center gap-1.5 text-xs text-ink-faint border border-border-strong rounded px-2.5 py-1.5 hover:bg-surface-subtle transition-colors"
          aria-label="Open command palette"
        >
          <span>⌘K</span>
        </button>
      </div>
    </header>
  );
}

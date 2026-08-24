import { useEffect } from 'react';
import { useOrgs, useScans } from './useOrgs';
import { useOrgScanContext } from '../context/OrgScanContext';

export function useOrgAndScanFilters() {
  const { data: orgs = [] } = useOrgs();
  const { selectedOrgId, selectedScanId, setSelectedOrgId, setSelectedScanId } = useOrgScanContext();

  // selectedOrgId/selectedScanId come from localStorage and can point at an
  // org/scan that's since been deleted — falling back only when they're EMPTY
  // (the old behavior) means a stale id sticks around forever once set, and
  // React Query keeps serving that org's last-successful cached data even as
  // refetches start 404ing. Validate against the current list every render,
  // same as the header's own org/scan switcher does.
  const orgIsValid = orgs.some((o) => o.id === selectedOrgId);
  const effectiveOrgId = orgIsValid ? selectedOrgId : (orgs[0]?.id ?? '');
  const { data: scans = [] } = useScans(effectiveOrgId || undefined);
  const completedScans = scans.filter((s) => s.status === 'completed');
  const scanIsValid = completedScans.some((s) => s.id === selectedScanId);
  const effectiveScanId = scanIsValid ? selectedScanId : (completedScans[0]?.id ?? '');

  // Self-heal localStorage once the effective values diverge from what's
  // stored, whether that's because nothing was selected yet or because the
  // previous selection no longer exists.
  useEffect(() => {
    if (effectiveOrgId !== selectedOrgId) setSelectedOrgId(effectiveOrgId);
  }, [effectiveOrgId, selectedOrgId, setSelectedOrgId]);

  useEffect(() => {
    if (effectiveScanId !== selectedScanId) setSelectedScanId(effectiveScanId);
  }, [effectiveScanId, selectedScanId, setSelectedScanId]);

  return {
    orgs,
    scans: completedScans,
    selectedOrgId: effectiveOrgId,
    selectedScanId: effectiveScanId,
    setSelectedOrgId,
    setSelectedScanId,
  };
}

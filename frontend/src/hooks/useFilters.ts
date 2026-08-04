import { useEffect } from 'react';
import { useOrgs, useScans } from './useOrgs';
import { useOrgScanContext } from '../context/OrgScanContext';

export function useOrgAndScanFilters() {
  const { data: orgs = [] } = useOrgs();
  const { selectedOrgId, selectedScanId, setSelectedOrgId, setSelectedScanId } = useOrgScanContext();

  const effectiveOrgId = selectedOrgId || orgs[0]?.id || '';
  const { data: scans = [] } = useScans(effectiveOrgId || undefined);
  const completedScans = scans.filter((s) => s.status === 'completed');
  const effectiveScanId = selectedScanId || completedScans[0]?.id || '';

  // Auto-persist first available org/scan to context+localStorage
  useEffect(() => {
    if (!selectedOrgId && orgs[0]?.id) setSelectedOrgId(orgs[0].id);
  }, [orgs, selectedOrgId, setSelectedOrgId]);

  useEffect(() => {
    if (effectiveOrgId && !selectedScanId && completedScans[0]?.id) {
      setSelectedScanId(completedScans[0].id);
    }
  }, [effectiveOrgId, completedScans, selectedScanId, setSelectedScanId]);

  return {
    orgs,
    scans: completedScans,
    selectedOrgId: effectiveOrgId,
    selectedScanId: effectiveScanId,
    setSelectedOrgId,
    setSelectedScanId,
  };
}

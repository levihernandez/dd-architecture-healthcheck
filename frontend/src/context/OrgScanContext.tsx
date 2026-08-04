import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface OrgScanContextValue {
  selectedOrgId: string;
  selectedScanId: string;
  setSelectedOrgId: (id: string) => void;
  setSelectedScanId: (id: string) => void;
}

const OrgScanContext = createContext<OrgScanContextValue>({
  selectedOrgId: '',
  selectedScanId: '',
  setSelectedOrgId: () => {},
  setSelectedScanId: () => {},
});

export function OrgScanProvider({ children }: { children: ReactNode }) {
  const [selectedOrgId, setOrgId] = useState<string>(() => localStorage.getItem('dd_org_id') ?? '');
  const [selectedScanId, setScanId] = useState<string>(() => localStorage.getItem('dd_scan_id') ?? '');

  const setSelectedOrgId = useCallback((id: string) => {
    setOrgId(id);
    setScanId('');
    if (id) localStorage.setItem('dd_org_id', id); else localStorage.removeItem('dd_org_id');
    localStorage.removeItem('dd_scan_id');
  }, []);

  const setSelectedScanId = useCallback((id: string) => {
    setScanId(id);
    if (id) localStorage.setItem('dd_scan_id', id); else localStorage.removeItem('dd_scan_id');
  }, []);

  return (
    <OrgScanContext.Provider value={{ selectedOrgId, selectedScanId, setSelectedOrgId, setSelectedScanId }}>
      {children}
    </OrgScanContext.Provider>
  );
}

export function useOrgScanContext() {
  return useContext(OrgScanContext);
}

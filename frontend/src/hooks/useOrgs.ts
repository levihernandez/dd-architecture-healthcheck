import { useQuery } from '@tanstack/react-query';
import { orgsApi, scansApi } from '../services/api';

export function useOrgs() {
  return useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    refetchInterval: (query) => {
      const orgs = query.state.data ?? [];
      return orgs.some((o) => o.lastScanStatus === 'running') ? 3000 : false;
    },
  });
}

export function useOrg(id: string | undefined) {
  return useQuery({
    queryKey: ['orgs', id],
    queryFn: () => orgsApi.get(id!),
    enabled: Boolean(id),
  });
}

export function useScans(orgId: string | undefined) {
  return useQuery({
    queryKey: ['scans', orgId],
    queryFn: () => scansApi.list(orgId!),
    enabled: Boolean(orgId),
    refetchInterval: (query) => {
      const scans = query.state.data ?? [];
      return scans.some((s) => s.status === 'running' || s.status === 'pending') ? 2000 : false;
    },
  });
}

export function useScan(id: string | undefined) {
  return useQuery({
    queryKey: ['scans', 'detail', id],
    queryFn: () => scansApi.get(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const scan = query.state.data;
      return scan?.status === 'running' || scan?.status === 'pending' ? 2000 : false;
    },
  });
}

import { useQueries } from '@tanstack/react-query';
import { analyticsApi, scansApi, usageApi } from '../services/api';
import { useOrgs } from './useOrgs';
import type { AnalyticsData, Org, UsageData } from '../types';

export type MultiOrgRow = {
  org: Org;
  scanId?: string;
  analytics?: AnalyticsData;
  usage?: UsageData | null;
};

// Two-stage fan-out (orgs -> latest completed scan -> analytics+usage), since there's no
// single backend endpoint that returns "latest completed scan" or bundled analytics/usage per org.
export function useMultiOrgSizing(enabled: boolean) {
  const { data: orgs = [] } = useOrgs();

  const scanQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ['scans', org.id],
      queryFn: () => scansApi.list(org.id),
      enabled: enabled && orgs.length > 0,
    })),
  });

  const orgsWithScan = orgs.map((org, i) => {
    const scans = scanQueries[i]?.data ?? [];
    const latest = scans.find((s) => s.status === 'completed');
    return { org, scanId: latest?.id };
  });
  const ready = orgsWithScan.filter((o) => o.scanId);
  const scansLoading = enabled && scanQueries.some((q) => q.isLoading);

  const analyticsQueries = useQueries({
    queries: ready.map((o) => ({
      queryKey: ['analytics', o.org.id, o.scanId],
      queryFn: () => analyticsApi.get(o.org.id, o.scanId!),
      enabled: enabled && Boolean(o.scanId),
    })),
  });

  const usageQueries = useQueries({
    queries: ready.map((o) => ({
      queryKey: ['usage', o.org.id, o.scanId],
      queryFn: () => usageApi.get(o.org.id, o.scanId),
      enabled: enabled && Boolean(o.scanId),
    })),
  });

  const rows: MultiOrgRow[] = ready.map((o, i) => ({
    org: o.org,
    scanId: o.scanId,
    analytics: analyticsQueries[i]?.data,
    usage: usageQueries[i]?.data,
  }));

  const isLoading = scansLoading || analyticsQueries.some((q) => q.isLoading) || usageQueries.some((q) => q.isLoading);

  return {
    rows,
    isLoading,
    totalOrgs: orgs.length,
    readyOrgs: ready.length,
    hasMultipleOrgs: orgs.length > 1,
  };
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { scansApi, inventoryApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import EvidenceTable from '../components/common/EvidenceTable';
import { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';
import FilterChip, { FilterChipRow } from '../components/ui/FilterChip';
import { SkeletonCards, SkeletonCard } from '../components/ui/Skeleton';
import SectionGate from '../components/SectionGate';
import type { FindingSeverity } from '../types';

export default function Integrations() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all');

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['findings', selectedScanId, 'integration_hygiene'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'integration_hygiene' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: inventory } = useQuery({
    queryKey: ['inventory-summary', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.summary(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const severityCounts = useMemo(() => {
    const counts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    findings.forEach((f) => { counts[f.severity] = (counts[f.severity] ?? 0) + 1; });
    return counts;
  }, [findings]);

  const filteredFindings = severityFilter === 'all' ? findings : findings.filter((f) => f.severity === severityFilter);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Integrations" subtitle="Cloud integrations, notification channels, and configuration hygiene" />

      {!selectedScanId ? <EmptyState message="Run a scan to see integration data" /> : isLoading ? (
        <div className="space-y-6">
          <SkeletonCards count={2} />
          <SkeletonCard />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="card"><div className="text-2xl font-bold text-ink">{inventory?.integrations ?? 0}</div><div className="text-sm text-ink-muted">Integrations Detected</div></div>
            <div className="card"><div className="text-2xl font-bold text-ink">{inventory?.cloudAccounts ?? 0}</div><div className="text-sm text-ink-muted">Cloud Accounts</div></div>
          </div>
          {findings.length > 0 ? (
            <SectionGate featureKey="section.integrations.findings_table">
              <div className="card">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="text-lg font-semibold text-ink">
                    Integration Findings ({filteredFindings.length}{filteredFindings.length !== findings.length ? ` of ${findings.length}` : ''})
                  </h2>
                  <FilterChipRow>
                    <FilterChip label="All" active={severityFilter === 'all'} count={findings.length} onClick={() => setSeverityFilter('all')} />
                    {(['critical', 'high', 'medium', 'low', 'info'] as FindingSeverity[])
                      .filter((s) => severityCounts[s] > 0)
                      .map((s) => (
                        <FilterChip
                          key={s}
                          label={s[0].toUpperCase() + s.slice(1)}
                          active={severityFilter === s}
                          count={severityCounts[s]}
                          onClick={() => setSeverityFilter(s)}
                        />
                      ))}
                  </FilterChipRow>
                </div>
                <EvidenceTable findings={filteredFindings} />
              </div>
            </SectionGate>
          ) : <div className="card text-center py-8"><div className="text-green-400 text-2xl mb-2">✓</div><p className="text-ink">Integrations look healthy</p></div>}
        </>
      )}
    </div>
  );
}

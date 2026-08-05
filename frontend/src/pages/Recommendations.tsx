import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { scansApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import LoadingState, { EmptyState } from '../components/common/LoadingState';
import { SeverityBadge } from '../components/common/StatusBadge';
import DataTable, { type Column } from '../components/common/DataTable';
import PageHeader from '../components/ui/PageHeader';
import FilterChip, { FilterChipRow } from '../components/ui/FilterChip';
import { CATEGORY_LABELS } from '../types';
import type { Finding, FindingCategory, FindingSeverity } from '../types';

const SEVERITY_ORDER: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SEVERITY_TILES: Array<{ severity: FindingSeverity; label: string; color: string }> = [
  { severity: 'critical', label: 'Critical', color: 'text-red-400 bg-red-500/10 border-red-500/30' },
  { severity: 'high', label: 'High', color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
  { severity: 'medium', label: 'Medium', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { severity: 'low', label: 'Low', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  { severity: 'info', label: 'Info', color: 'text-ink-faint bg-surface-subtle border-border' },
];

export default function Recommendations() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const [activeSeverities, setActiveSeverities] = useState<Set<FindingSeverity>>(new Set());
  const [activeCategories, setActiveCategories] = useState<Set<FindingCategory>>(new Set());

  const { data: findings = [], isLoading } = useQuery({
    queryKey: ['findings-all', selectedScanId],
    queryFn: () => scansApi.getFindings(selectedScanId),
    enabled: Boolean(selectedScanId),
  });

  const categoryCounts = useMemo(() => {
    const acc = {} as Record<FindingCategory, number>;
    for (const f of findings) acc[f.category] = (acc[f.category] ?? 0) + 1;
    return acc;
  }, [findings]);

  const severityCounts = useMemo(() => {
    const acc = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<FindingSeverity, number>;
    for (const f of findings) acc[f.severity] += 1;
    return acc;
  }, [findings]);

  const filteredFindings = useMemo(() => {
    return findings.filter((f) =>
      (activeSeverities.size === 0 || activeSeverities.has(f.severity)) &&
      (activeCategories.size === 0 || activeCategories.has(f.category))
    );
  }, [findings, activeSeverities, activeCategories]);

  function toggleSeverity(s: FindingSeverity) {
    setActiveSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  function toggleCategory(c: FindingCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }

  const hasActiveFilters = activeSeverities.size > 0 || activeCategories.size > 0;
  const clearFilters = () => { setActiveSeverities(new Set()); setActiveCategories(new Set()); };

  const columns: Column<Finding>[] = [
    {
      key: 'severity',
      header: 'Severity',
      width: '110px',
      sortable: true,
      sortAccessor: (f) => SEVERITY_ORDER[f.severity],
      render: (f) => <SeverityBadge severity={f.severity} />,
    },
    {
      key: 'title',
      header: 'Finding',
      sortable: true,
      render: (f) => (
        <div>
          <p className="text-sm font-medium text-ink">{f.title}</p>
          <p className="text-xs text-ink-faint mt-0.5">{f.description}</p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      width: '160px',
      sortable: true,
      sortAccessor: (f) => CATEGORY_LABELS[f.category],
      render: (f) => <span className="badge bg-surface-sunken text-ink-muted">{CATEGORY_LABELS[f.category]}</span>,
    },
    {
      key: 'affected',
      header: 'Affected',
      width: '130px',
      sortable: true,
      sortAccessor: (f) => f.percentage,
      render: (f) => (
        <span className="text-sm text-ink-muted">
          {f.affectedCount}/{f.totalCount}
          {f.totalCount > 0 && <span className="text-ink-faint"> ({f.percentage}%)</span>}
        </span>
      ),
    },
    {
      key: 'recommendation',
      header: 'Recommendation',
      render: (f) => (
        <div>
          <p className="text-sm text-ink-muted">{f.recommendation}</p>
          {f.evidence.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {f.evidence.slice(0, 3).map((ev, i) => (
                <span key={i} className="text-xs bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/30">
                  {ev.description}
                </span>
              ))}
              {f.evidence.length > 3 && (
                <span className="text-xs text-ink-faint px-1">+{f.evidence.length - 3} more</span>
              )}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Recommendations"
        subtitle="All findings prioritized by severity, with remediation guidance"
      />

      {!selectedScanId ? <EmptyState message="Run a scan to see recommendations" /> : isLoading ? <LoadingState /> : findings.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">🎉</div>
          <h3 className="text-lg font-semibold text-green-400">No findings!</h3>
          <p className="text-ink-muted">Your Datadog environment passed all health checks.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {SEVERITY_TILES.map(({ severity, label, color }) => (
              <button
                key={severity}
                onClick={() => toggleSeverity(severity)}
                className={`card border text-center transition-all ${color} ${
                  activeSeverities.size > 0 && !activeSeverities.has(severity) ? 'opacity-40' : ''
                } ${activeSeverities.has(severity) ? 'ring-2 ring-offset-1 ring-dd-purple/50' : ''}`}
              >
                <div className="text-2xl font-bold">{severityCounts[severity]}</div>
                <div className="text-sm font-medium">{label}</div>
              </button>
            ))}
          </div>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <FilterChipRow>
              {(Object.keys(categoryCounts) as FindingCategory[]).map((cat) => (
                <FilterChip
                  key={cat}
                  label={CATEGORY_LABELS[cat]}
                  count={categoryCounts[cat]}
                  active={activeCategories.has(cat)}
                  onClick={() => toggleCategory(cat)}
                />
              ))}
            </FilterChipRow>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-dd-purple hover:text-dd-purple-dark font-medium shrink-0">
                Clear filters
              </button>
            )}
          </div>

          <div className="text-sm text-ink-faint">
            Showing {filteredFindings.length} of {findings.length} finding{findings.length === 1 ? '' : 's'}
          </div>

          <DataTable
            tableId="recommendations"
            columns={columns}
            data={filteredFindings}
            rowKey={(f) => f.id}
            emptyMessage="No findings match the selected filters"
            searchable
            pageSize={15}
            selectable
            bulkActions={(selected, clear) => (
              <button
                className="btn-secondary text-xs px-3 py-1.5"
                onClick={() => {
                  const markdown = selected
                    .map((f) => `- **[${f.severity.toUpperCase()}] ${f.title}** — ${f.recommendation}`)
                    .join('\n');
                  navigator.clipboard.writeText(markdown)
                    .then(() => toast.success(`Copied ${selected.length} recommendation${selected.length === 1 ? '' : 's'} as Markdown`))
                    .catch(() => toast.error('Failed to copy to clipboard'));
                  clear();
                }}
              >
                Copy as Markdown
              </button>
            )}
          />
        </>
      )}
    </div>
  );
}

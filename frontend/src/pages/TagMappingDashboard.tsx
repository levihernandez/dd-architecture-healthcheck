import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { taggingApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { EmptyState } from '../components/common/LoadingState';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards } from '../components/ui/Skeleton';
import FilterChip, { FilterChipRow } from '../components/ui/FilterChip';

function StatusBadge({ status }: { status: 'found' | 'missing' | 'drifted' }) {
  const map = {
    found: 'bg-green-100 text-green-700',
    missing: 'bg-red-100 text-red-700',
    drifted: 'bg-amber-100 text-amber-700',
  };
  const label = { found: '✓ Found', missing: '✗ Missing', drifted: '⚠ Drifted' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status]}`}>{label[status]}</span>;
}

function ConflictTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    casing: 'bg-amber-100 text-amber-700',
    value_drift: 'bg-orange-100 text-orange-700',
    synonym_duplicate: 'bg-red-100 text-red-700',
  };
  const label: Record<string, string> = {
    casing: 'Casing Conflict',
    value_drift: 'Value Drift',
    synonym_duplicate: 'Synonym Duplicate',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[type] ?? 'bg-surface-sunken text-ink-muted'}`}>{label[type] ?? type}</span>;
}

export default function TagMappingDashboard() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const enabled = Boolean(selectedOrgId && selectedScanId);
  const [conflictTypeFilter, setConflictTypeFilter] = useState<string>('all');

  const { data: norm, isLoading } = useQuery({
    queryKey: ['tagging-normalization', selectedOrgId, selectedScanId],
    queryFn: () => taggingApi.normalization(selectedOrgId, selectedScanId),
    enabled,
  });

  const conflictTypes = Array.from(new Set((norm?.conflicts ?? []).map((c) => c.conflictType)));
  const filteredConflicts = (norm?.conflicts ?? []).filter(
    (c) => conflictTypeFilter === 'all' || c.conflictType === conflictTypeFilter
  );

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader
        title="Tag Mapping Dashboard"
        subtitle="Synonym detection, conflict analysis, and tag normalization"
      />

      {!selectedScanId ? <EmptyState message="Run a scan to analyze tag normalization" /> :
        isLoading ? (
          <div className="space-y-8">
            <SkeletonCards count={3} />
            <SkeletonCards count={4} />
          </div>
        ) : !norm ? <EmptyState message="No tag data found for this scan" /> : (
          <>
            {/* Score bar */}
            <div className="card flex items-center gap-6">
              <div className="text-center">
                <div className="text-4xl font-bold text-ink">{norm.normalizationScore}</div>
                <div className="text-xs text-ink-muted mt-1">Normalization Score</div>
              </div>
              <div className="flex-1 grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-violet-700">{norm.totalTagKeys}</div>
                  <div className="text-xs text-ink-muted">Total Tag Keys</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-amber-600">{norm.conflicts.length}</div>
                  <div className="text-xs text-ink-muted">Conflicts Detected</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-600">{norm.synonymGroups.filter((g) => !g.isAligned).length}</div>
                  <div className="text-xs text-ink-muted">Synonyms to Merge</div>
                </div>
              </div>
            </div>

            {/* Conflicts — most actionable, shown first */}
            {norm.conflicts.length > 0 && (
              <section>
                <h2 className="text-lg font-bold text-ink mb-1">Conflicts & Inconsistencies</h2>
                <p className="text-sm text-ink-muted mb-3">Issues that reduce tag reliability and should be resolved before extending coverage.</p>
                {conflictTypes.length > 1 && (
                  <FilterChipRow>
                    <FilterChip
                      label="All"
                      active={conflictTypeFilter === 'all'}
                      count={norm.conflicts.length}
                      onClick={() => setConflictTypeFilter('all')}
                    />
                    {conflictTypes.map((t) => (
                      <FilterChip
                        key={t}
                        label={t.replace(/_/g, ' ')}
                        active={conflictTypeFilter === t}
                        count={norm.conflicts.filter((c) => c.conflictType === t).length}
                        onClick={() => setConflictTypeFilter(t)}
                      />
                    ))}
                  </FilterChipRow>
                )}
                <div className="space-y-3 mt-3">
                  {filteredConflicts.map((c, i) => (
                    <div key={i} className="card border-l-4 border-amber-400">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <code className="text-sm font-mono text-ink">{c.tagKey}</code>
                            <ConflictTypeBadge type={c.conflictType} />
                            <span className="text-xs text-ink-faint">{c.affectedCount} resources affected</span>
                          </div>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {c.valuesFound.map((v) => (
                              <code key={v} className="text-xs bg-red-50 border border-red-200 text-red-700 px-1.5 py-0.5 rounded">{v}</code>
                            ))}
                          </div>
                          <div className="text-xs text-ink-muted">
                            <span className="font-semibold text-blue-600 uppercase tracking-wide">Fix: </span>
                            {c.recommendation}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Synonym Groups */}
            <section>
              <h2 className="text-lg font-bold text-ink mb-1">Synonym Detection</h2>
              <p className="text-sm text-ink-muted mb-3">Tag keys detected in your org that map to the same canonical Datadog key. Consolidating these reduces confusion and enables unified filtering.</p>
              <div className="space-y-3">
                {norm.synonymGroups.map((g) => (
                  <div key={g.canonicalKey} className={`card border-l-4 ${g.isAligned ? 'border-green-400' : 'border-amber-400'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <code className="text-sm font-mono text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200">
                            {g.canonicalKey}
                          </code>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${g.isAligned ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {g.isAligned ? '✓ Aligned' : `${g.detectedVariants.length} variants`}
                          </span>
                          <span className="text-xs text-ink-faint">confidence: {Math.round(g.confidence * 100)}%</span>
                        </div>
                        <p className="text-xs text-ink-muted mb-2">{g.description}</p>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {g.detectedVariants.map((v) => (
                            <code key={v} className={`text-xs px-1.5 py-0.5 rounded border ${v === g.canonicalKey ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                              {v}
                            </code>
                          ))}
                        </div>
                        {!g.isAligned && (
                          <div className="text-xs">
                            <span className="font-semibold text-blue-600 uppercase tracking-wide">Action: </span>
                            <span className="text-ink-muted">{g.recommendation}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-ink">{g.occurrenceCount.toLocaleString()}</div>
                        <div className="text-xs text-ink-faint">occurrences</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Tag Dictionary — reference view, shown last */}
            <section>
              <h2 className="text-lg font-bold text-ink mb-1">Tag Dictionary Status</h2>
              <p className="text-sm text-ink-muted mb-3">Coverage of standard Datadog tagging keys across your infrastructure.</p>
              <div className="grid grid-cols-2 gap-3">
                {norm.tagDictionary.map((entry) => (
                  <div key={entry.canonicalKey} className="card">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200">
                          {entry.canonicalKey}
                        </code>
                        {entry.isUst && <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">UST</span>}
                      </div>
                      <StatusBadge status={entry.status} />
                    </div>
                    <p className="text-xs text-ink-muted mb-2">{entry.definition}</p>
                    {entry.foundKey && entry.foundKey !== entry.canonicalKey && (
                      <p className="text-xs text-amber-600">Found as: <code>{entry.foundKey}</code></p>
                    )}
                    {entry.status !== 'missing' && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-ink-muted mb-0.5">
                          <span>Host coverage</span>
                          <span className={entry.currentCoverage >= 80 ? 'text-green-700' : entry.currentCoverage >= 40 ? 'text-amber-700' : 'text-red-600'}>
                            {entry.currentCoverage}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-surface-sunken rounded-full">
                          <div
                            className={`h-1.5 rounded-full ${entry.currentCoverage >= 80 ? 'bg-green-500' : entry.currentCoverage >= 40 ? 'bg-amber-400' : 'bg-red-500'}`}
                            style={{ width: `${entry.currentCoverage}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { scansApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { EmptyState } from '../components/common/LoadingState';
import DataTable, { type Column } from '../components/common/DataTable';
import PageHeader from '../components/ui/PageHeader';
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton';
import { CATEGORY_LABELS } from '../types';
import type { CategoryComparison, FindingDiff } from '../types';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function ScoreDelta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-ink-faint">—</span>;
  if (delta === 0) return <span className="text-ink-muted">±0</span>;
  const positive = delta > 0;
  return (
    <span className={`font-semibold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
      {positive ? '▲' : '▼'} {Math.abs(Math.round(delta * 10) / 10)}
    </span>
  );
}

const STATUS_LABEL: Record<FindingDiff['status'], string> = {
  new: 'New', resolved: 'Resolved', worsened: 'Worsened', improved: 'Improved', unchanged: 'Unchanged',
};
const STATUS_BADGE: Record<FindingDiff['status'], string> = {
  new: 'bg-red-500/15 text-red-400',
  worsened: 'bg-orange-500/15 text-orange-400',
  resolved: 'bg-emerald-500/15 text-emerald-400',
  improved: 'bg-blue-500/15 text-blue-400',
  unchanged: 'bg-surface-sunken text-ink-muted',
};

function DiffRow({ diff }: { diff: FindingDiff }) {
  const before = diff.previous;
  const after = diff.current;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border last:border-b-0 text-sm">
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_BADGE[diff.status]}`}>
        {STATUS_LABEL[diff.status]}
      </span>
      <span className="text-xs text-ink-faint shrink-0">{CATEGORY_LABELS[diff.category]}</span>
      <span className="text-ink flex-1 truncate">{diff.ruleName}</span>
      <span className="text-xs text-ink-faint font-mono shrink-0">
        {before ? `${before.percentage}%` : '—'} → {after ? `${after.percentage}%` : '—'}
      </span>
    </div>
  );
}

function DiffList({ diffs, emptyLabel }: { diffs: FindingDiff[]; emptyLabel: string }) {
  if (diffs.length === 0) return <div className="text-xs text-ink-faint py-4 text-center">{emptyLabel}</div>;
  return <div>{diffs.map((d) => <DiffRow key={`${d.category}-${d.ruleId}`} diff={d} />)}</div>;
}

export default function ScanComparison() {
  const { scans, selectedScanId } = useOrgAndScanFilters();
  const [currentScanId, setCurrentScanId] = useState('');
  const [previousScanId, setPreviousScanId] = useState('');

  const effectiveCurrent = currentScanId || selectedScanId;
  // Default "compare against" to the scan right after the current one in the
  // (most-recent-first) list — matches the backend's own auto-resolution, but
  // computing it here too lets the dropdown show a sensible pre-selected value.
  const defaultPrevious = useMemo(() => {
    const idx = scans.findIndex((s) => s.id === effectiveCurrent);
    return idx >= 0 ? scans[idx + 1]?.id ?? '' : '';
  }, [scans, effectiveCurrent]);
  const effectivePrevious = previousScanId || defaultPrevious;

  const { data: comparison, isLoading, error } = useQuery({
    queryKey: ['scan-comparison', effectiveCurrent, effectivePrevious],
    queryFn: () => scansApi.compare(effectiveCurrent, effectivePrevious || undefined),
    enabled: Boolean(effectiveCurrent),
  });

  const categoryColumns: Column<CategoryComparison>[] = [
    { key: 'category', header: 'Category', render: (c) => <span className="text-sm text-ink">{CATEGORY_LABELS[c.category]}</span> },
    { key: 'previousScore', header: 'Previous', render: (c) => <span className="text-xs text-ink-faint">{c.previousScore ?? '—'}</span> },
    { key: 'currentScore', header: 'Current', render: (c) => <span className="text-xs text-ink">{c.currentScore ?? '—'}</span> },
    { key: 'delta', header: 'Change', render: (c) => <ScoreDelta delta={c.scoreDelta} /> },
    { key: 'concerns', header: 'Concerns', render: (c) => c.concerns.length > 0
      ? <span className="badge bg-red-500/15 text-red-400">{c.concerns.length}</span>
      : <span className="text-ink-faint">—</span> },
    { key: 'improvements', header: 'Improvements', render: (c) => c.improvements.length > 0
      ? <span className="badge bg-emerald-500/15 text-emerald-400">{c.improvements.length}</span>
      : <span className="text-ink-faint">—</span> },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Scan Comparison"
        subtitle="Diff two scans across every assessment category — what improved, and what needs attention."
      />

      <div className="card flex flex-wrap items-end gap-4">
        <div>
          <label className="text-xs text-ink-faint block mb-1">Current scan</label>
          <select
            className="input text-sm"
            value={effectiveCurrent}
            onChange={(e) => setCurrentScanId(e.target.value)}
          >
            {scans.map((s) => (
              <option key={s.id} value={s.id}>{formatDate(s.completedAt ?? s.startedAt)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-faint block mb-1">Compare against</label>
          <select
            className="input text-sm"
            value={effectivePrevious}
            onChange={(e) => setPreviousScanId(e.target.value)}
          >
            {scans.filter((s) => s.id !== effectiveCurrent).map((s) => (
              <option key={s.id} value={s.id}>{formatDate(s.completedAt ?? s.startedAt)}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <SkeletonCards count={3} />
          <SkeletonTable rows={6} cols={6} />
        </div>
      ) : error ? (
        <EmptyState
          message={
            (isAxiosError<{ message?: string }>(error) && error.response?.data?.message) ||
            'No earlier scan available to compare against yet.'
          }
        />
      ) : !comparison ? (
        <EmptyState message="Select a scan to compare" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="card">
              <div className="text-xs text-ink-faint mb-1">Previous score</div>
              <div className="text-2xl font-bold text-ink">{comparison.overallPreviousScore ?? '—'}</div>
              <div className="text-xs text-ink-faint mt-1">{formatDate(comparison.previousCompletedAt)}</div>
            </div>
            <div className="card">
              <div className="text-xs text-ink-faint mb-1">Current score</div>
              <div className="text-2xl font-bold text-ink">{comparison.overallCurrentScore ?? '—'}</div>
              <div className="text-xs text-ink-faint mt-1">{formatDate(comparison.currentCompletedAt)}</div>
            </div>
            <div className="card">
              <div className="text-xs text-ink-faint mb-1">Change</div>
              <div className="text-2xl"><ScoreDelta delta={comparison.overallScoreDelta} /></div>
            </div>
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wide mb-2">
              ⚠ Trigger Concerns ({comparison.topConcerns.length})
            </h2>
            <p className="text-xs text-ink-faint mb-3">New violations, or existing ones that got worse — since the previous scan.</p>
            <DiffList diffs={comparison.topConcerns} emptyLabel="No new or worsened findings — nothing to flag." />
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-emerald-400 uppercase tracking-wide mb-2">
              ✓ Improvements ({comparison.topImprovements.length})
            </h2>
            <p className="text-xs text-ink-faint mb-3">Resolved findings, or existing ones that got better.</p>
            <DiffList diffs={comparison.topImprovements} emptyLabel="No resolved or improved findings yet." />
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-ink mb-3">By Category</h2>
            <DataTable
              columns={categoryColumns}
              data={comparison.categories}
              rowKey={(c) => c.category}
              emptyMessage="No categories to show"
              tableId="scan-comparison-categories"
              expandable={(c) => c.concerns.length + c.improvements.length > 0}
              expandedRowRender={(c) => (
                <div className="p-3 space-y-3 bg-surface-subtle">
                  {c.concerns.length > 0 && <DiffList diffs={c.concerns} emptyLabel="" />}
                  {c.improvements.length > 0 && <DiffList diffs={c.improvements} emptyLabel="" />}
                </div>
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import type { BestPracticeRecommendation } from '../../types';

export interface ResourceFindingCardProps {
  title: string;
  description?: string;
  tagKey?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  recommendation?: string;
  bestPractice?: BestPracticeRecommendation;
  affectedResources: Array<{ type: string; id: string; name: string }>;
  affectedCount?: number;
  totalCount?: number;
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400',
  high: 'bg-orange-500/15 text-orange-400',
  medium: 'bg-amber-500/15 text-amber-400',
  low: 'bg-blue-500/15 text-blue-400',
  info: 'bg-surface-sunken text-ink-muted',
};

/**
 * Shared card for showing "here's the tag issue, here's what Datadog
 * recommends, and here are the specific resources affected". Used by
 * TagExplorer (Finding-derived), CloudTagComparison (CloudAlignmentRow), and
 * TagMappingDashboard (normalization conflicts) via small per-page adapters.
 */
export default function ResourceFindingCard({
  title,
  description,
  tagKey,
  severity,
  recommendation,
  bestPractice,
  affectedResources,
  affectedCount,
  totalCount,
}: ResourceFindingCardProps) {
  const [showAll, setShowAll] = useState(false);

  const shown = showAll ? affectedResources : affectedResources.slice(0, 8);
  const total = totalCount ?? affectedCount ?? affectedResources.length;
  const moreCount = Math.max(0, total - shown.length);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {tagKey && (
            <code className="text-xs font-mono text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/30">
              {tagKey}
            </code>
          )}
          {severity && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_BADGE[severity] ?? SEVERITY_BADGE.info}`}>
              {severity}
            </span>
          )}
        </div>
        {typeof affectedCount === 'number' && (
          <span className="text-xs text-ink-faint shrink-0">
            {affectedCount}{typeof totalCount === 'number' ? ` / ${totalCount}` : ''} affected
          </span>
        )}
      </div>

      <h3 className="text-sm font-semibold text-ink mb-1">{title}</h3>
      {description && <p className="text-sm text-ink-muted mb-2">{description}</p>}

      {bestPractice?.found && (
        <div className="text-xs bg-blue-500/10 border border-blue-500/30 rounded px-3 py-2 mb-3 space-y-1">
          <div className="font-semibold text-blue-400 uppercase tracking-wide">Datadog recommends</div>
          {bestPractice.what && <p className="text-ink-muted"><span className="font-medium text-ink">What: </span>{bestPractice.what}</p>}
          {bestPractice.why && <p className="text-ink-muted"><span className="font-medium text-ink">Why: </span>{bestPractice.why}</p>}
          {bestPractice.how && <p className="text-ink-muted"><span className="font-medium text-ink">How: </span>{bestPractice.how}</p>}
        </div>
      )}

      {!bestPractice?.found && recommendation && (
        <div className="text-xs text-ink-muted mb-3">
          <span className="font-semibold text-blue-400 uppercase tracking-wide">Fix: </span>
          {recommendation}
        </div>
      )}

      {affectedResources.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">
            Affected resources
          </div>
          <div className="flex flex-wrap gap-1.5">
            {shown.map((r) => (
              <span
                key={`${r.type}-${r.id}`}
                className="inline-flex items-center gap-1 text-xs bg-surface-sunken px-1.5 py-0.5 rounded"
                title={r.id}
              >
                <span className="text-ink-faint">{r.type}</span>
                <code className="font-mono text-ink">{r.name}</code>
              </span>
            ))}
            {!showAll && moreCount > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="text-xs text-violet-400 hover:underline px-1.5 py-0.5"
              >
                +{moreCount} more
              </button>
            )}
            {showAll && affectedResources.length > 8 && (
              <button
                onClick={() => setShowAll(false)}
                className="text-xs text-ink-faint hover:underline px-1.5 py-0.5"
              >
                Show less
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

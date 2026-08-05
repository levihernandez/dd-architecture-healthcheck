import type { CostFigure } from '../../types';

// Small pill showing a per-segment cost figure — green "billed" when it's real
// Datadog usage/cost data, muted "est." when it's a list-price fallback because
// no real billing was collected for this org/scan.
export function CostBadge({ cost }: { cost: CostFigure | null | undefined }) {
  if (!cost || cost.amount <= 0) return null;
  const isReal = cost.source === 'real';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
        isReal ? 'bg-green-500/15 text-green-400' : 'bg-surface-sunken text-ink-muted'
      }`}
      title={cost.note ?? (isReal ? 'From billed usage data' : 'Estimated from list price')}
    >
      ~${cost.amount.toLocaleString()}/mo
      <span className="text-[9px] uppercase opacity-70">{isReal ? 'billed' : 'est.'}</span>
    </span>
  );
}

// Compact quick-recommendations list for a segment. Plain informational bullets —
// no severity color baked in since most callers pass a flat string[] and the
// severity is already implied by the surrounding section's stat colors.
export function RecommendationList({ items }: { items: string[] | undefined }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {items.map((text, i) => (
        <div key={i} className="flex items-start gap-2 text-xs bg-violet-500/10 border border-violet-500/30 text-violet-400 rounded-lg px-2.5 py-1.5">
          <span className="shrink-0">→</span>
          <span>{text}</span>
        </div>
      ))}
    </div>
  );
}

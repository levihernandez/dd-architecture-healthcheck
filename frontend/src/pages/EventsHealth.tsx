import { useQuery } from '@tanstack/react-query';
import { eventsApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import PageHeader from '../components/ui/PageHeader';
import MetricCard from '../components/common/MetricCard';
import { EmptyState } from '../components/common/LoadingState';
import { SkeletonCards } from '../components/ui/Skeleton';
import SectionGate from '../components/SectionGate';
import { CATEGORICAL, STATUS, trackTint } from '../lib/chartColors';
import type { EventStatBucket } from '../types';

const STATUS_COLOR: Record<string, string> = {
  success: STATUS.good,
  info: STATUS.good,
  recommendation: STATUS.good,
  user_update: STATUS.good,
  snapshot: STATUS.good,
  warning: STATUS.warning,
  error: STATUS.serious,
  failure: STATUS.critical,
};

// Fold anything past the top N into "Other" — a categorical palette has 8
// fixed hues; a 9th+ series is never a generated color (dataviz color-formula.md).
function topNWithOther(buckets: EventStatBucket[], n: number): EventStatBucket[] {
  if (buckets.length <= n) return buckets;
  const top = buckets.slice(0, n);
  const otherCount = buckets.slice(n).reduce((sum, b) => sum + b.count, 0);
  return [...top, { key: 'Other', count: otherCount }];
}

function BarList({ buckets, colorFor, total }: {
  buckets: EventStatBucket[];
  colorFor: (key: string, index: number) => string;
  total: number;
}) {
  if (buckets.length === 0) {
    return <div className="text-sm text-ink-faint text-center py-6">No events in this window.</div>;
  }
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="space-y-2">
      {buckets.map((b, i) => {
        const color = colorFor(b.key, i);
        const pct = total > 0 ? ((b.count / total) * 100).toFixed(1) : '0.0';
        return (
          <div key={b.key} className="flex items-center gap-2">
            <span className="text-xs text-ink-muted w-32 shrink-0 truncate" title={b.key}>{b.key}</span>
            <div className="flex-1 h-2 rounded-full min-w-0" style={{ backgroundColor: trackTint(color, 0.15) }}>
              <div className="h-2 rounded-full" style={{ width: `${(b.count / max) * 100}%`, backgroundColor: color }} />
            </div>
            <span className="text-xs font-mono text-ink w-16 text-right shrink-0">{b.count.toLocaleString()}</span>
            <span className="text-xs text-ink-faint w-12 text-right shrink-0">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

export default function EventsHealth() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const { data, isLoading } = useQuery({
    queryKey: ['events-stats', selectedOrgId, selectedScanId],
    queryFn: () => eventsApi.stats(selectedOrgId, selectedScanId || undefined),
    enabled: Boolean(selectedOrgId),
  });

  if (!selectedOrgId) {
    return (
      <div className="max-w-5xl mx-auto">
        <PageHeader title="Event Stats" subtitle="Event volume by source, service, and status (last 24h)" />
        <EmptyState message="Select an organization to view event stats" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <PageHeader title="Event Stats" subtitle="Event volume by source, service, and status (last 24h)" />
        <SkeletonCards count={1} />
      </div>
    );
  }

  if (!data || data.totalEvents === 0) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <PageHeader title="Event Stats" subtitle="Event volume by source, service, and status (last 24h)" />
        <EmptyState message="No events found in the last 24h for this scan. Run a new scan to refresh." />
      </div>
    );
  }

  const byStatus = topNWithOther(data.byStatus, 8);
  const bySource = topNWithOther(data.bySource, 8);
  const byService = topNWithOther(data.byService, 8);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Event Stats"
        subtitle={`Event volume by source, service, and status — last 24h${data.computedAt ? ` · collected ${new Date(data.computedAt).toLocaleString()}` : ''}`}
      />

      <MetricCard label="Total Events" value={data.totalEvents.toLocaleString()} subtitle="Last 24h" icon="⚡" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionGate featureKey="section.events.by_status">
        <div className="card border-l-4 border-dd-purple">
          <h2 className="font-bold text-ink mb-3">By Status</h2>
          <BarList
            buckets={byStatus}
            total={data.totalEvents}
            colorFor={(key) => STATUS_COLOR[key] ?? STATUS.warning}
          />
        </div>
        </SectionGate>

        <SectionGate featureKey="section.events.by_source">
        <div className="card border-l-4 border-dd-purple">
          <h2 className="font-bold text-ink mb-3">By Source</h2>
          <BarList
            buckets={bySource}
            total={data.totalEvents}
            colorFor={(key, i) => (key === 'Other' ? STATUS.warning : CATEGORICAL[i % CATEGORICAL.length])}
          />
        </div>
        </SectionGate>

        <SectionGate featureKey="section.events.by_service">
        <div className="card border-l-4 border-dd-purple md:col-span-2">
          <h2 className="font-bold text-ink mb-3">By Service</h2>
          <BarList
            buckets={byService}
            total={data.totalEvents}
            colorFor={(key, i) => (key === 'Other' ? STATUS.warning : CATEGORICAL[i % CATEGORICAL.length])}
          />
        </div>
        </SectionGate>
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { scansApi, inventoryApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { OrgScorecardCard } from '../components/common/ScoreCard';
import EvidenceTable from '../components/common/EvidenceTable';
import LoadingState, { EmptyState } from '../components/common/LoadingState';
import { MissingTagPill } from '../components/common/TagPill';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { GRADE_COLORS } from '../types';

const REQUIRED_TAGS = ['env', 'service', 'version'];
const RECOMMENDED_TAGS = ['team', 'owner', 'cost_center'];

export default function UnifiedTaggingScorecard() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const { data: scorecard, isLoading: scorecardLoading } = useQuery({
    queryKey: ['scorecard', selectedScanId],
    queryFn: () => scansApi.getScorecard(selectedScanId),
    enabled: Boolean(selectedScanId),
  });

  const { data: findings = [], isLoading: findingsLoading } = useQuery({
    queryKey: ['findings', selectedScanId, 'unified_tagging'],
    queryFn: () => scansApi.getFindings(selectedScanId, { category: 'unified_tagging' }),
    enabled: Boolean(selectedScanId),
  });

  const { data: tags = [] } = useQuery({
    queryKey: ['tags', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.tags(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const { data: inventory } = useQuery({
    queryKey: ['inventory-summary', selectedOrgId, selectedScanId],
    queryFn: () => inventoryApi.summary(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const tagCoverageData = REQUIRED_TAGS.concat(RECOMMENDED_TAGS).map((key) => {
    const tag = tags.find((t) => t.tag_key === key);
    const hostCount = tag?.host_occurrence_count ?? 0;
    const total = inventory?.hosts ?? 1;
    return {
      key,
      coverage: total > 0 ? Math.round((hostCount / total) * 100) : 0,
      required: REQUIRED_TAGS.includes(key),
    };
  });

  const tagMappings = tags.filter((t) => t.suggested_mapping);

  if (scorecardLoading || findingsLoading) return <LoadingState />;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Unified Tagging Scorecard</h1>
          <p className="text-gray-500 text-sm mt-1">
            Assessment of env, service, and version tag coverage across your infrastructure
          </p>
        </div>
      </div>

      {!selectedScanId ? (
        <EmptyState message="Run a scan to see tagging analysis" />
      ) : (
        <>
          {/* Tag coverage chart */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Tag Coverage by Key</h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tagCoverageData} layout="vertical">
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="key" width={80} tick={{ fontSize: 12, fontFamily: 'monospace' }} />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="coverage" radius={[0, 4, 4, 0]}>
                    {tagCoverageData.map((entry) => (
                      <Cell
                        key={entry.key}
                        fill={entry.coverage >= 90 ? '#10b981' : entry.coverage >= 70 ? '#f59e0b' : '#ef4444'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tag standard compliance */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Unified Service Tagging Compliance</h2>
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Required Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {REQUIRED_TAGS.map((key) => {
                    const found = tags.find((t) => t.tag_key === key);
                    return found
                      ? <span key={key} className="badge bg-green-100 text-green-800">✓ {key}</span>
                      : <MissingTagPill key={key} tagKey={key} />;
                  })}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Recommended Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {RECOMMENDED_TAGS.map((key) => {
                    const found = tags.find((t) => t.tag_key === key);
                    return found
                      ? <span key={key} className="badge bg-blue-100 text-blue-800">✓ {key}</span>
                      : <MissingTagPill key={key} tagKey={key} />;
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Tag mapping suggestions */}
          {tagMappings.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Tag Mapping Suggestions</h2>
              <p className="text-sm text-gray-500 mb-3">
                These existing tags may correspond to standard tag keys. Review and remap as needed.
              </p>
              <div className="space-y-2">
                {tagMappings.map((t) => (
                  <div key={t.tag_key} className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded p-3">
                    <code className="text-sm text-amber-800 bg-amber-100 px-2 py-0.5 rounded">{t.tag_key}</code>
                    <span className="text-gray-500">→</span>
                    <code className="text-sm text-green-800 bg-green-100 px-2 py-0.5 rounded">{t.suggested_mapping}</code>
                    <span className="text-xs text-gray-500">
                      ({t.host_occurrence_count} hosts)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Findings */}
          {findings.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                Tagging Findings ({findings.length})
              </h2>
              <EvidenceTable findings={findings} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

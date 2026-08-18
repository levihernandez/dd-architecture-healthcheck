import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { scansApi, inventoryApi, taggingApi, tagTemplateApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import EvidenceTable from '../components/common/EvidenceTable';
import { EmptyState } from '../components/common/LoadingState';
import { MissingTagPill } from '../components/common/TagPill';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList, CartesianGrid } from 'recharts';
import PageHeader from '../components/ui/PageHeader';
import FilterChip, { FilterChipRow } from '../components/ui/FilterChip';
import { SkeletonCard, SkeletonText } from '../components/ui/Skeleton';
import type { FindingSeverity } from '../types';
import { STATUS, CHART_INK } from '../lib/chartColors';
import SectionGate from '../components/SectionGate';

export default function UnifiedTaggingScorecard() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all');

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

  // The org's selected tagging template (see Industry Templates) drives what
  // counts as required/recommended here — falls back to the generic baseline.
  const { data: activeSelection } = useQuery({
    queryKey: ['tag-template', selectedOrgId],
    queryFn: () => tagTemplateApi.get(selectedOrgId),
    enabled: Boolean(selectedOrgId),
  });
  const templateId = activeSelection?.templateId ?? 'generic';

  const { data: templateScore } = useQuery({
    queryKey: ['tagging-score', selectedOrgId, selectedScanId, templateId],
    queryFn: () => taggingApi.score(selectedOrgId, selectedScanId, templateId),
    enabled: Boolean(selectedOrgId && selectedScanId),
  });

  const requiredTags = templateScore ? [...templateScore.globalBaseline, ...templateScore.required] : [];
  const recommendedTags = templateScore?.recommended ?? [];

  const tagCoverageData = [
    ...requiredTags.map((t) => ({ key: t.key, coverage: t.coverage, required: true })),
    ...recommendedTags.map((t) => ({ key: t.key, coverage: t.coverage, required: false })),
  ];

  const tagMappings = tags.filter((t) => t.suggested_mapping);

  const severityCounts = useMemo(() => {
    const counts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    findings.forEach((f) => { counts[f.severity] = (counts[f.severity] ?? 0) + 1; });
    return counts;
  }, [findings]);

  const filteredFindings = severityFilter === 'all' ? findings : findings.filter((f) => f.severity === severityFilter);

  const isLoading = scorecardLoading || findingsLoading;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Unified Tagging Scorecard"
        subtitle="Assessment of env, service, and version tag coverage across your infrastructure"
        actions={
          templateScore && (
            <Link to="/tag-templates" className="text-xs text-ink-muted hover:text-dd-purple">
              Using <span className="font-medium text-ink">{templateScore.templateName}</span> template — change
            </Link>
          )
        }
      />

      {!selectedScanId ? (
        <EmptyState message="Run a scan to see tagging analysis" />
      ) : isLoading ? (
        <div className="space-y-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonText lines={4} />
        </div>
      ) : (
        <>
          {/* Tag coverage chart */}
          <SectionGate featureKey="section.tagging_scorecard.coverage_by_key">
            <div className="card">
              <h2 className="text-lg font-semibold text-ink mb-4">Tag Coverage by Key</h2>
              <div style={{ height: Math.max(192, tagCoverageData.length * 32) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tagCoverageData} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 0 }} barCategoryGap="30%">
                    <CartesianGrid horizontal={false} stroke={CHART_INK.gridline} />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: CHART_INK.muted }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="key" width={100} tick={{ fontSize: 12, fontFamily: 'monospace', fill: CHART_INK.secondary }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as { key: string; coverage: number };
                        return (
                          <div className="bg-gray-800 text-white border border-gray-700 text-xs px-2 py-1 rounded shadow-popover whitespace-nowrap">
                            {p.key}: <span className="font-semibold">{p.coverage}%</span>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="coverage" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {tagCoverageData.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={entry.coverage >= 90 ? STATUS.good : entry.coverage >= 70 ? STATUS.warning : STATUS.critical}
                        />
                      ))}
                      <LabelList
                        dataKey="coverage"
                        position="right"
                        formatter={(v: number) => `${v}%`}
                        style={{ fontSize: 12, fontWeight: 600, fill: CHART_INK.primary }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </SectionGate>

          {/* Tag standard compliance */}
          <SectionGate featureKey="section.tagging_scorecard.ust_compliance">
            <div className="card">
              <h2 className="text-lg font-semibold text-ink mb-3">Unified Service Tagging Compliance</h2>
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-ink-muted mb-2">Required Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {requiredTags.map((t) => (
                      t.found
                        ? <span key={t.key} className="badge bg-green-500/15 text-green-400">✓ {t.key}</span>
                        : <MissingTagPill key={t.key} tagKey={t.key} />
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-ink-muted mb-2">Recommended Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {recommendedTags.map((t) => (
                      t.found
                        ? <span key={t.key} className="badge bg-blue-500/15 text-blue-400">✓ {t.key}</span>
                        : <MissingTagPill key={t.key} tagKey={t.key} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </SectionGate>

          {/* Tag mapping suggestions */}
          {tagMappings.length > 0 && (
            <SectionGate featureKey="section.tagging_scorecard.mapping_suggestions">
              <div className="card">
                <h2 className="text-lg font-semibold text-ink mb-3">Tag Mapping Suggestions</h2>
                <p className="text-sm text-ink-muted mb-3">
                  These existing tags may correspond to standard tag keys. Review and remap as needed.
                </p>
                <div className="space-y-2">
                  {tagMappings.map((t) => (
                    <div key={t.tag_key} className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded p-3">
                      <code className="text-sm text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded">{t.tag_key}</code>
                      <span className="text-ink-muted">→</span>
                      <code className="text-sm text-green-400 bg-green-500/15 px-2 py-0.5 rounded">{t.suggested_mapping}</code>
                      <span className="text-xs text-ink-muted">
                        ({t.host_occurrence_count} hosts)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </SectionGate>
          )}

          {/* Findings */}
          {findings.length > 0 && (
            <SectionGate featureKey="section.tagging_scorecard.findings">
              <div className="card">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="text-lg font-semibold text-ink">
                    Tagging Findings ({filteredFindings.length}{filteredFindings.length !== findings.length ? ` of ${findings.length}` : ''})
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
          )}
        </>
      )}
    </div>
  );
}

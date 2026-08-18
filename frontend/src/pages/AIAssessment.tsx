import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { aiApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { EmptyState } from '../components/common/LoadingState';
import { SkeletonText } from '../components/ui/Skeleton';
import PageHeader from '../components/ui/PageHeader';
import { CATEGORY_LABELS } from '../types';
import type { FindingCategory } from '../types';
import SectionGate from '../components/SectionGate';

// ── Collapsible section wrapper for progressive disclosure ────────────────────

function CollapsibleSection({
  title, badge, defaultOpen = true, children,
}: { title: string; badge?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {badge}
        </span>
        <span className={`text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export default function AIAssessment() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();

  const { data: assessment, isLoading, refetch } = useQuery({
    queryKey: ['ai-assessment', selectedOrgId, selectedScanId],
    queryFn: () => aiApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => aiApi.generate(selectedOrgId, selectedScanId),
    onSuccess: () => {
      refetch();
      toast.success('AI assessment generated');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to generate assessment');
    },
  });

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="AI Assessment"
        subtitle="AI-generated health check analysis based on scan evidence"
        actions={
          selectedScanId && (
            <button
              className="btn-primary"
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? 'Generating…' : assessment ? 'Regenerate' : 'Generate Assessment'}
            </button>
          )
        }
      />

      {!selectedScanId ? (
        <EmptyState message="Run a scan first, then generate an AI assessment" />
      ) : isLoading ? (
        <div className="card space-y-4">
          <SkeletonText lines={3} />
        </div>
      ) : generate.isPending ? (
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-dd-purple">
            <span className="w-2 h-2 rounded-full bg-dd-purple animate-pulse" />
            AI is analyzing your Datadog environment — this usually takes 20–60 seconds…
          </div>
          <SkeletonText lines={4} />
        </div>
      ) : generate.isError ? (
        <div className="card bg-red-500/10 border-red-500/30">
          <p className="text-red-400 text-sm">{(generate.error as Error)?.message}</p>
          {String(generate.error).includes('No AI provider') && (
            <p className="text-red-400 text-xs mt-2">
              Configure AI_PROVIDER=openai or AI_PROVIDER=anthropic in your backend .env file
            </p>
          )}
        </div>
      ) : !assessment ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">✨</div>
          <h3 className="text-lg font-semibold text-ink mb-2">No AI assessment yet</h3>
          <p className="text-ink-muted mb-4 text-sm max-w-md mx-auto">
            The AI will analyze your scan findings, tagging coverage, and inventory to generate
            an executive-ready health check report with prioritized recommendations.
          </p>
          <button className="btn-primary" onClick={() => generate.mutate()}>
            Generate Assessment
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Executive Summary */}
          <SectionGate featureKey="section.ai_assessment.executive_summary">
          <div className="card border-l-4 border-dd-purple">
            <h2 className="text-lg font-semibold text-ink mb-2">Executive Summary</h2>
            <p className="text-ink-muted leading-relaxed">{assessment.executiveSummary}</p>
            <p className="text-xs text-ink-faint mt-3">
              Generated {new Date(assessment.generatedAt).toLocaleString()} · Based on {assessment.evidenceCount} findings
            </p>
          </div>
          </SectionGate>

          <SectionGate featureKey="section.ai_assessment.strengths_risks">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Strengths */}
            <div className="card">
              <h2 className="text-base font-semibold text-green-400 mb-3">✓ Key Strengths</h2>
              <ul className="space-y-2">
                {assessment.keyStrengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink-muted">
                    <span className="text-green-500 mt-0.5">•</span>{s}
                  </li>
                ))}
              </ul>
            </div>

            {/* Risks */}
            <div className="card">
              <h2 className="text-base font-semibold text-red-400 mb-3">⚠ Top Risks</h2>
              <ul className="space-y-2">
                {assessment.topRisks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink-muted">
                    <span className="text-red-500 mt-0.5">•</span>{r}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          </SectionGate>

          {/* Recommendations */}
          <SectionGate featureKey="section.ai_assessment.prioritized_recommendations">
          <CollapsibleSection
            title="Prioritized Recommendations"
            badge={<span className="badge bg-surface-sunken text-ink-muted">{assessment.prioritizedRecommendations.length}</span>}
          >
            <div className="space-y-4">
              {assessment.prioritizedRecommendations.map((rec) => (
                <div key={rec.priority} className="border border-border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-7 h-7 bg-dd-purple text-white rounded-full flex items-center justify-center text-xs font-bold">
                      {rec.priority}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-ink">{rec.title}</h3>
                        <span className="badge bg-surface-sunken text-ink-muted">{CATEGORY_LABELS[rec.category as FindingCategory]}</span>
                        <span className={`badge ${rec.impact === 'high' ? 'bg-red-500/15 text-red-400' : rec.impact === 'medium' ? 'bg-amber-500/15 text-amber-400' : 'bg-surface-sunken text-ink-muted'}`}>
                          {rec.impact} impact
                        </span>
                        <span className={`badge ${rec.effort === 'low' ? 'bg-green-500/15 text-green-400' : rec.effort === 'medium' ? 'bg-blue-500/15 text-blue-400' : 'bg-surface-sunken text-ink-muted'}`}>
                          {rec.effort} effort
                        </span>
                      </div>
                      <p className="text-sm text-ink-muted mt-1">{rec.description}</p>
                      {rec.evidenceRefs?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {rec.evidenceRefs.map((ref, i) => (
                            <span key={i} className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                              {ref}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
          </SectionGate>

          {/* Tagging strategy */}
          <SectionGate featureKey="section.ai_assessment.tagging_strategy">
          <CollapsibleSection title="Recommended Tagging Strategy">
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-ink-muted mb-2">Required Tags</h3>
                <div className="space-y-2">
                  {assessment.taggingStrategyProposal.requiredTags.map((t) => (
                    <div key={t.key} className="bg-green-500/10 border border-green-500/30 rounded p-2">
                      <code className="text-sm font-mono text-green-400">{t.key}</code>
                      <p className="text-xs text-green-400 mt-0.5">{t.description}</p>
                      {t.examples?.length > 0 && <p className="text-xs text-ink-faint">e.g. {t.examples.join(', ')}</p>}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink-muted mb-2">Recommended Tags</h3>
                <div className="space-y-2">
                  {assessment.taggingStrategyProposal.recommendedTags.map((t) => (
                    <div key={t.key} className="bg-blue-500/10 border border-blue-500/30 rounded p-2">
                      <code className="text-sm font-mono text-blue-400">{t.key}</code>
                      <p className="text-xs text-blue-400 mt-0.5">{t.description}</p>
                      {t.examples?.length > 0 && <p className="text-xs text-ink-faint">e.g. {t.examples.join(', ')}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {assessment.taggingStrategyProposal.tagMappings?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-ink-muted mb-2">Tag Mappings</h3>
                <div className="space-y-2">
                  {assessment.taggingStrategyProposal.tagMappings.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm bg-amber-500/10 border border-amber-500/30 rounded p-2">
                      <code className="text-amber-400">{m.from}</code>
                      <span>→</span>
                      <code className="text-green-400">{m.to}</code>
                      <span className="text-ink-faint text-xs">{m.rationale}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CollapsibleSection>
          </SectionGate>

          {/* Remediation plan */}
          <SectionGate featureKey="section.ai_assessment.remediation_plan">
          <CollapsibleSection title="Remediation Plan">
            <div className="space-y-4">
              {assessment.remediationPlan.map((phase) => (
                <div key={phase.phase} className="border-l-4 border-dd-purple pl-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="badge bg-dd-purple text-white">Phase {phase.phase}</span>
                    <h3 className="font-semibold text-ink">{phase.title}</h3>
                    <span className="text-xs text-ink-faint">({phase.timeframe})</span>
                  </div>
                  <ul className="text-sm text-ink-muted space-y-1 mb-2">
                    {phase.actions.map((a, i) => <li key={i}>• {a}</li>)}
                  </ul>
                  <p className="text-xs text-ink-faint">Expected outcome: {phase.expectedOutcome}</p>
                </div>
              ))}
            </div>
          </CollapsibleSection>
          </SectionGate>

          {/* Takeaways */}
          <SectionGate featureKey="section.ai_assessment.takeaways">
          <CollapsibleSection title="Health Check Takeaways">
            <ul className="space-y-2">
              {assessment.healthCheckTakeaways.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink-muted">
                  <span className="text-dd-purple font-bold">{i + 1}.</span>{t}
                </li>
              ))}
            </ul>
          </CollapsibleSection>
          </SectionGate>
        </div>
      )}
    </div>
  );
}

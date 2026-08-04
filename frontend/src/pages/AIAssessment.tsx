import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { aiApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import LoadingState, { EmptyState, ErrorState } from '../components/common/LoadingState';
import { CATEGORY_LABELS } from '../types';
import type { FindingCategory } from '../types';

export default function AIAssessment() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const [generating, setGenerating] = useState(false);

  const { data: assessment, isLoading, error, refetch } = useQuery({
    queryKey: ['ai-assessment', selectedOrgId, selectedScanId],
    queryFn: () => aiApi.get(selectedOrgId, selectedScanId),
    enabled: Boolean(selectedOrgId && selectedScanId),
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => aiApi.generate(selectedOrgId, selectedScanId),
    onSuccess: () => refetch(),
  });

  const hasNoAssessment = !assessment && !isLoading;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Assessment</h1>
          <p className="text-gray-500 text-sm mt-1">
            AI-generated health check analysis based on scan evidence
          </p>
        </div>
        {selectedScanId && (
          <button
            className="btn-primary"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? 'Generating...' : assessment ? 'Regenerate' : 'Generate Assessment'}
          </button>
        )}
      </div>

      {!selectedScanId ? (
        <EmptyState message="Run a scan first, then generate an AI assessment" />
      ) : isLoading ? (
        <LoadingState message="Loading assessment..." />
      ) : generate.isPending ? (
        <LoadingState message="AI is analyzing your Datadog environment. This may take 20-60 seconds..." />
      ) : generate.isError ? (
        <div className="card bg-red-50 border-red-200">
          <p className="text-red-700 text-sm">{(generate.error as Error)?.message}</p>
          {String(generate.error).includes('No AI provider') && (
            <p className="text-red-600 text-xs mt-2">
              Configure AI_PROVIDER=openai or AI_PROVIDER=anthropic in your backend .env file
            </p>
          )}
        </div>
      ) : !assessment ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">✨</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No AI assessment yet</h3>
          <p className="text-gray-500 mb-4 text-sm max-w-md mx-auto">
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
          <div className="card border-l-4 border-dd-purple">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Executive Summary</h2>
            <p className="text-gray-700 leading-relaxed">{assessment.executiveSummary}</p>
            <p className="text-xs text-gray-400 mt-3">
              Generated {new Date(assessment.generatedAt).toLocaleString()} · Based on {assessment.evidenceCount} findings
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Strengths */}
            <div className="card">
              <h2 className="text-base font-semibold text-green-700 mb-3">✓ Key Strengths</h2>
              <ul className="space-y-2">
                {assessment.keyStrengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-green-500 mt-0.5">•</span>{s}
                  </li>
                ))}
              </ul>
            </div>

            {/* Risks */}
            <div className="card">
              <h2 className="text-base font-semibold text-red-700 mb-3">⚠ Top Risks</h2>
              <ul className="space-y-2">
                {assessment.topRisks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-red-500 mt-0.5">•</span>{r}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Recommendations */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              Prioritized Recommendations ({assessment.prioritizedRecommendations.length})
            </h2>
            <div className="space-y-4">
              {assessment.prioritizedRecommendations.map((rec) => (
                <div key={rec.priority} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-7 h-7 bg-dd-purple text-white rounded-full flex items-center justify-center text-xs font-bold">
                      {rec.priority}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-gray-900">{rec.title}</h3>
                        <span className="badge bg-gray-100 text-gray-600">{CATEGORY_LABELS[rec.category as FindingCategory]}</span>
                        <span className={`badge ${rec.impact === 'high' ? 'bg-red-100 text-red-700' : rec.impact === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                          {rec.impact} impact
                        </span>
                        <span className={`badge ${rec.effort === 'low' ? 'bg-green-100 text-green-700' : rec.effort === 'medium' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {rec.effort} effort
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{rec.description}</p>
                      {rec.evidenceRefs?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {rec.evidenceRefs.map((ref, i) => (
                            <span key={i} className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
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
          </div>

          {/* Tagging strategy */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Recommended Tagging Strategy</h2>
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Required Tags</h3>
                <div className="space-y-2">
                  {assessment.taggingStrategyProposal.requiredTags.map((t) => (
                    <div key={t.key} className="bg-green-50 border border-green-200 rounded p-2">
                      <code className="text-sm font-mono text-green-800">{t.key}</code>
                      <p className="text-xs text-green-700 mt-0.5">{t.description}</p>
                      {t.examples?.length > 0 && <p className="text-xs text-gray-500">e.g. {t.examples.join(', ')}</p>}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Recommended Tags</h3>
                <div className="space-y-2">
                  {assessment.taggingStrategyProposal.recommendedTags.map((t) => (
                    <div key={t.key} className="bg-blue-50 border border-blue-200 rounded p-2">
                      <code className="text-sm font-mono text-blue-800">{t.key}</code>
                      <p className="text-xs text-blue-700 mt-0.5">{t.description}</p>
                      {t.examples?.length > 0 && <p className="text-xs text-gray-500">e.g. {t.examples.join(', ')}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {assessment.taggingStrategyProposal.tagMappings?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Tag Mappings</h3>
                <div className="space-y-2">
                  {assessment.taggingStrategyProposal.tagMappings.map((m, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm bg-amber-50 border border-amber-200 rounded p-2">
                      <code className="text-amber-800">{m.from}</code>
                      <span>→</span>
                      <code className="text-green-800">{m.to}</code>
                      <span className="text-gray-500 text-xs">{m.rationale}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Remediation plan */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Remediation Plan</h2>
            <div className="space-y-4">
              {assessment.remediationPlan.map((phase) => (
                <div key={phase.phase} className="border-l-4 border-dd-purple pl-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="badge bg-dd-purple text-white">Phase {phase.phase}</span>
                    <h3 className="font-semibold text-gray-900">{phase.title}</h3>
                    <span className="text-xs text-gray-500">({phase.timeframe})</span>
                  </div>
                  <ul className="text-sm text-gray-700 space-y-1 mb-2">
                    {phase.actions.map((a, i) => <li key={i}>• {a}</li>)}
                  </ul>
                  <p className="text-xs text-gray-500">Expected outcome: {phase.expectedOutcome}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Takeaways */}
          <div className="card bg-gray-50">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Health Check Takeaways</h2>
            <ul className="space-y-2">
              {assessment.healthCheckTakeaways.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="text-dd-purple font-bold">{i + 1}.</span>{t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

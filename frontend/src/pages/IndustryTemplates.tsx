import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { taggingApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import LoadingState, { EmptyState } from '../components/common/LoadingState';
import type { TemplateScore, TemplateSummary } from '../types';

function ScoreRing({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) {
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  const s = size === 'lg' ? 80 : size === 'md' ? 60 : 40;
  const r = s / 2 - 6;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={5} />
      <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        transform={`rotate(-90 ${s / 2} ${s / 2})`} />
      <text x={s / 2} y={s / 2 + 1} textAnchor="middle" dominantBaseline="middle"
        fontSize={size === 'lg' ? 16 : 12} fontWeight="bold" fill={color}>{score}</text>
    </svg>
  );
}

function TagRow({
  tagKey, description, why, how, when: when_, where, found, coverage, foundKey, exampleValues,
}: {
  tagKey: string; description: string; why?: string; how?: string; when?: string; where?: string;
  found: boolean; coverage: number; foundKey?: string | null; exampleValues?: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border rounded-lg ${found ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <button className="w-full text-left px-3 py-2.5 flex items-center gap-3" onClick={() => setOpen((o) => !o)}>
        <span className={`text-sm ${found ? 'text-green-600' : 'text-red-600'}`}>{found ? '✓' : '✗'}</span>
        <code className={`text-sm font-mono font-medium ${found ? 'text-green-800' : 'text-red-800'}`}>{tagKey}</code>
        {foundKey && foundKey !== tagKey && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">found as: {foundKey}</span>
        )}
        <span className="flex-1 text-xs text-gray-500 truncate">{description}</span>
        {found && (
          <span className={`text-xs font-medium shrink-0 ${coverage >= 80 ? 'text-green-700' : coverage >= 40 ? 'text-amber-700' : 'text-red-600'}`}>
            {coverage}%
          </span>
        )}
        {(why || how) && (
          <span className="text-gray-400 text-xs shrink-0">{open ? '▲' : '▼'}</span>
        )}
      </button>
      {open && (why || how) && (
        <div className="border-t border-gray-200 px-3 py-2 space-y-1.5 text-xs">
          {why && <p><span className="font-semibold text-violet-600 uppercase tracking-wide">Why: </span><span className="text-gray-600">{why}</span></p>}
          {how && <p><span className="font-semibold text-blue-600 uppercase tracking-wide">How: </span><span className="text-gray-600">{how}</span></p>}
          {when_ && <p><span className="font-semibold text-amber-600 uppercase tracking-wide">When: </span><span className="text-gray-600">{when_}</span></p>}
          {where && <p><span className="font-semibold text-green-600 uppercase tracking-wide">Where: </span><span className="text-gray-600">{where}</span></p>}
          {exampleValues && exampleValues.length > 0 && (
            <p>
              <span className="font-semibold text-gray-500 uppercase tracking-wide">Examples: </span>
              <span className="text-gray-600">{exampleValues.join(', ')}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function IndustryTemplates() {
  const { selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('generic');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'industry' | 'org'>('all');
  const enabled = Boolean(selectedOrgId && selectedScanId);

  const { data: templates = [] } = useQuery({
    queryKey: ['tagging-templates'],
    queryFn: () => taggingApi.templates(),
  });

  const { data: detected } = useQuery({
    queryKey: ['detect-template', selectedOrgId, selectedScanId],
    queryFn: () => taggingApi.detectTemplate(selectedOrgId, selectedScanId),
    enabled,
  });

  const { data: score, isLoading: scoreLoading } = useQuery({
    queryKey: ['tagging-score', selectedOrgId, selectedScanId, selectedTemplateId],
    queryFn: () => taggingApi.score(selectedOrgId, selectedScanId, selectedTemplateId),
    enabled: enabled && Boolean(selectedTemplateId),
  });

  const filtered = templates.filter((t) => categoryFilter === 'all' || t.category === categoryFilter);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Industry & Org Tagging Templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Select your industry or org model to score your tagging strategy and get a prioritized remediation plan.
          </p>
        </div>
      </div>

      {!selectedScanId ? <EmptyState message="Run a scan to score your tagging against industry templates" /> : (
        <div className="flex gap-6">
          {/* Template picker sidebar */}
          <div className="w-64 shrink-0 space-y-3">
            {detected?.recommended && detected.recommended !== selectedTemplateId && (
              <div className="card bg-violet-50 border-violet-200 p-3">
                <div className="text-xs font-semibold text-violet-700 mb-1">✨ Detected for your org</div>
                <button
                  className="text-sm font-medium text-violet-800 hover:underline"
                  onClick={() => setSelectedTemplateId(detected.recommended)}
                >
                  {templates.find((t) => t.id === detected.recommended)?.name ?? detected.recommended}
                </button>
                <div className="text-xs text-gray-500 mt-1">Based on tags in your scan</div>
              </div>
            )}

            <div className="flex gap-1">
              {(['all', 'industry', 'org'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  className={`flex-1 text-xs py-1 rounded capitalize font-medium transition-colors ${categoryFilter === c ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTemplateId(t.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedTemplateId === t.id ? 'bg-violet-600 text-white' : 'hover:bg-gray-100 text-gray-700'}`}
                >
                  <div className="flex items-center gap-2">
                    <span>{t.icon}</span>
                    <span className="font-medium truncate">{t.name}</span>
                  </div>
                  <div className={`text-xs mt-0.5 ${selectedTemplateId === t.id ? 'text-violet-200' : 'text-gray-400'}`}>
                    {t.requiredCount} required · {t.recommendedCount} recommended
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Score panel */}
          <div className="flex-1 space-y-6">
            {scoreLoading ? <LoadingState /> : !score ? (
              <div className="card text-center text-gray-400 py-12">Select a template to score your tagging</div>
            ) : (
              <>
                {/* Score summary */}
                <div className="card">
                  <div className="flex items-center gap-6">
                    <ScoreRing score={score.overallScore} size="lg" />
                    <div className="flex-1">
                      <h2 className="text-xl font-bold text-gray-900">{score.templateName}</h2>
                      <div className="flex gap-4 mt-2 text-sm">
                        <span>Baseline: <strong className={score.baselineScore >= 80 ? 'text-green-700' : 'text-red-600'}>{score.baselineScore}%</strong></span>
                        {score.complianceTags.length > 0 && (
                          <span>Compliance: <strong className={score.complianceScore >= 80 ? 'text-green-700' : 'text-red-600'}>{score.complianceScore}%</strong></span>
                        )}
                      </div>
                    </div>
                    {score.missingBaseline.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        <div className="text-xs font-semibold text-red-700 mb-1">Missing Baseline</div>
                        <div className="flex flex-wrap gap-1">
                          {score.missingBaseline.map((k) => (
                            <code key={k} className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{k}</code>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {score.quickWins.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Quick Wins — Highest Impact Missing Tags</div>
                      <div className="flex flex-wrap gap-2">
                        {score.quickWins.map((k) => (
                          <code key={k} className="text-sm bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1 rounded font-mono">{k}</code>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Global baseline (always required) */}
                <section>
                  <h3 className="text-base font-semibold text-gray-900 mb-2">
                    Global Baseline <span className="text-sm font-normal text-gray-500">(required in all templates)</span>
                  </h3>
                  <div className="space-y-2">
                    {score.globalBaseline.map((tag) => (
                      <TagRow key={tag.key} tagKey={tag.key} description={tag.description}
                        why={tag.why} how={tag.how} when={tag.when} where={tag.where}
                        found={tag.found} coverage={tag.coverage} foundKey={tag.foundKey}
                        exampleValues={tag.exampleValues} />
                    ))}
                  </div>
                </section>

                {/* Template-specific required */}
                {score.required.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-gray-900 mb-2">
                      Template Required <span className="text-sm font-normal text-gray-500">({score.templateName}-specific)</span>
                    </h3>
                    <div className="space-y-2">
                      {score.required.map((tag) => (
                        <TagRow key={tag.key} tagKey={tag.key} description={tag.description}
                          why={tag.why} how={tag.how} when={tag.when} where={tag.where}
                          found={tag.found} coverage={tag.coverage} foundKey={tag.foundKey}
                          exampleValues={tag.exampleValues} />
                      ))}
                    </div>
                  </section>
                )}

                {/* Recommended */}
                {score.recommended.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-gray-900 mb-2">Recommended</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {score.recommended.map((tag) => (
                        <div key={tag.key} className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm ${tag.found ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                          <span className={tag.found ? 'text-blue-600' : 'text-gray-400'}>{tag.found ? '✓' : '○'}</span>
                          <div className="flex-1 min-w-0">
                            <code className={`text-xs font-mono font-medium ${tag.found ? 'text-blue-800' : 'text-gray-600'}`}>{tag.key}</code>
                            <div className="text-xs text-gray-500 truncate">{tag.description}</div>
                          </div>
                          {tag.found && <span className="text-xs text-blue-700 shrink-0">{tag.coverage}%</span>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Compliance tags */}
                {score.complianceTags.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-gray-900 mb-2">Compliance Tags</h3>
                    <div className="space-y-2">
                      {score.complianceTags.map((tag) => (
                        <div key={tag.key} className={`flex items-start gap-3 p-3 rounded-lg border ${tag.found ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                          <span className={`text-sm mt-0.5 ${tag.found ? 'text-green-600' : 'text-red-600'}`}>{tag.found ? '✓' : '✗'}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <code className="text-sm font-mono font-medium">{tag.key}</code>
                              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{tag.standard}</span>
                            </div>
                            <p className="text-xs text-gray-600 mt-0.5">{tag.note}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

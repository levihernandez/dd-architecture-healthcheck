import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { taggingApi, tagTemplateApi } from '../../services/api';
import { PopoverRoot, PopoverTrigger, PopoverContent } from '../ui/Popover';

function scoreColor(pct: number): string {
  return pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
}

function TagChip({ tag }: { tag: { key: string; found: boolean; coverage?: number } }) {
  return (
    <span
      className={clsx(
        'text-xs px-1.5 py-0.5 rounded font-mono',
        tag.found ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
      )}
      title={tag.found ? `Detected — ${tag.coverage ?? 0}% coverage` : 'Not detected'}
    >
      {tag.found ? '✓' : '✗'} {tag.key}
    </span>
  );
}

/**
 * Global indicator of the org's active tagging template — visible on every
 * page (mounted in Header) so "which template is this org scored against" is
 * never a mystery. Opens a dropdown with the full tag breakdown and
 * compliance scoring; the template itself is set on the Industry Templates
 * page but consumed everywhere (Tag Explorer, Unified Tagging Scorecard).
 */
export default function TemplateBadge({ orgId, scanId }: { orgId: string; scanId: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: activeSelection } = useQuery({
    queryKey: ['tag-template', orgId],
    queryFn: () => tagTemplateApi.get(orgId),
    enabled: Boolean(orgId),
  });
  const templateId = activeSelection?.templateId ?? 'generic';

  const { data: score } = useQuery({
    queryKey: ['tagging-score', orgId, scanId, templateId],
    queryFn: () => taggingApi.score(orgId, scanId, templateId),
    enabled: Boolean(orgId && scanId),
  });

  if (!orgId) return null;

  function goToTemplates() {
    setOpen(false);
    navigate('/tag-templates');
  }

  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-1.5 text-xs border border-border-strong rounded px-2.5 py-1.5 hover:bg-surface-subtle transition-colors max-w-[220px]">
        <span className="shrink-0">🏷️</span>
        <span className="truncate text-ink font-medium">{score?.templateName ?? 'No template'}</span>
        {score && <span className={clsx('shrink-0 font-semibold', scoreColor(score.overallScore))}>{score.overallScore}%</span>}
        <span className="text-ink-faint text-xs shrink-0">▾</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0 max-h-[75vh] overflow-y-auto">
        {!score ? (
          <div className="p-4 text-sm text-ink-faint text-center">
            {scanId ? 'No scoring data for this scan yet.' : 'Run a scan to score tagging against a template.'}
            <button onClick={goToTemplates} className="block mx-auto mt-2 text-dd-purple hover:underline">
              Choose a template →
            </button>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-ink text-sm truncate">{score.templateName}</div>
                <div className="text-xs text-ink-faint">
                  {activeSelection?.templateId ? 'Active app-wide template' : 'Generic baseline — no template selected'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={clsx('text-2xl font-bold', scoreColor(score.overallScore))}>{score.overallScore}%</div>
                <div className="text-xs text-ink-faint">Overall</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-surface-subtle rounded p-2">
                <div className={clsx('text-sm font-semibold', scoreColor(score.baselineScore))}>{score.baselineScore}%</div>
                <div className="text-[10px] text-ink-faint uppercase tracking-wide">Baseline</div>
              </div>
              <div className="bg-surface-subtle rounded p-2">
                <div className="text-sm font-semibold text-blue-400">{score.cloudAutoScore}%</div>
                <div className="text-[10px] text-ink-faint uppercase tracking-wide">Cloud auto</div>
              </div>
              <div className="bg-surface-subtle rounded p-2">
                <div className={clsx('text-sm font-semibold', score.complianceTags.length > 0 ? scoreColor(score.complianceScore) : 'text-ink-faint')}>
                  {score.complianceTags.length > 0 ? `${score.complianceScore}%` : '—'}
                </div>
                <div className="text-[10px] text-ink-faint uppercase tracking-wide">Compliance</div>
              </div>
            </div>

            <TagBreakdownSection title="Global Baseline" tags={score.globalBaseline} />
            <TagBreakdownSection title={`${score.templateName} Required`} tags={score.required} />
            <TagBreakdownSection title="Recommended" tags={score.recommended} />
            <TagBreakdownSection title="Cloud Auto-Provided" tags={score.cloudAuto} />

            <button
              onClick={goToTemplates}
              className="w-full text-center text-xs text-dd-purple hover:text-dd-purple-dark hover:underline pt-2 border-t border-border"
            >
              {activeSelection?.templateId ? 'Change template →' : 'Set an active template →'}
            </button>
          </div>
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}

function TagBreakdownSection({ title, tags }: { title: string; tags: Array<{ key: string; found: boolean; coverage?: number }> }) {
  if (tags.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">{title}</div>
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => <TagChip key={t.key} tag={t} />)}
      </div>
    </div>
  );
}

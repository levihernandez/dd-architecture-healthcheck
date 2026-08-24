import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { taggingApi, tagTemplateApi } from '../services/api';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { ddBaseUrl } from '../utils/ddUrl';
import PageHeader from '../components/ui/PageHeader';
import { Skeleton, SkeletonText } from '../components/ui/Skeleton';
import FilterChip, { FilterChipRow } from '../components/ui/FilterChip';
import ResourceExamplesModal from '../components/tagging/ResourceExamplesModal';
import TaggingStrategyGuideModal from '../components/tagging/TaggingStrategyGuideModal';
import SectionGate from '../components/SectionGate';
import type { CloudAutoTagScore, TagPolicyLayer, IndustryTemplateDetail, TemplateScore, ResourceExample } from '../types';

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
  tagKey, description, why, how, when: when_, where, found, coverage, foundKey, exampleValues, platformGuides, resourceExamples,
}: {
  tagKey: string; description: string; why?: string; how?: string; when?: string; where?: string;
  /** Omit found/coverage entirely when there's no scan to score against yet — renders a neutral
   * "definition only" style instead of the green/red found/missing styling. */
  found?: boolean; coverage?: number; foundKey?: string | null; exampleValues?: string[];
  platformGuides?: Array<{ platform: string; method: string }>;
  resourceExamples?: ResourceExample[];
}) {
  const [open, setOpen] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const scored = found !== undefined;
  return (
    <div className={`border rounded-lg ${!scored ? 'border-border bg-surface-subtle' : found ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
      <button className="w-full text-left px-3 py-2.5 flex items-center gap-3" onClick={() => setOpen((o) => !o)}>
        <span className={`text-sm ${!scored ? 'text-ink-faint' : found ? 'text-green-400' : 'text-red-400'}`}>{!scored ? '•' : found ? '✓' : '✗'}</span>
        <code className={`text-sm font-mono font-medium ${!scored ? 'text-ink' : found ? 'text-green-400' : 'text-red-400'}`}>{tagKey}</code>
        {foundKey && foundKey !== tagKey && (
          <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">found as: {foundKey}</span>
        )}
        <span className="flex-1 text-xs text-ink-muted truncate">{description}</span>
        {scored && found && (
          <span className={`text-xs font-medium shrink-0 ${(coverage ?? 0) >= 80 ? 'text-green-400' : (coverage ?? 0) >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
            {coverage}%
          </span>
        )}
        <span
          role="button"
          tabIndex={0}
          title="View per-resource setup examples (RUM, Logs, APM, Agent, Integrations)"
          onClick={(e) => { e.stopPropagation(); setShowExamples(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setShowExamples(true); } }}
          className="text-xs text-violet-400 hover:text-violet-300 hover:underline shrink-0"
        >
          {'</>'}
        </span>
        {(why || how) && (
          <span className="text-ink-faint text-xs shrink-0">{open ? '▲' : '▼'}</span>
        )}
      </button>
      {open && (why || how) && (
        <div className="border-t border-border px-3 py-2 space-y-1.5 text-xs">
          {why && <p><span className="font-semibold text-violet-400 uppercase tracking-wide">Why: </span><span className="text-ink-muted">{why}</span></p>}
          {how && <p><span className="font-semibold text-blue-400 uppercase tracking-wide">How: </span><span className="text-ink-muted">{how}</span></p>}
          {when_ && <p><span className="font-semibold text-amber-400 uppercase tracking-wide">When: </span><span className="text-ink-muted">{when_}</span></p>}
          {where && <p><span className="font-semibold text-green-400 uppercase tracking-wide">Where: </span><span className="text-ink-muted">{where}</span></p>}
          {exampleValues && exampleValues.length > 0 && (
            <p>
              <span className="font-semibold text-ink-muted uppercase tracking-wide">Examples: </span>
              <span className="text-ink-muted">{exampleValues.join(', ')}</span>
            </p>
          )}
          {platformGuides && platformGuides.length > 0 && (
            <div>
              <span className="font-semibold text-ink-muted uppercase tracking-wide">Setup by platform: </span>
              <div className="mt-1 space-y-1">
                {platformGuides.map((g) => (
                  <div key={g.platform} className="flex gap-2">
                    <span className="shrink-0 w-32 font-medium text-ink">{g.platform}</span>
                    <span className="text-ink-muted">{g.method}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {showExamples && (
        <ResourceExamplesModal tagKey={tagKey} examples={resourceExamples} onClose={() => setShowExamples(false)} />
      )}
    </div>
  );
}

function CloudAutoRow({ tag }: { tag: CloudAutoTagScore }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border rounded-lg ${tag.found ? 'border-blue-500/30 bg-blue-500/10' : 'border-border bg-surface-subtle'}`}>
      <button className="w-full text-left px-3 py-2.5 flex items-center gap-3" onClick={() => setOpen((o) => !o)}>
        <span className={tag.found ? 'text-blue-400' : 'text-ink-faint'}>{tag.found ? '✓' : '○'}</span>
        <code className={`text-sm font-mono font-medium ${tag.found ? 'text-blue-400' : 'text-ink-muted'}`}>{tag.key}</code>
        <span className="text-[10px] uppercase tracking-wide bg-surface-sunken text-ink-faint px-1.5 py-0.5 rounded shrink-0">{tag.provider}</span>
        <span className="flex-1 text-xs text-ink-muted truncate">pairs with <code className="text-ink">{tag.pairsWith}</code></span>
        {tag.found && <span className="text-xs font-medium text-blue-400 shrink-0">{tag.coverage}%</span>}
        <span className="text-ink-faint text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 space-y-1.5 text-xs">
          <p><span className="font-semibold text-ink-muted uppercase tracking-wide">What: </span><span className="text-ink-muted">{tag.description}</span></p>
          <p><span className="font-semibold text-blue-400 uppercase tracking-wide">Reuse: </span><span className="text-ink-muted">{tag.reuseNote}</span></p>
          {tag.exampleValues && tag.exampleValues.length > 0 && (
            <p><span className="font-semibold text-ink-muted uppercase tracking-wide">Examples: </span><span className="text-ink-muted">{tag.exampleValues.join(', ')}</span></p>
          )}
        </div>
      )}
    </div>
  );
}

const CATCHES_AT_LABEL: Record<TagPolicyLayer['catchesAt'], string> = {
  design: 'Design time', build: 'Build time', deploy: 'Deploy time', runtime: 'Runtime',
};
const CATCHES_AT_COLOR: Record<TagPolicyLayer['catchesAt'], string> = {
  design: 'bg-violet-500/15 text-violet-400', build: 'bg-blue-500/15 text-blue-400',
  deploy: 'bg-amber-500/15 text-amber-400', runtime: 'bg-green-500/15 text-green-400',
};

function TagPolicyPanel({ orgBase }: { orgBase?: string }) {
  const { data: layers = [] } = useQuery({
    queryKey: ['tag-policy-guidance'],
    queryFn: () => taggingApi.policyGuidance(),
  });
  if (layers.length === 0) return null;
  return (
    <section>
      <h3 className="text-base font-semibold text-ink mb-1">Tag Policy Enforcement</h3>
      <p className="text-sm text-ink-muted mb-3">
        Where to enforce required tags, ordered from earliest (cheapest to fix) to latest (last resort catch).
        Only telemetry ingestion (Logs/Metrics/Traces/RUM/Event Feed) can be made truly mandatory — see the
        enforcement matrix below.
      </p>
      <div className="space-y-2">
        {layers.map((l) => (
          <div key={l.layer} className="card py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm text-ink">{l.layer}</span>
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${CATCHES_AT_COLOR[l.catchesAt]}`}>
                {CATCHES_AT_LABEL[l.catchesAt]}
              </span>
              <code className="text-xs text-ink-faint ml-auto">{l.where}</code>
              {l.orgSettingsPath && orgBase && (
                <a
                  href={`${orgBase}${l.orgSettingsPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-violet-400 hover:underline shrink-0"
                >
                  Open in your org ↗
                </a>
              )}
            </div>
            <p className="text-xs text-ink-muted">{l.mechanism}</p>
            <p className="text-xs text-green-400 mt-1.5"><span className="font-semibold">Outcome: </span>{l.outcome}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TagEnforcementTable({ orgBase }: { orgBase?: string }) {
  const { data: rows = [] } = useQuery({
    queryKey: ['tag-enforcement-matrix'],
    queryFn: () => taggingApi.tagEnforcement(),
  });
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 className="text-base font-semibold text-ink mb-1">Tag Enforcement Support by Resource</h3>
      <p className="text-sm text-ink-muted mb-3">
        Every resource below supports tags. Only telemetry ingestion can be made <strong>mandatory</strong> —
        everywhere else, tagging is advisory unless you add a product-specific layer above (Monitor Tag Policies,
        Synthetics Enforced Tags, etc.).
      </p>
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-subtle text-xs text-ink-muted uppercase tracking-wide">
              <th className="text-left px-4 py-2">Resource</th>
              <th className="text-left px-4 py-2">Tags Supported</th>
              <th className="text-left px-4 py-2">Mandatory Enforcement</th>
              <th className="text-left px-4 py-2">Configure</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.resource} className={r.mandatoryEnforcement ? 'bg-green-500/10' : undefined}>
                <td className="px-4 py-2 font-medium text-ink" title={r.notes ?? undefined}>{r.resource}</td>
                <td className="px-4 py-2 text-ink-muted">{r.tagsSupported}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${r.mandatoryEnforcement ? 'bg-green-500/15 text-green-400' : 'bg-surface-sunken text-ink-muted'}`}>
                    {r.mandatoryEnforcement ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    {r.orgSettingsPath && orgBase && (
                      <a
                        href={`${orgBase}${r.orgSettingsPath}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-violet-400 hover:text-violet-300 hover:underline shrink-0"
                      >
                        Open in your org ↗
                      </a>
                    )}
                    {r.docsUrl && (
                      <a
                        href={r.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300 hover:underline shrink-0"
                      >
                        Docs ↗
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const RESOURCE_TYPE_LABEL: Record<string, string> = { product: 'Product', docs: 'Docs', api: 'API' };
const RESOURCE_TYPE_COLOR: Record<string, string> = {
  product: 'bg-violet-500/15 text-violet-400', docs: 'bg-blue-500/15 text-blue-400', api: 'bg-amber-500/15 text-amber-400',
};

function PolicyResourcesPanel() {
  const { data: resources = [] } = useQuery({
    queryKey: ['tag-policy-resources'],
    queryFn: () => taggingApi.policyResources(),
  });
  if (resources.length === 0) return null;
  return (
    <div className="w-64 shrink-0 space-y-3">
      <div className="text-sm font-semibold text-ink">Reference Links</div>
      <p className="text-xs text-ink-muted">Product settings and docs for setting up tag policies in Datadog.</p>
      <div className="space-y-2">
        {resources.map((r) => (
          <a
            key={r.url}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block card py-2.5 hover:border-violet-500/30 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium shrink-0 ${RESOURCE_TYPE_COLOR[r.type]}`}>
                {RESOURCE_TYPE_LABEL[r.type]}
              </span>
              <span className="text-sm font-medium text-ink truncate">{r.title}</span>
            </div>
            <p className="text-xs text-ink-muted">{r.description}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Export ──────────────────────────────────────────────────────────────────

interface ExportTag {
  key: string; description: string; why?: string; how?: string; when?: string; where?: string;
  found?: boolean; coverage?: number;
}
interface ExportSections {
  globalBaseline: ExportTag[];
  required: ExportTag[];
  recommended: ExportTag[];
  optional: ExportTag[];
  complianceTags: Array<{ key: string; standard: string; note: string; found?: boolean }>;
}

// Merges the rich static definitions (why/how/where — always available, even
// pre-scan) with real found/coverage data from a score when one exists, so the
// export is as complete as possible whether or not a scan has been run yet.
function buildExportSections(templateDetail: IndustryTemplateDetail | undefined, score: TemplateScore | undefined): ExportSections | null {
  if (!templateDetail) return null;
  const scoreMap = new Map<string, { found: boolean; coverage?: number }>();
  if (score) {
    for (const t of [...score.globalBaseline, ...score.required]) scoreMap.set(t.key, { found: t.found, coverage: t.coverage });
    for (const t of [...score.recommended, ...score.optional]) {
      const coverage = 'coverage' in t ? (t as { coverage?: number }).coverage : undefined;
      scoreMap.set(t.key, { found: t.found, coverage });
    }
  }
  const withScore = (defs: IndustryTemplateDetail['globalBaseline']): ExportTag[] =>
    defs.map((d) => ({ ...d, ...scoreMap.get(d.key) }));
  const complianceScoreMap = new Map((score?.complianceTags ?? []).map((c) => [c.key, c.found]));
  return {
    globalBaseline: withScore(templateDetail.globalBaseline),
    required: withScore(templateDetail.required),
    recommended: withScore(templateDetail.recommended),
    optional: withScore(templateDetail.optional),
    complianceTags: (templateDetail.complianceTags ?? []).map((c) => ({ ...c, found: complianceScoreMap.get(c.key) })),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Builds a self-contained HTML document that Word opens as an editable .doc —
// no server round-trip, no docx library dependency. Plain semantic markup with
// inline styles only, since Word ignores Tailwind/utility classes.
function buildWordDoc(templateName: string, orgLabel: string | undefined, sections: ExportSections, scoreSummary?: { overall: number; baseline: number } ): string {
  const rowHtml = (t: ExportTag) => `
    <tr>
      <td style="padding:6px 8px;border:1px solid #ccc;font-family:monospace;">${escapeHtml(t.key)}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;">${escapeHtml(t.description)}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;">${t.found === undefined ? '—' : t.found ? '✓ Found' : '✗ Missing'}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;">${t.coverage != null ? t.coverage + '%' : '—'}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;">${t.why ? escapeHtml(t.why) : ''}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;">${t.how ? escapeHtml(t.how) : ''}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;">${t.where ? escapeHtml(t.where) : ''}</td>
    </tr>`;
  const sectionHtml = (title: string, tags: ExportTag[]) => tags.length === 0 ? '' : `
    <h2 style="font-family:sans-serif;color:#111;margin-top:28px;">${escapeHtml(title)}</h2>
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:12px;">
      <thead>
        <tr style="background:#f1f1f1;">
          <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Tag</th>
          <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Description</th>
          <th style="padding:6px 8px;border:1px solid #ccc;">Status</th>
          <th style="padding:6px 8px;border:1px solid #ccc;">Coverage</th>
          <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Why</th>
          <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">How</th>
          <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Where</th>
        </tr>
      </thead>
      <tbody>${tags.map(rowHtml).join('')}</tbody>
    </table>`;
  const complianceHtml = sections.complianceTags.length === 0 ? '' : `
    <h2 style="font-family:sans-serif;color:#111;margin-top:28px;">Compliance Tags</h2>
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:12px;">
      <thead>
        <tr style="background:#f1f1f1;">
          <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Tag</th>
          <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Standard</th>
          <th style="padding:6px 8px;border:1px solid #ccc;">Status</th>
          <th style="padding:6px 8px;border:1px solid #ccc;text-align:left;">Note</th>
        </tr>
      </thead>
      <tbody>
        ${sections.complianceTags.map((c) => `
        <tr>
          <td style="padding:6px 8px;border:1px solid #ccc;font-family:monospace;">${escapeHtml(c.key)}</td>
          <td style="padding:6px 8px;border:1px solid #ccc;">${escapeHtml(c.standard)}</td>
          <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;">${c.found === undefined ? '—' : c.found ? '✓ Found' : '✗ Missing'}</td>
          <td style="padding:6px 8px;border:1px solid #ccc;">${escapeHtml(c.note)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(templateName)} — Tagging Policy</title></head>
<body style="font-family:sans-serif;color:#111;">
  <h1 style="font-family:sans-serif;">${escapeHtml(templateName)} — Tagging Policy</h1>
  <p style="color:#555;">
    ${orgLabel ? escapeHtml(orgLabel) + ' · ' : ''}Generated ${new Date().toLocaleDateString()}
    ${scoreSummary ? ` · Overall score: ${scoreSummary.overall}% · Baseline: ${scoreSummary.baseline}%` : ' · Policy reference (no scan scored)'}
  </p>
  ${sectionHtml('Global Baseline (required in all templates)', sections.globalBaseline)}
  ${sectionHtml('Template Required', sections.required)}
  ${sectionHtml('Recommended', sections.recommended)}
  ${sectionHtml('Optional', sections.optional)}
  ${complianceHtml}
</body>
</html>`;
}

function downloadFile(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ExportModal({ templateName, orgLabel, sections, scoreSummary, onClose }: {
  templateName: string; orgLabel?: string; sections: ExportSections;
  scoreSummary?: { overall: number; baseline: number; compliance?: number };
  onClose: () => void;
}) {
  const allTagSections: Array<[string, ExportTag[]]> = [
    ['Global Baseline (required in all templates)', sections.globalBaseline],
    ['Template Required', sections.required],
    ['Recommended', sections.recommended],
    ['Optional', sections.optional],
  ];

  function handleWordExport() {
    const html = buildWordDoc(templateName, orgLabel, sections, scoreSummary ? { overall: scoreSummary.overall, baseline: scoreSummary.baseline } : undefined);
    downloadFile(`${templateName.replace(/[^\w-]+/g, '-')}-tagging-policy.doc`, 'application/msword', html);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6 print:p-0 print:bg-surface" onClick={onClose}>
      <div
        className="bg-surface-subtle rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto print:max-h-none print:shadow-none print:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4 print:hidden">
            <h2 className="text-lg font-bold text-ink">Export Tag Breakdown</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className="btn-secondary text-xs">🖨 Print / Export PDF</button>
              <button onClick={handleWordExport} className="btn-secondary text-xs">📄 Download Word (.doc)</button>
              <button onClick={onClose} className="btn-ghost text-xs">✕ Close</button>
            </div>
          </div>

          <div className="space-y-1 mb-6">
            <h1 className="text-xl font-bold text-ink">{templateName} — Tagging Policy</h1>
            <p className="text-xs text-ink-muted">
              {orgLabel && <>{orgLabel} · </>}Generated {new Date().toLocaleDateString()}
              {scoreSummary
                ? <> · Overall score: <strong>{scoreSummary.overall}%</strong> · Baseline: <strong>{scoreSummary.baseline}%</strong>{scoreSummary.compliance != null && <> · Compliance: <strong>{scoreSummary.compliance}%</strong></>}</>
                : <> · Policy reference (no scan scored yet)</>}
            </p>
          </div>

          {allTagSections.map(([title, tags]) => tags.length > 0 && (
            <section key={title} className="mb-6">
              <h3 className="text-sm font-semibold text-ink mb-2">{title}</h3>
              <div className="space-y-2">
                {tags.map((t) => (
                  <div key={t.key} className="border border-border rounded-lg p-3 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="font-mono font-semibold text-ink">{t.key}</code>
                      {t.found !== undefined && (
                        <span className={t.found ? 'text-green-400' : 'text-red-400'}>{t.found ? '✓ Found' : '✗ Missing'}</span>
                      )}
                      {t.coverage != null && <span className="text-ink-faint">({t.coverage}% coverage)</span>}
                      <span className="text-ink-muted ml-auto">{t.description}</span>
                    </div>
                    {t.why && <div className="text-ink-muted"><span className="font-semibold">Why:</span> {t.why}</div>}
                    {t.how && <div className="text-ink-muted"><span className="font-semibold">How:</span> {t.how}</div>}
                    {t.where && <div className="text-ink-muted"><span className="font-semibold">Where:</span> {t.where}</div>}
                  </div>
                ))}
              </div>
            </section>
          ))}

          {sections.complianceTags.length > 0 && (
            <section className="mb-2">
              <h3 className="text-sm font-semibold text-ink mb-2">Compliance Tags</h3>
              <div className="space-y-2">
                {sections.complianceTags.map((c) => (
                  <div key={c.key} className="border border-border rounded-lg p-3 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="font-mono font-semibold text-ink">{c.key}</code>
                      <span className="text-ink-faint">{c.standard}</span>
                      {c.found !== undefined && (
                        <span className={c.found ? 'text-green-400 ml-auto' : 'text-red-400 ml-auto'}>{c.found ? '✓ Found' : '✗ Missing'}</span>
                      )}
                    </div>
                    <div className="text-ink-muted">{c.note}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IndustryTemplates() {
  const { orgs, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const orgBase = orgs.find((o) => o.id === selectedOrgId)?.site ? ddBaseUrl(orgs.find((o) => o.id === selectedOrgId)!.site) : undefined;
  const qc = useQueryClient();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('generic');
  const [userPicked, setUserPicked] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'industry' | 'org'>('all');
  const [search, setSearch] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const guideParam = searchParams.get('guide');
  const initialGuideSection = guideParam === 'maturity' || guideParam === 'remediation' ? guideParam : undefined;
  const enabled = Boolean(selectedOrgId && selectedScanId);

  // Deep-link entry point: /tag-templates?guide=1|maturity|remediation opens
  // the Bits AI guide (search, onboarding) without requiring a manual click.
  useEffect(() => {
    if (guideParam) setShowGuide(true);
  }, [guideParam]);

  function closeGuide() {
    setShowGuide(false);
    if (guideParam) {
      searchParams.delete('guide');
      setSearchParams(searchParams, { replace: true });
    }
  }

  const { data: templates = [] } = useQuery({
    queryKey: ['tagging-templates'],
    queryFn: () => taggingApi.templates(),
  });

  // Static tag definitions for the selected template — available immediately, no
  // scan required, so the policy (required/recommended/optional/where-to-set-up)
  // is browsable the moment an org is connected, before any scan has run.
  const { data: templateDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['tagging-template-detail', selectedTemplateId],
    queryFn: () => taggingApi.templateDetail(selectedTemplateId),
    enabled: Boolean(selectedTemplateId),
  });

  const { data: detected } = useQuery({
    queryKey: ['detect-template', selectedOrgId, selectedScanId],
    queryFn: () => taggingApi.detectTemplate(selectedOrgId, selectedScanId),
    enabled,
  });

  const { data: activeSelection } = useQuery({
    queryKey: ['tag-template', selectedOrgId],
    queryFn: () => tagTemplateApi.get(selectedOrgId),
    enabled: Boolean(selectedOrgId),
  });

  // Default the view to the org's active template once known; fall back to the
  // detected suggestion, then the generic baseline. Never overrides a manual pick.
  useEffect(() => {
    if (userPicked) return;
    if (activeSelection?.templateId) setSelectedTemplateId(activeSelection.templateId);
    else if (detected?.recommended) setSelectedTemplateId(detected.recommended);
  }, [activeSelection, detected, userPicked]);

  const { data: score, isLoading: scoreLoading } = useQuery({
    queryKey: ['tagging-score', selectedOrgId, selectedScanId, selectedTemplateId],
    queryFn: () => taggingApi.score(selectedOrgId, selectedScanId, selectedTemplateId),
    enabled: enabled && Boolean(selectedTemplateId),
  });

  const setActiveTemplate = useMutation({
    mutationFn: (templateId: string) => tagTemplateApi.set(selectedOrgId, templateId),
    onSuccess: (_data, templateId) => {
      const name = templates.find((t) => t.id === templateId)?.name ?? templateId;
      toast.success(`${name} is now used across the app for this org`);
      qc.invalidateQueries({ queryKey: ['tag-template', selectedOrgId] });
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to set active template'),
  });

  function pickTemplate(id: string) {
    setUserPicked(true);
    setSelectedTemplateId(id);
  }

  const searchLower = search.trim().toLowerCase();
  const filtered = templates.filter((t) => {
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    if (!searchLower) return true;
    return (
      t.name.toLowerCase().includes(searchLower) ||
      (t.sector ?? '').toLowerCase().includes(searchLower) ||
      t.description.toLowerCase().includes(searchLower)
    );
  });
  const isActive = Boolean(activeSelection?.templateId && activeSelection.templateId === selectedTemplateId);
  const exportSections = buildExportSections(templateDetail, score);
  const orgLabel = orgs.find((o) => o.id === selectedOrgId)?.name;

  // Feed the currently selected template's own required tags into the tagging
  // guide so its examples reflect this org's actual policy, not generic filler.
  const guideTagDefs = (templateDetail?.required?.length ? templateDetail.required : templateDetail?.globalBaseline) ?? [];
  const guideIndustryTags = guideTagDefs.slice(0, 4).map((t) => ({
    key: t.key,
    description: t.description,
    example: t.exampleValues?.[0] ?? 'value',
  }));

  // Group the sidebar by sector so sub-verticals within one sector (e.g. Payments —
  // Banking, Restaurants, E-commerce, Card Networks) sit together instead of one flat
  // alphabetical list. Org-category templates get their own group, ungrouped by sector.
  const sectorGroups: Array<{ sector: string; items: typeof filtered }> = [];
  for (const t of filtered) {
    const sector = t.category === 'org' ? 'Org Model' : (t.sector ?? 'Other');
    let group = sectorGroups.find((g) => g.sector === sector);
    if (!group) { group = { sector, items: [] }; sectorGroups.push(group); }
    group.items.push(t);
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Industry & Org Tagging Templates"
        subtitle="Select your industry or org model to see the required/suggested tagging policy and where to enforce it, then use it across the app as the standard for Tag Explorer and the Unified Tagging Scorecard."
        actions={
          <button onClick={() => setShowGuide(true)} className="btn-secondary text-xs">
            📚 How tagging works (cloud + datacenter)
          </button>
        }
      />

      <div className="flex gap-6">
          {/* Template picker sidebar */}
          <SectionGate featureKey="section.industry_templates.picker">
          <div className="w-64 shrink-0 space-y-3">
            {activeSelection?.templateId && (
              <div className="card bg-green-500/10 border-green-500/30 p-3">
                <div className="text-xs font-semibold text-green-400 mb-1">✓ Active app-wide</div>
                <div className="text-sm font-medium text-green-900">
                  {templates.find((t) => t.id === activeSelection.templateId)?.name ?? activeSelection.templateId}
                </div>
                <div className="text-xs text-ink-muted mt-1">Used by Tag Explorer & Unified Tagging Scorecard</div>
              </div>
            )}

            {detected?.recommended && detected.recommended !== selectedTemplateId && detected.recommended !== activeSelection?.templateId && (
              <div className="card bg-violet-500/10 border-violet-500/30 p-3">
                <div className="text-xs font-semibold text-violet-400 mb-1">✨ Detected for your org</div>
                <button
                  className="text-sm font-medium text-violet-400 hover:underline"
                  onClick={() => pickTemplate(detected.recommended)}
                >
                  {templates.find((t) => t.id === detected.recommended)?.name ?? detected.recommended}
                </button>
                <div className="text-xs text-ink-muted mt-1">Based on tags in your scan</div>
              </div>
            )}

            <input
              type="text"
              placeholder="Search templates..."
              className="input w-full text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <FilterChipRow>
              {(['all', 'industry', 'org'] as const).map((c) => (
                <FilterChip
                  key={c}
                  label={c.charAt(0).toUpperCase() + c.slice(1)}
                  active={categoryFilter === c}
                  onClick={() => setCategoryFilter(c)}
                />
              ))}
            </FilterChipRow>

            {sectorGroups.length === 0 && (
              <div className="text-xs text-ink-faint px-1 py-4 text-center">No templates match "{search}"</div>
            )}

            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              {sectorGroups.map((group) => (
                <div key={group.sector}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint px-1 mb-1">{group.sector}</div>
                  <div className="space-y-1">
                    {group.items.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => pickTemplate(t.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedTemplateId === t.id ? 'bg-violet-600 text-white' : 'hover:bg-surface-sunken text-ink-muted'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span>{t.icon}</span>
                          <span className="font-medium truncate flex-1">{t.name}</span>
                          {activeSelection?.templateId === t.id && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${selectedTemplateId === t.id ? 'bg-surface-subtle/20 text-white' : 'bg-green-500/15 text-green-400'}`}>active</span>
                          )}
                        </div>
                        <div className={`text-xs mt-0.5 ${selectedTemplateId === t.id ? 'text-violet-200' : 'text-ink-faint'}`}>
                          {t.requiredCount} required · {t.recommendedCount} recommended
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          </SectionGate>

          {/* Score panel */}
          <SectionGate featureKey="section.industry_templates.score_panel">
          <div className="flex-1 space-y-6">
            {!enabled && !detailLoading && templateDetail ? (
              <>
                <div className="card bg-amber-500/10 border-amber-500/30 text-amber-400 text-sm flex items-center justify-between gap-3">
                  <span>No scan selected yet — showing the tagging policy for <strong>{templateDetail.name}</strong>. Connect a scan to see coverage against your org's actual tags.</span>
                  {exportSections && (
                    <SectionGate featureKey="section.industry_templates.export">
                      <button onClick={() => setShowExport(true)} className="btn-secondary text-xs shrink-0">⬇ Export</button>
                    </SectionGate>
                  )}
                </div>

                <section>
                  <h3 className="text-base font-semibold text-ink mb-2">
                    Global Baseline <span className="text-sm font-normal text-ink-muted">(required in all templates)</span>
                  </h3>
                  <div className="space-y-2">
                    {templateDetail.globalBaseline.map((tag) => (
                      <TagRow key={tag.key} tagKey={tag.key} description={tag.description}
                        why={tag.why} how={tag.how} when={tag.when} where={tag.where}
                        exampleValues={tag.exampleValues} platformGuides={tag.platformGuides} resourceExamples={tag.resourceExamples} />
                    ))}
                  </div>
                </section>

                {templateDetail.required.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-ink mb-2">
                      Template Required <span className="text-sm font-normal text-ink-muted">({templateDetail.name}-specific)</span>
                    </h3>
                    <div className="space-y-2">
                      {templateDetail.required.map((tag) => (
                        <TagRow key={tag.key} tagKey={tag.key} description={tag.description}
                          why={tag.why} how={tag.how} when={tag.when} where={tag.where}
                          exampleValues={tag.exampleValues} platformGuides={tag.platformGuides} resourceExamples={tag.resourceExamples} />
                      ))}
                    </div>
                  </section>
                )}

                {templateDetail.recommended.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-ink mb-2">Recommended</h3>
                    <div className="space-y-2">
                      {templateDetail.recommended.map((tag) => (
                        <TagRow key={tag.key} tagKey={tag.key} description={tag.description}
                          why={tag.why} how={tag.how} when={tag.when} where={tag.where}
                          exampleValues={tag.exampleValues} platformGuides={tag.platformGuides} resourceExamples={tag.resourceExamples} />
                      ))}
                    </div>
                  </section>
                )}

                {templateDetail.optional.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-ink mb-2">Optional</h3>
                    <div className="space-y-2">
                      {templateDetail.optional.map((tag) => (
                        <TagRow key={tag.key} tagKey={tag.key} description={tag.description}
                          why={tag.why} how={tag.how} when={tag.when} where={tag.where}
                          exampleValues={tag.exampleValues} platformGuides={tag.platformGuides} resourceExamples={tag.resourceExamples} />
                      ))}
                    </div>
                  </section>
                )}

                {templateDetail.complianceTags && templateDetail.complianceTags.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-ink mb-2">Compliance Tags</h3>
                    <div className="space-y-2">
                      {templateDetail.complianceTags.map((tag) => (
                        <div key={tag.key} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface-subtle">
                          <div>
                            <div className="flex items-center gap-2">
                              <code className="text-sm font-mono font-medium">{tag.key}</code>
                              <span className="text-xs bg-surface-sunken text-ink-muted px-1.5 py-0.5 rounded">{tag.standard}</span>
                            </div>
                            <p className="text-xs text-ink-muted mt-0.5">{tag.note}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <TagPolicyPanel orgBase={orgBase} />
                <TagEnforcementTable orgBase={orgBase} />
              </>
            ) : scoreLoading ? (
              <div className="card space-y-4">
                <div className="flex items-center gap-6">
                  <Skeleton className="h-20 w-20 rounded-full" />
                  <SkeletonText lines={3} className="flex-1" />
                </div>
              </div>
            ) : !score ? (
              <div className="card text-center text-ink-faint py-12">Select a template to score your tagging</div>
            ) : (
              <>
                {/* Score summary */}
                <div className="card">
                  <div className="flex items-center gap-6">
                    <ScoreRing score={score.overallScore} size="lg" />
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-ink">{score.templateName}</h2>
                        {isActive ? (
                          <span className="text-xs font-medium bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full">✓ Active app-wide</span>
                        ) : (
                          <button
                            className="btn-secondary text-xs"
                            disabled={setActiveTemplate.isPending}
                            onClick={() => setActiveTemplate.mutate(selectedTemplateId)}
                          >
                            {setActiveTemplate.isPending ? 'Setting…' : 'Use this template app-wide'}
                          </button>
                        )}
                        {exportSections && (
                          <SectionGate featureKey="section.industry_templates.export">
                            <button onClick={() => setShowExport(true)} className="btn-secondary text-xs ml-auto">⬇ Export</button>
                          </SectionGate>
                        )}
                      </div>
                      <div className="flex gap-4 mt-2 text-sm">
                        <span>Baseline: <strong className={score.baselineScore >= 80 ? 'text-green-400' : 'text-red-400'}>{score.baselineScore}%</strong></span>
                        <span>Cloud auto-provided: <strong className={score.cloudAutoScore >= 80 ? 'text-blue-400' : 'text-ink-muted'}>{score.cloudAutoScore}%</strong></span>
                        {score.complianceTags.length > 0 && (
                          <span>Compliance: <strong className={score.complianceScore >= 80 ? 'text-green-400' : 'text-red-400'}>{score.complianceScore}%</strong></span>
                        )}
                      </div>
                    </div>
                    {score.missingBaseline.length > 0 && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                        <div className="text-xs font-semibold text-red-400 mb-1">Missing Baseline</div>
                        <div className="flex flex-wrap gap-1">
                          {score.missingBaseline.map((k) => (
                            <code key={k} className="text-xs bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded">{k}</code>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {score.quickWins.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Quick Wins — Highest Impact Missing Tags</div>
                      <div className="flex flex-wrap gap-2">
                        {score.quickWins.map((k) => (
                          <code key={k} className="text-sm bg-amber-500/10 border border-amber-500/30 text-amber-400 px-2 py-1 rounded font-mono">{k}</code>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Global baseline (always required) */}
                <section>
                  <h3 className="text-base font-semibold text-ink mb-2">
                    Global Baseline <span className="text-sm font-normal text-ink-muted">(required in all templates)</span>
                  </h3>
                  <div className="space-y-2">
                    {score.globalBaseline.map((tag) => (
                      <TagRow key={tag.key} tagKey={tag.key} description={tag.description}
                        why={tag.why} how={tag.how} when={tag.when} where={tag.where}
                        found={tag.found} coverage={tag.coverage} foundKey={tag.foundKey}
                        exampleValues={tag.exampleValues} platformGuides={tag.platformGuides} resourceExamples={tag.resourceExamples} />
                    ))}
                  </div>
                </section>

                {/* Template-specific required */}
                {score.required.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-ink mb-2">
                      Template Required <span className="text-sm font-normal text-ink-muted">({score.templateName}-specific)</span>
                    </h3>
                    <div className="space-y-2">
                      {score.required.map((tag) => (
                        <TagRow key={tag.key} tagKey={tag.key} description={tag.description}
                          why={tag.why} how={tag.how} when={tag.when} where={tag.where}
                          found={tag.found} coverage={tag.coverage} foundKey={tag.foundKey}
                          exampleValues={tag.exampleValues} resourceExamples={tag.resourceExamples} />
                      ))}
                    </div>
                  </section>
                )}

                {/* Cloud auto-provided tags */}
                {score.cloudAuto.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-ink mb-1">
                      Cloud Auto-Provided Tags <span className="text-sm font-normal text-ink-muted">(free — pair with, don't duplicate)</span>
                    </h3>
                    <p className="text-sm text-ink-muted mb-2">
                      Already injected by your cloud provider, Kubernetes, or the Agent — no manual tagging needed.
                      Reuse these instead of adding a redundant custom tag for the same intent.
                    </p>
                    <div className="space-y-2">
                      {score.cloudAuto.map((tag) => <CloudAutoRow key={tag.key} tag={tag} />)}
                    </div>
                  </section>
                )}

                {/* Recommended */}
                {score.recommended.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-ink mb-2">Recommended</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {score.recommended.map((tag) => (
                        <div key={tag.key} className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm ${tag.found ? 'border-blue-500/30 bg-blue-500/10' : 'border-border bg-surface-subtle'}`}>
                          <span className={tag.found ? 'text-blue-400' : 'text-ink-faint'}>{tag.found ? '✓' : '○'}</span>
                          <div className="flex-1 min-w-0">
                            <code className={`text-xs font-mono font-medium ${tag.found ? 'text-blue-400' : 'text-ink-muted'}`}>{tag.key}</code>
                            <div className="text-xs text-ink-muted truncate">{tag.description}</div>
                          </div>
                          {tag.found && <span className="text-xs text-blue-400 shrink-0">{tag.coverage}%</span>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Optional */}
                {score.optional.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-ink mb-2">Optional</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {score.optional.map((tag) => (
                        <div key={tag.key} className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm ${tag.found ? 'border-blue-500/30 bg-blue-500/10' : 'border-border bg-surface-subtle'}`}>
                          <span className={tag.found ? 'text-blue-400' : 'text-ink-faint'}>{tag.found ? '✓' : '○'}</span>
                          <div className="flex-1 min-w-0">
                            <code className={`text-xs font-mono font-medium ${tag.found ? 'text-blue-400' : 'text-ink-muted'}`}>{tag.key}</code>
                            <div className="text-xs text-ink-muted truncate">{tag.description}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Compliance tags */}
                {score.complianceTags.length > 0 && (
                  <section>
                    <h3 className="text-base font-semibold text-ink mb-2">Compliance Tags</h3>
                    <div className="space-y-2">
                      {score.complianceTags.map((tag) => (
                        <div key={tag.key} className={`flex items-start gap-3 p-3 rounded-lg border ${tag.found ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
                          <span className={`text-sm mt-0.5 ${tag.found ? 'text-green-400' : 'text-red-400'}`}>{tag.found ? '✓' : '✗'}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <code className="text-sm font-mono font-medium">{tag.key}</code>
                              <span className="text-xs bg-surface-sunken text-ink-muted px-1.5 py-0.5 rounded">{tag.standard}</span>
                            </div>
                            <p className="text-xs text-ink-muted mt-0.5">{tag.note}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <TagPolicyPanel orgBase={orgBase} />
                <TagEnforcementTable orgBase={orgBase} />
              </>
            )}
          </div>
          </SectionGate>

          <PolicyResourcesPanel />
      </div>

      {showGuide && (
        <TaggingStrategyGuideModal
          onClose={closeGuide}
          industryName={templateDetail?.name}
          industryTags={guideIndustryTags}
          initialSection={initialGuideSection}
        />
      )}

      {showExport && exportSections && (
        <SectionGate featureKey="section.industry_templates.export">
          <ExportModal
            templateName={templateDetail?.name ?? score?.templateName ?? selectedTemplateId}
            orgLabel={orgLabel}
            sections={exportSections}
            scoreSummary={score ? { overall: score.overallScore, baseline: score.baselineScore, compliance: score.complianceTags.length > 0 ? score.complianceScore : undefined } : undefined}
            onClose={() => setShowExport(false)}
          />
        </SectionGate>
      )}
    </div>
  );
}

// Generates a Bits AI-ready UST maturity-assessment prompt for an org, with the
// industry and suggested tags auto-filled from this app's existing industry
// template system (templates.ts) instead of asking the user to type them in.

import { getDatabase } from '../db/database';
import { getPrompt } from '../ai/prompt-store';
import { INDUSTRY_TEMPLATES, ORG_TEMPLATES, detectRecommendedTemplate, type IndustryTemplate, type TemplateTag } from './templates';

export interface MaturityAssessmentRequest {
  orgId: string;
  /** Optional — when omitted, falls back to the org's latest completed scan, if any. */
  scanRunId?: string;
}

export interface MaturityAssessmentResult {
  industry: string;
  templateId: string;
  suggestedTagKeys: string[];
  hasScanData: boolean;
  promptText: string;
}

const ALL_TEMPLATES = [...INDUSTRY_TEMPLATES, ...ORG_TEMPLATES];
const SUGGESTED_TAGS_CAP = 12;

async function resolveTemplate(orgId: string, scanRunId: string | undefined): Promise<IndustryTemplate> {
  const db = getDatabase();
  const selection = await db<{ org_id: string; template_id: string }>('org_tag_template')
    .select('template_id')
    .where({ org_id: orgId })
    .first();

  const templateId = selection?.template_id
    ?? (scanRunId ? await detectRecommendedTemplate(orgId, scanRunId) : 'generic');

  return ALL_TEMPLATES.find((t) => t.id === templateId)
    ?? ALL_TEMPLATES.find((t) => t.id === 'generic')!;
}

// Whether this app has anything collected for the org at all — distinct from
// "a scanRunId was passed," since a stale/invalid id would otherwise silently
// report false confidence. Mirrors the completed-scan lookup + resource count
// pattern already used by buildChatContext (chat/context-builder.ts).
async function resolveScanStatus(orgId: string, scanRunId: string | undefined): Promise<{ hasScanData: boolean; hostCount: number; serviceCount: number }> {
  const db = getDatabase();
  const scan = scanRunId
    ? await db<{ id: string; org_id: string; status: string }>('scan_runs').select('id').where({ id: scanRunId, org_id: orgId, status: 'completed' }).first()
    : await db<{ id: string; org_id: string; status: string }>('scan_runs').select('id').where({ org_id: orgId, status: 'completed' }).orderBy('completed_at', 'desc').first();

  if (!scan) return { hasScanData: false, hostCount: 0, serviceCount: 0 };

  const count = async (table: string) => {
    const row = await db(table)
      .count({ c: '*' })
      .where({ org_id: orgId, scan_run_id: scan.id })
      .first() as { c: number | string } | undefined;
    return Number(row?.c ?? 0);
  };

  const hostCount = await count('hosts');
  const serviceCount = await count('services');
  return { hasScanData: hostCount > 0 || serviceCount > 0, hostCount, serviceCount };
}

function formatSuggestedTags(template: IndustryTemplate): { markdown: string; keys: string[] } {
  const tags: TemplateTag[] = [...template.required, ...template.recommended].slice(0, SUGGESTED_TAGS_CAP);
  if (tags.length === 0) {
    return { markdown: '     - (no industry-specific tags defined for this template — rely on the core UST tags above)', keys: [] };
  }
  const markdown = tags.map((t) => `     - \`${t.key}\` — ${t.description} (${t.why})`).join('\n');
  return { markdown, keys: tags.map((t) => t.key) };
}

// The user's prompt asks the agent to inspect live Datadog products directly
// (Infrastructure, APM, Kubernetes, logs, synthetics, RUM, serverless,
// databases, cloud) — this app's own read-only scan is, at best, a partial
// cross-check, never a substitute. When this app has nothing collected for
// the org, say so explicitly rather than leaving the agent to assume this
// app's data (which doesn't exist) backs the assessment.
function buildScanStatusNote(hasScanData: boolean, hostCount: number, serviceCount: number): string {
  if (!hasScanData) {
    return "_No completed Architecture Health Check scan is available for this org in this app yet — this assessment must be performed using your own direct access to the Datadog organization's resources, not data from this app. If you lack direct access to inspect a product listed below, explicitly call it out as a visibility gap in your results rather than assuming compliance._";
  }
  return `_This app has a completed Architecture Health Check scan for this org (${hostCount} hosts, ${serviceCount} services collected) that you may cross-reference, but base your assessment on your own direct inspection of the live Datadog organization, not solely on this snapshot._`;
}

export async function buildMaturityAssessmentPrompt(req: MaturityAssessmentRequest): Promise<MaturityAssessmentResult> {
  const { orgId, scanRunId } = req;
  const template = await resolveTemplate(orgId, scanRunId);
  const { hasScanData, hostCount, serviceCount } = await resolveScanStatus(orgId, scanRunId);
  const { markdown: suggestedTagsMarkdown, keys: suggestedTagKeys } = formatSuggestedTags(template);
  const industry = template.sector || template.name;

  const promptText = getPrompt('tagging-maturity-assessment')
    .replace('{{INDUSTRY}}', () => industry)
    .replace('{{SCAN_STATUS_NOTE}}', () => buildScanStatusNote(hasScanData, hostCount, serviceCount))
    .replace('{{SUGGESTED_TAGS}}', () => suggestedTagsMarkdown)
    .replace('{{GENERATED_AT}}', new Date().toISOString());

  return { industry, templateId: template.id, suggestedTagKeys, hasScanData, promptText };
}

export interface RemediationExecutionResult {
  industry: string;
  templateId: string;
  suggestedTagKeys: string[];
  hasScanData: boolean;
  promptText: string;
}

/** Companion to buildMaturityAssessmentPrompt: instead of asking Bits AI to only
 * score/report, this prompt asks it to actually apply the tag fixes through the
 * Datadog UI (bulk tag editor, per-resource tag editors) and report what changed. */
export async function buildRemediationExecutionPrompt(req: MaturityAssessmentRequest): Promise<RemediationExecutionResult> {
  const { orgId, scanRunId } = req;
  const template = await resolveTemplate(orgId, scanRunId);
  const { hasScanData, hostCount, serviceCount } = await resolveScanStatus(orgId, scanRunId);
  const { markdown: suggestedTagsMarkdown, keys: suggestedTagKeys } = formatSuggestedTags(template);
  const industry = template.sector || template.name;

  const promptText = getPrompt('tagging-remediation-execution')
    .replace(/\{\{INDUSTRY\}\}/g, () => industry)
    .replace('{{SCAN_STATUS_NOTE}}', () => buildScanStatusNote(hasScanData, hostCount, serviceCount))
    .replace('{{SUGGESTED_TAGS}}', () => suggestedTagsMarkdown)
    .replace('{{GENERATED_AT}}', new Date().toISOString());

  return { industry, templateId: template.id, suggestedTagKeys, hasScanData, promptText };
}

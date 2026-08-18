// Turns real unified-tagging gaps (Finding[]) into a mechanism-aware prompt the
// user can hand to Bits AI, split into hard tagging (Terraform / Ansible / SCOM /
// Fleet Automation) vs soft tagging (Datadog UI/API). Reuses the existing rules
// engine's findings and host-enrichment's cloud-provider parsing rather than
// re-deriving gap data.

import { FindingRepository } from '../db/repositories/finding.repository';
import { getDatabase } from '../db/database';
import { parseHostRawJson } from '../assessment/host-enrichment';
import { getPrompt } from '../ai/prompt-store';
import { recommendationForTagKey } from './recommendation';
import type { Finding, AffectedResource } from '../types/assessment.types';
import { TAG_POLICY_GUIDANCE, type TagPolicyLayer } from './templates';

// FindingRepository doesn't persist Finding.tagKey/bestPractice (not columns on
// the findings table), so they're always undefined on a row fetched back out of
// the DB. Re-derive tagKey from the (stable, hardcoded) rule id instead of
// trusting the fetched Finding, and re-look-up bestPractice from the tag
// dictionary rather than relying on the lost field.
const RULE_TAG_KEY: Record<string, string> = {
  'ust-001': 'env',
  'ust-003': 'version',
  'ust-004': 'service',
  'ust-005': 'service',
  'ust-006': 'team',
  'ust-007': 'application',
  'ust-008': 'tier',
};

export type TaggingMode = 'hard' | 'soft';
export type HardMechanism = 'terraform' | 'ansible' | 'scom' | 'fleet_automation';

export interface ImplementationGuideRequest {
  orgId: string;
  scanRunId: string;
  mode: TaggingMode;
  mechanism?: HardMechanism;
}

interface EnrichedResource {
  type: string;
  id: string;
  name: string;
  /** Cloud/infra origin from host-enrichment's parseHostRawJson; null for non-host resource types. */
  cloudProvider: string | null;
}

interface GapSummaryEntry {
  tagKey: string;
  ruleId: string;
  title: string;
  affectedCount: number;
  totalCount: number;
  percentage: number;
  bestPracticeHow: string;
  sampleResources: EnrichedResource[];
}

export interface ImplementationGuideResult {
  mode: TaggingMode;
  mechanism?: HardMechanism;
  gaps: GapSummaryEntry[];
  mechanismWarning: string | null;
  promptText: string;
  staticReference: TagPolicyLayer[];
}

const MECHANISM_LABELS: Record<HardMechanism, string> = {
  terraform: 'Terraform',
  ansible: 'Ansible',
  scom: 'Microsoft SCOM (System Center Configuration Manager)',
  fleet_automation: 'Datadog Fleet Automation',
};

// Which cloud/infra origins (from host-enrichment's parseHostRawJson) a mechanism
// realistically manages. Non-host resources (monitors, services, synthetics tests)
// aren't tied to a provisioning origin, so they're always treated as fair game.
const MECHANISM_FIT: Record<HardMechanism, string[]> = {
  terraform: ['aws', 'gcp', 'azure', 'kubernetes'],
  ansible: ['on-prem/unknown', 'aws', 'gcp', 'azure'],
  scom: ['on-prem/unknown'],
  fleet_automation: ['aws', 'gcp', 'azure', 'kubernetes', 'docker', 'on-prem/unknown'],
};

const MECHANISM_INSTRUCTIONS: Record<HardMechanism, string> = {
  terraform: "Add the missing tags as required, non-default variables on the relevant Terraform resource/module (e.g. `datadog_monitor.tags`, or the cloud provider resource's `tags`/`labels` block). Prefer failing `terraform plan` over defaulting the value, so drift is caught before apply.",
  ansible: "Add the missing tags via an Ansible role/playbook task that sets them through the Datadog Agent configuration (`datadog-agent.yaml` `tags:` list or `DD_TAGS` env var), then re-run the play against the affected hosts.",
  scom: "Add the missing tags as SCOM custom properties, or via a management pack that maps SCOM object properties to the Datadog Agent's `tags:`/`DD_TAGS` configuration on each managed Windows host, then trigger a configuration refresh.",
  fleet_automation: "Use Fleet Automation's remote configuration to push an updated Agent config (`tags:` list) to the affected hosts in bulk, without touching each host manually or waiting for a redeploy.",
};

// layer names in TAG_POLICY_GUIDANCE (templates.ts) relevant to each hard mechanism.
const HARD_MECHANISM_LAYERS: Record<HardMechanism, string[]> = {
  terraform: ['Infrastructure as Code', 'CI/CD pipeline gate', 'Cloud provider tag policies'],
  ansible: ['Configuration Management (Ansible / Puppet / Chef)'],
  scom: ['On-Prem Fleet Management (SCOM)'],
  fleet_automation: ['Datadog Fleet Automation', 'Kubernetes Admission Controller'],
};

function enrichResources(orgId: string, scanRunId: string, resources: AffectedResource[]): EnrichedResource[] {
  const db = getDatabase();
  return resources.map((r) => {
    if (r.type !== 'host') return { type: r.type, id: r.id, name: r.name, cloudProvider: null };
    const row = db.prepare(
      'SELECT raw_json FROM hosts WHERE org_id = ? AND scan_run_id = ? AND host_name = ?'
    ).get(orgId, scanRunId, r.id) as { raw_json: string | null } | undefined;
    const meta = parseHostRawJson(row?.raw_json ?? null);
    return { type: r.type, id: r.id, name: r.name, cloudProvider: meta.cloudProvider };
  });
}

const SAMPLE_CAP = 5;

function buildGapSummary(orgId: string, scanRunId: string, findings: Finding[]): GapSummaryEntry[] {
  return findings.map((f) => {
    const tagKey = f.tagKey ?? RULE_TAG_KEY[f.ruleId] ?? 'unknown';
    return {
      tagKey,
      ruleId: f.ruleId,
      title: f.title,
      affectedCount: f.affectedCount,
      totalCount: f.totalCount,
      percentage: f.percentage,
      bestPracticeHow: f.bestPractice?.how || recommendationForTagKey(tagKey).how || f.recommendation,
      sampleResources: enrichResources(orgId, scanRunId, f.affectedResources.slice(0, SAMPLE_CAP)),
    };
  });
}

function computeMechanismWarning(mechanism: HardMechanism | undefined, gaps: GapSummaryEntry[]): string | null {
  if (!mechanism) return null;
  const hostSamples = gaps.flatMap((g) => g.sampleResources.filter((r) => r.type === 'host' && r.cloudProvider));
  if (hostSamples.length === 0) return null;

  const fit = MECHANISM_FIT[mechanism];
  const mismatched = hostSamples.filter((r) => !fit.includes(r.cloudProvider as string));
  if (mismatched.length / hostSamples.length > 0.5) {
    const origins = [...new Set(mismatched.map((r) => r.cloudProvider))].join(', ');
    return `Most of the affected hosts in this scan actually originate from ${origins}, not a source ${MECHANISM_LABELS[mechanism]} typically manages — double-check ${MECHANISM_LABELS[mechanism]} is the right mechanism for these hosts before applying this prompt.`;
  }
  return null;
}

function formatGapsMarkdown(gaps: GapSummaryEntry[]): string {
  if (gaps.length === 0) {
    return '_No tagging gaps found in this scan — coverage already meets best-practice thresholds._';
  }
  return gaps.map((g) => {
    const samples = g.sampleResources
      .map((r) => `  - ${r.type} \`${r.name}\`${r.cloudProvider ? ` (${r.cloudProvider})` : ''}`)
      .join('\n');
    return `### Missing \`${g.tagKey}\` tag — ${g.affectedCount}/${g.totalCount} resources (${g.percentage}% covered)\n${g.title}\n\n**How to fix:** ${g.bestPracticeHow}\n\n**Example affected resources:**\n${samples}`;
  }).join('\n\n');
}

export function buildImplementationGuide(req: ImplementationGuideRequest): ImplementationGuideResult {
  const { orgId, scanRunId, mode, mechanism } = req;
  const allFindings = FindingRepository.findByScan(scanRunId, orgId);
  const taggingFindings = allFindings.filter((f) => f.ruleId.startsWith('ust-'));

  const gaps = buildGapSummary(orgId, scanRunId, taggingFindings);
  const gapsMarkdown = formatGapsMarkdown(gaps);
  const mechanismWarning = mode === 'hard' ? computeMechanismWarning(mechanism, gaps) : null;

  const promptTemplate = mode === 'hard' ? getPrompt('tagging-impl-hard') : getPrompt('tagging-impl-soft');
  const mechanismLabel = mode === 'hard' && mechanism ? MECHANISM_LABELS[mechanism] : '';
  const mechanismInstructions = mode === 'hard' && mechanism ? MECHANISM_INSTRUCTIONS[mechanism] : '';

  const promptText = promptTemplate
    .replace('{{MECHANISM_LABEL}}', () => mechanismLabel)
    .replace('{{MECHANISM_INSTRUCTIONS}}', () => mechanismInstructions)
    .replace('{{GAP_SUMMARY}}', () => gapsMarkdown)
    .replace('{{GENERATED_AT}}', new Date().toISOString());

  const staticReference = mode === 'hard'
    ? TAG_POLICY_GUIDANCE.filter((l) => !mechanism || HARD_MECHANISM_LAYERS[mechanism].includes(l.layer))
    : TAG_POLICY_GUIDANCE.filter((l) => l.catchesAt === 'runtime');

  return { mode, mechanism, gaps, mechanismWarning, promptText, staticReference };
}

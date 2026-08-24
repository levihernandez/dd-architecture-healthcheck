import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { getDatabase } from '../db/database';
import { ScorecardRepository } from '../db/repositories/scorecard.repository';
import { FindingRepository } from '../db/repositories/finding.repository';
import { buildAssessmentPrompt } from './prompts';
import { runOpenAIAssessment } from './providers/openai.provider';
import { runAnthropicAssessment } from './providers/anthropic.provider';
import { runOllamaAssessment } from './providers/ollama.provider';
import { getAIConfig } from './config';
import { validateAssessment } from './validate-assessment';
import { logger } from '../utils/logger';
import type {
  AIAssessmentRequest, AIAssessmentResponse,
  InventorySummary, TagAnalysis, FindingSummary, FindingCategory
} from '../types/assessment.types';

export async function generateAIAssessment(
  orgId: string,
  scanRunId: string
): Promise<AIAssessmentResponse> {
  const config = await getAIConfig();
  const provider = config.provider;

  if (provider === 'none') {
    throw new Error('No AI provider configured. Go to AI Settings in the UI to set up a provider.');
  }

  const db = getDatabase();

  const scorecard = await ScorecardRepository.findByScan(orgId, scanRunId);
  if (!scorecard) throw new Error('No scorecard found. Run a scan first.');

  const findings = await FindingRepository.findByScan(scanRunId, orgId);

  const inventorySummary = await buildInventorySummary(orgId, scanRunId, db);
  const tagAnalysis = await buildTagAnalysis(orgId, scanRunId, db);
  const findingSummary = buildFindingSummary(findings);

  const req: AIAssessmentRequest = {
    orgId, scanRunId, scorecard, findingSummary, inventorySummary, tagAnalysis,
  };

  const prompt = buildAssessmentPrompt(req);

  let response: AIAssessmentResponse;
  if (provider === 'openai') {
    if (!config.apiKey) throw new Error('OpenAI API key not configured. Set it in AI Settings.');
    response = await runOpenAIAssessment(prompt, config.apiKey, config.model);
  } else if (provider === 'anthropic') {
    if (!config.apiKey) throw new Error('Anthropic API key not configured. Set it in AI Settings.');
    response = await runAnthropicAssessment(prompt, config.apiKey, config.model);
  } else if (provider === 'ollama') {
    response = await runOllamaAssessment(prompt, config.baseUrl, config.model);
  } else {
    throw new Error(`Unknown AI provider: ${provider}`);
  }

  // Post-generation grounding check — flags unverifiable evidenceRefs in place,
  // never retries/rejects. Persist the annotated response, not the raw one.
  // (validateAssessment logs its own logger.warn summary when issues are found.)
  const { assessment: validatedResponse } = validateAssessment(response, req);

  const promptHash = createHash('sha256').update(prompt).digest('hex');

  // Persist the assessment (replace any prior assessment for this org/scan)
  await db.transaction(async (trx) => {
    await trx('ai_assessments').where({ org_id: orgId, scan_run_id: scanRunId }).delete();
    await trx('ai_assessments').insert({
      id: uuidv4(),
      org_id: orgId,
      scan_run_id: scanRunId,
      provider,
      model: config.model,
      prompt_hash: promptHash,
      response: JSON.stringify(validatedResponse),
      evidence_count: scorecard.totalFindings,
      generated_at: new Date().toISOString(),
    });
  });

  logger.info(`[${orgId}] AI assessment generated via ${provider}`);
  return validatedResponse;
}

export async function getStoredAssessment(
  orgId: string,
  scanRunId: string
): Promise<AIAssessmentResponse | null> {
  const db = getDatabase();
  const row = await db<{ org_id: string; scan_run_id: string; response: string }>('ai_assessments')
    .select('response')
    .where({ org_id: orgId, scan_run_id: scanRunId })
    .first();

  if (!row) return null;
  try { return JSON.parse(row.response); } catch { return null; }
}

async function buildInventorySummary(
  orgId: string,
  scanRunId: string,
  db: ReturnType<typeof getDatabase>
): Promise<InventorySummary> {
  const count = async (table: string) => {
    const row = await db(table).where({ org_id: orgId, scan_run_id: scanRunId }).count<{ c: string | number }>({ c: '*' }).first();
    return Number(row?.c ?? 0);
  };

  const teamCount = await (async () => {
    const row = await db('resources')
      .where({ org_id: orgId, scan_run_id: scanRunId, resource_type: 'team' })
      .count<{ c: string | number }>({ c: '*' })
      .first();
    return Number(row?.c ?? 0);
  })();

  return {
    hostCount: await count('hosts'),
    serviceCount: await count('services'),
    monitorCount: await count('monitors'),
    dashboardCount: await count('dashboards'),
    syntheticsCount: await count('synthetics_tests'),
    integrationCount: await count('integrations'),
    sloCount: await count('slos'),
    teamCount,
    logsIndexCount: await count('logs_indexes'),
    logsPipelineCount: await count('logs_pipelines'),
  };
}

async function buildTagAnalysis(
  orgId: string,
  scanRunId: string,
  db: ReturnType<typeof getDatabase>
): Promise<TagAnalysis> {
  const tagStats = await db<{
    org_id: string; scan_run_id: string;
    tag_key: string; unique_value_count: number;
    host_occurrence_count: number; service_occurrence_count: number;
    top_values: string; suggested_mapping: string | null;
  }>('tag_analysis')
    .select('tag_key', 'unique_value_count', 'host_occurrence_count', 'service_occurrence_count', 'top_values', 'suggested_mapping')
    .where({ org_id: orgId, scan_run_id: scanRunId })
    .orderByRaw('(host_occurrence_count + service_occurrence_count) DESC');

  const totalHostsRow = await db('hosts').where({ org_id: orgId, scan_run_id: scanRunId }).count<{ c: string | number }>({ c: '*' }).first();
  const totalHosts = Number(totalHostsRow?.c ?? 0);

  const getTagCoverage = async (key: string) => {
    const row = await db('resource_tags')
      .where({ org_id: orgId, scan_run_id: scanRunId, resource_type: 'host', tag_key: key })
      .countDistinct<{ c: string | number }>({ c: 'resource_id' })
      .first();
    const hostCount = Number(row?.c ?? 0);
    return totalHosts > 0 ? Math.round((hostCount / totalHosts) * 100) : 0;
  };

  const standardTags = new Set(['env', 'service', 'version', 'team', 'owner', 'cost_center',
    'application', 'business_unit', 'region', 'tier', 'lifecycle']);
  const foundKeys = new Set(tagStats.map((t) => t.tag_key));
  const missingStandardTags = [...standardTags].filter((k) => !foundKeys.has(k));

  const tagMappingSuggestions = tagStats
    .filter((t) => t.suggested_mapping)
    .map((t) => {
      let sampleValues: string[] = [];
      try { sampleValues = JSON.parse(t.top_values ?? '[]'); } catch { /* ignore */ }
      return {
        existingKey: t.tag_key,
        suggestedKey: t.suggested_mapping!,
        reason: `"${t.tag_key}" likely maps to the standard "${t.suggested_mapping}" tag`,
        sampleValues: sampleValues.slice(0, 3),
      };
    });

  return {
    totalTagKeys: tagStats.length,
    uniqueTagKeys: tagStats.map((t) => t.tag_key),
    envCoverage: await getTagCoverage('env'),
    serviceCoverage: await getTagCoverage('service'),
    versionCoverage: await getTagCoverage('version'),
    teamCoverage: await getTagCoverage('team'),
    topTagKeys: tagStats.slice(0, 20).map((t) => ({
      key: t.tag_key,
      count: t.host_occurrence_count + t.service_occurrence_count,
      coverage: totalHosts > 0 ? Math.round((t.host_occurrence_count / totalHosts) * 100) : 0,
    })),
    missingStandardTags,
    tagMappingSuggestions,
  };
}

function buildFindingSummary(findings: Awaited<ReturnType<typeof FindingRepository.findByScan>>): FindingSummary {
  const categories: FindingCategory[] = [
    'unified_tagging', 'service_architecture', 'monitors_health', 'logs_health',
    'dashboards_health', 'synthetics_health', 'integration_hygiene', 'network_cloud', 'governance',
  ];

  const byCategory = {} as FindingSummary['byCategory'];
  for (const cat of categories) {
    const catFindings = findings.filter((f) => f.category === cat);
    byCategory[cat] = {
      count: catFindings.length,
      topFindings: catFindings.slice(0, 3).map((f) => {
        const resources = f.affectedResources?.slice(0, 3).map((r) => ({
          type: r.type, id: r.id, name: r.name,
        })) ?? [];
        return {
          title: f.title,
          affectedCount: f.affectedCount,
          totalCount: f.totalCount,
          percentage: f.percentage,
          resources,
          totalResourceCount: f.affectedResources?.length ?? 0,
        };
      }),
    };
  }

  return {
    byCategory,
    bySeverity: {
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
    totalFindings: findings.length,
  };
}

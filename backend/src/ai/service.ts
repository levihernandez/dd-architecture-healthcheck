import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database';
import { ScorecardRepository } from '../db/repositories/scorecard.repository';
import { FindingRepository } from '../db/repositories/finding.repository';
import { buildAssessmentPrompt } from './prompts';
import { runOpenAIAssessment } from './providers/openai.provider';
import { runAnthropicAssessment } from './providers/anthropic.provider';
import { runOllamaAssessment } from './providers/ollama.provider';
import { getAIConfig } from './config';
import { logger } from '../utils/logger';
import type {
  AIAssessmentRequest, AIAssessmentResponse,
  InventorySummary, TagAnalysis, FindingSummary, FindingCategory
} from '../types/assessment.types';

export async function generateAIAssessment(
  orgId: string,
  scanRunId: string
): Promise<AIAssessmentResponse> {
  const config = getAIConfig();
  const provider = config.provider;

  if (provider === 'none') {
    throw new Error('No AI provider configured. Go to AI Settings in the UI to set up a provider.');
  }

  const db = getDatabase();

  const scorecard = ScorecardRepository.findByScan(orgId, scanRunId);
  if (!scorecard) throw new Error('No scorecard found. Run a scan first.');

  const findings = FindingRepository.findByScan(scanRunId, orgId);

  const inventorySummary = buildInventorySummary(orgId, scanRunId, db);
  const tagAnalysis = buildTagAnalysis(orgId, scanRunId, db);
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

  // Persist the assessment
  db.prepare(`
    INSERT OR REPLACE INTO ai_assessments
      (id, org_id, scan_run_id, provider, model, response, evidence_count, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(), orgId, scanRunId,
    provider,
    config.model,
    JSON.stringify(response),
    scorecard.totalFindings,
    new Date().toISOString()
  );

  logger.info(`[${orgId}] AI assessment generated via ${provider}`);
  return response;
}

export async function getStoredAssessment(
  orgId: string,
  scanRunId: string
): Promise<AIAssessmentResponse | null> {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT response FROM ai_assessments WHERE org_id = ? AND scan_run_id = ?'
  ).get(orgId, scanRunId) as { response: string } | undefined;

  if (!row) return null;
  try { return JSON.parse(row.response); } catch { return null; }
}

function buildInventorySummary(
  orgId: string,
  scanRunId: string,
  db: ReturnType<typeof getDatabase>
): InventorySummary {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE org_id = ? AND scan_run_id = ?`)
      .get(orgId, scanRunId) as { c: number })?.c ?? 0;

  const teamCount = (db.prepare(
    "SELECT COUNT(*) as c FROM resources WHERE org_id = ? AND scan_run_id = ? AND resource_type = 'team'"
  ).get(orgId, scanRunId) as { c: number })?.c ?? 0;

  return {
    hostCount: count('hosts'),
    serviceCount: count('services'),
    monitorCount: count('monitors'),
    dashboardCount: count('dashboards'),
    syntheticsCount: count('synthetics_tests'),
    integrationCount: count('integrations'),
    sloCount: count('slos'),
    teamCount,
    logsIndexCount: count('logs_indexes'),
    logsPipelineCount: count('logs_pipelines'),
  };
}

function buildTagAnalysis(
  orgId: string,
  scanRunId: string,
  db: ReturnType<typeof getDatabase>
): TagAnalysis {
  const tagStats = db.prepare(`
    SELECT tag_key, unique_value_count, host_occurrence_count, service_occurrence_count,
           top_values, suggested_mapping
    FROM tag_analysis
    WHERE org_id = ? AND scan_run_id = ?
    ORDER BY (host_occurrence_count + service_occurrence_count) DESC
  `).all(orgId, scanRunId) as Array<{
    tag_key: string; unique_value_count: number;
    host_occurrence_count: number; service_occurrence_count: number;
    top_values: string; suggested_mapping: string | null;
  }>;

  const totalHosts = (db.prepare('SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
  const totalServices = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;

  const getTagCoverage = (key: string) => {
    const hostCount = (db.prepare('SELECT COUNT(DISTINCT resource_id) as c FROM resource_tags WHERE org_id = ? AND scan_run_id = ? AND resource_type = ? AND tag_key = ?').get(orgId, scanRunId, 'host', key) as { c: number })?.c ?? 0;
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
    envCoverage: getTagCoverage('env'),
    serviceCoverage: getTagCoverage('service'),
    versionCoverage: getTagCoverage('version'),
    teamCoverage: getTagCoverage('team'),
    topTagKeys: tagStats.slice(0, 20).map((t) => ({
      key: t.tag_key,
      count: t.host_occurrence_count + t.service_occurrence_count,
      coverage: totalHosts > 0 ? Math.round((t.host_occurrence_count / totalHosts) * 100) : 0,
    })),
    missingStandardTags,
    tagMappingSuggestions,
  };
}

function buildFindingSummary(findings: ReturnType<typeof FindingRepository.findByScan>): FindingSummary {
  const categories: FindingCategory[] = [
    'unified_tagging', 'service_architecture', 'monitors_health', 'logs_health',
    'dashboards_health', 'synthetics_health', 'integration_hygiene', 'network_cloud', 'governance',
  ];

  const byCategory = {} as FindingSummary['byCategory'];
  for (const cat of categories) {
    const catFindings = findings.filter((f) => f.category === cat);
    byCategory[cat] = {
      count: catFindings.length,
      topFindings: catFindings.slice(0, 3).map((f) => f.title),
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

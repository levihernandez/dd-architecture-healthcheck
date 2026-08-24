import { getDatabase } from '../db/database';
import type { Knex } from 'knex';
import { FindingRepository } from '../db/repositories/finding.repository';
import { ScorecardRepository } from '../db/repositories/scorecard.repository';
import { logger } from '../utils/logger';
import { unifiedTaggingRules } from './rules/unified-tagging.rules';
import { serviceArchitectureRules } from './rules/service-architecture.rules';
import { monitorsHealthRules } from './rules/monitors-health.rules';
import { logsHealthRules } from './rules/logs-health.rules';
import { dashboardsHealthRules } from './rules/dashboards-health.rules';
import { syntheticsHealthRules } from './rules/synthetics-health.rules';
import { integrationHygieneRules } from './rules/integration-hygiene.rules';
import { governanceRules } from './rules/governance.rules';
import { costOptimizationRules } from './rules/cost-optimization.rules';
import { securityPostureRules } from './rules/security-posture.rules';
import { computeScorecard } from './scorer';
import { FeatureFlagRepository } from '../feature-flags/repository';
import type { AssessmentRule, AssessmentContext, Finding, FindingCategory } from '../types/assessment.types';

const ALL_RULES: AssessmentRule[] = [
  ...unifiedTaggingRules,
  ...serviceArchitectureRules,
  ...monitorsHealthRules,
  ...logsHealthRules,
  ...dashboardsHealthRules,
  ...syntheticsHealthRules,
  ...integrationHygieneRules,
  ...governanceRules,
  ...costOptimizationRules,
  ...securityPostureRules,
];

export async function runAssessment(orgId: string, scanRunId: string): Promise<number> {
  const db = getDatabase();
  const ctx: AssessmentContext = { orgId, scanRunId, db };

  const allFindings: Omit<Finding, 'id' | 'createdAt'>[] = [];

  for (const rule of ALL_RULES) {
    if (!FeatureFlagRepository.isRuleCategoryEnabled(rule.category)) {
      continue;
    }
    try {
      const result = await rule.run(ctx);
      for (const f of result.findings) {
        allFindings.push({
          ...f,
          orgId,
          scanRunId,
        });
      }
    } catch (err) {
      logger.error(`Rule ${rule.id} threw an exception`, err);
    }
  }

  if (allFindings.length > 0) {
    await FindingRepository.insertMany(allFindings);
  }

  // Compute and store scorecard
  const scorecard = computeScorecard(orgId, scanRunId, allFindings as Finding[]);
  await ScorecardRepository.upsert(scorecard);

  // Build tag analysis
  await buildTagAnalysis(orgId, scanRunId, db);

  return allFindings.length;
}

// Normalizes db.raw() result shape across dialects: the better-sqlite3 driver
// returns the rows array directly, while the pg driver returns { rows: [...] }.
function rawRows<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : ((result as { rows: T[] }).rows);
}

async function buildTagAnalysis(orgId: string, scanRunId: string, db: Knex): Promise<void> {
  const now = new Date().toISOString();

  // Aggregate tag usage across resource types.
  // GROUP_CONCAT is SQLite-specific (Postgres would need string_agg) and the
  // COUNT(CASE WHEN ...) conditional aggregates aren't a clean fit for the
  // Knex builder either, so this stays as a raw query — with its dialect-
  // dependent result shape normalized immediately below.
  const rawResult = await db.raw(
    `
    SELECT tag_key,
      COUNT(DISTINCT tag_value) as unique_values,
      COUNT(CASE WHEN resource_type = 'host' THEN 1 END) as host_count,
      COUNT(CASE WHEN resource_type = 'service' THEN 1 END) as service_count,
      GROUP_CONCAT(DISTINCT tag_value) as values_concat
    FROM resource_tags
    WHERE org_id = ? AND scan_run_id = ?
    GROUP BY tag_key
    ORDER BY (host_count + service_count) DESC
  `,
    [orgId, scanRunId]
  );

  const tagStats = rawRows<{
    tag_key: string; unique_values: number; host_count: number;
    service_count: number; values_concat: string;
  }>(rawResult);

  const standardKeys = new Set(['env', 'service', 'version', 'team', 'owner',
    'cost_center', 'application', 'business_unit', 'region', 'cloud_provider',
    'cluster_name', 'namespace', 'tier', 'lifecycle', 'compliance_scope']);

  const tagMappings: Record<string, string> = {
    'environment': 'env', 'environ': 'env',
    'app': 'service', 'application': 'service',
    'squad': 'team', 'group': 'team',
    'bu': 'business_unit', 'department': 'business_unit',
    'cost-center': 'cost_center', 'costcenter': 'cost_center',
    'cluster': 'cluster_name', 'k8s-cluster': 'cluster_name',
    'ns': 'namespace', 'k8s-namespace': 'namespace',
  };

  const { v4: uuidv4 } = require('uuid');

  try {
    await db.transaction(async (trx) => {
      for (const stat of tagStats) {
        const topValues = (stat.values_concat ?? '')
          .split(',').slice(0, 10);
        const isStandard = standardKeys.has(stat.tag_key);
        const suggested = tagMappings[stat.tag_key] ?? null;

        // Original was `INSERT OR REPLACE` (SQLite-specific upsert-by-unique-key);
        // onConflict(...).merge() is the dialect-portable Knex equivalent given
        // the (org_id, scan_run_id, tag_key) unique constraint on this table.
        await trx('tag_analysis')
          .insert({
            id: uuidv4(),
            org_id: orgId,
            scan_run_id: scanRunId,
            tag_key: stat.tag_key,
            unique_value_count: stat.unique_values,
            host_occurrence_count: stat.host_count,
            service_occurrence_count: stat.service_count,
            monitor_occurrence_count: 0,
            top_values: JSON.stringify(topValues),
            is_standard_key: isStandard ? 1 : 0,
            suggested_mapping: suggested,
            computed_at: now,
          })
          .onConflict(['org_id', 'scan_run_id', 'tag_key'])
          .merge();
      }
    });
  } catch (err) {
    logger.error('Failed to build tag analysis', err);
  }
}

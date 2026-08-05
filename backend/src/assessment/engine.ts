import { getDatabase } from '../db/database';
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
    FindingRepository.insertMany(allFindings);
  }

  // Compute and store scorecard
  const scorecard = computeScorecard(orgId, scanRunId, allFindings as Finding[]);
  ScorecardRepository.upsert(scorecard);

  // Build tag analysis
  buildTagAnalysis(orgId, scanRunId, db);

  return allFindings.length;
}

function buildTagAnalysis(orgId: string, scanRunId: string, db: ReturnType<typeof getDatabase>): void {
  const now = new Date().toISOString();

  // Aggregate tag usage across resource types
  const tagStats = db.prepare(`
    SELECT tag_key,
      COUNT(DISTINCT tag_value) as unique_values,
      COUNT(CASE WHEN resource_type = 'host' THEN 1 END) as host_count,
      COUNT(CASE WHEN resource_type = 'service' THEN 1 END) as service_count,
      GROUP_CONCAT(DISTINCT tag_value) as values_concat
    FROM resource_tags
    WHERE org_id = ? AND scan_run_id = ?
    GROUP BY tag_key
    ORDER BY (host_count + service_count) DESC
  `).all(orgId, scanRunId) as Array<{
    tag_key: string; unique_values: number; host_count: number;
    service_count: number; values_concat: string;
  }>;

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

  const insertTag = db.prepare(`
    INSERT OR REPLACE INTO tag_analysis
      (id, org_id, scan_run_id, tag_key, unique_value_count, host_occurrence_count,
       service_occurrence_count, monitor_occurrence_count, top_values,
       is_standard_key, suggested_mapping, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const { v4: uuidv4 } = require('uuid');

  const txn = db.transaction(() => {
    for (const stat of tagStats) {
      const topValues = (stat.values_concat ?? '')
        .split(',').slice(0, 10);
      const isStandard = standardKeys.has(stat.tag_key);
      const suggested = tagMappings[stat.tag_key] ?? null;

      insertTag.run(
        uuidv4(), orgId, scanRunId,
        stat.tag_key, stat.unique_values,
        stat.host_count, stat.service_count, 0,
        JSON.stringify(topValues),
        isStandard ? 1 : 0,
        suggested,
        now
      );
    }
  });

  try { txn(); } catch (err) {
    logger.error('Failed to build tag analysis', err);
  }
}

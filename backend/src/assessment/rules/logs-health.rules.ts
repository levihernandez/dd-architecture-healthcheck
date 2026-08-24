import type { AssessmentRule, AssessmentContext, RuleResult } from '../../types/assessment.types';

const logsIndexCoverageRule: AssessmentRule = {
  id: 'log-001',
  name: 'Logs index coverage',
  category: 'logs_health',
  severity: 'medium',
  description: 'Logs indexes should have targeted filters to avoid indexing everything',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const indexes = await db<{
      org_id: string; scan_run_id: string;
      index_name: string; filter_query: string | null;
      exclusion_filter_count: number; daily_limit: number | null;
      is_rate_limited: number;
    }>('logs_indexes').where({ org_id: orgId, scan_run_id: scanRunId });

    if (indexes.length === 0) {
      return { ruleId: 'log-001', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    const noFilter = indexes.filter((i) => !i.filter_query || i.filter_query === '*');
    const noExclusions = indexes.filter((i) => i.exclusion_filter_count === 0);
    const rateLimited = indexes.filter((i) => i.is_rate_limited);
    const issues = noFilter.length + (noExclusions.length > indexes.length * 0.8 ? 1 : 0);
    const passed = issues === 0 && rateLimited.length === 0;
    const score = Math.max(0, 100 - noFilter.length * 20 - rateLimited.length * 25);

    const findings = [];

    if (noFilter.length > 0) {
      findings.push({
        category: 'logs_health' as const, ruleId: 'log-001', ruleName: 'Logs index coverage',
        severity: 'medium' as const,
        title: `${noFilter.length} log index(es) use catch-all filters`,
        description: `Indexes with no filter or wildcard (*) capture all logs, potentially driving high indexing costs.`,
        impact: 'Over-indexing drives costs and reduces signal quality by including debug/info noise.',
        recommendation: 'Add targeted filter queries to each index (e.g., service:api env:prod). Use exclusion filters to drop high-volume, low-value logs like health checks.',
        affectedCount: noFilter.length, totalCount: indexes.length,
        percentage: Math.round((noFilter.length / indexes.length) * 100),
        affectedResources: noFilter.map((i) => ({ type: 'logs_index', id: i.index_name, name: i.index_name })),
        evidence: [{ type: 'count' as const, description: `${noFilter.length} indexes have no targeted filter`, value: noFilter.length, source: '/api/v1/logs/config/indexes' }],
      });
    }

    if (rateLimited.length > 0) {
      findings.push({
        category: 'logs_health' as const, ruleId: 'log-001a', ruleName: 'Rate-limited log indexes',
        severity: 'high' as const,
        title: `${rateLimited.length} log index(es) are rate-limited`,
        description: `Rate-limited indexes are dropping logs, causing data loss.`,
        impact: 'Log gaps break incident investigations and compliance requirements.',
        recommendation: 'Increase daily limits or add exclusion filters to reduce volume on rate-limited indexes.',
        affectedCount: rateLimited.length, totalCount: indexes.length,
        percentage: Math.round((rateLimited.length / indexes.length) * 100),
        affectedResources: rateLimited.map((i) => ({ type: 'logs_index', id: i.index_name, name: i.index_name })),
        evidence: [{ type: 'count' as const, description: `${rateLimited.length} indexes are rate-limited`, value: rateLimited.length, source: '/api/v1/logs/config/indexes' }],
      });
    }

    return { ruleId: 'log-001', passed, score, maxScore: 100, findings };
  },
};

const logsPipelineCoverageRule: AssessmentRule = {
  id: 'log-002',
  name: 'Logs pipeline coverage',
  category: 'logs_health',
  severity: 'medium',
  description: 'Log pipelines parse and enrich logs for better analysis',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = Number(
      (await db('logs_pipelines').where({ org_id: orgId, scan_run_id: scanRunId }).count({ c: '*' }).first())?.c ?? 0
    );
    const enabled = Number(
      (await db('logs_pipelines').where({ org_id: orgId, scan_run_id: scanRunId, is_enabled: 1 }).count({ c: '*' }).first())?.c ?? 0
    );
    const passed = total >= 1;

    return {
      ruleId: 'log-002', passed, score: passed ? 100 : 50, maxScore: 100,
      findings: passed ? [] : [{
        category: 'logs_health', ruleId: 'log-002', ruleName: 'Logs pipeline coverage',
        severity: 'medium',
        title: `No custom log processing pipelines detected`,
        description: `Without pipelines, logs are not parsed or enriched, limiting analysis capability.`,
        impact: 'Raw, unparsed logs are harder to query, alert on, and correlate with traces and metrics.',
        recommendation: 'Create log pipelines for each major log format (JSON, NGINX, Apache, custom app logs). Extract key fields like status code, duration, user_id, trace_id.',
        affectedCount: 0, totalCount: 0, percentage: 0,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${total} pipelines total, ${enabled} enabled`, value: total, source: '/api/v1/logs/config/pipelines' }],
      }],
    };
  },
};

export const logsHealthRules: AssessmentRule[] = [
  logsIndexCoverageRule,
  logsPipelineCoverageRule,
];

import type { AssessmentRule, AssessmentContext, RuleResult } from '../../types/assessment.types';
import { parseUsageSummary, parseCostJson, groupChargesByProduct } from '../cost-data';

// These rules are informational-only: 'cost_optimization' is deliberately absent
// from scorer.ts's CATEGORY_WEIGHTS, so none of this affects the overall score.
// They correlate cost/usage data (collected but never scored before this) against
// tagging and configuration data already collected by other collectors — findings
// are worded as likely contributing factors, not proven root causes, since this
// is correlation across independently-collected signals, not causal tracing.

async function getLatestUsage(ctx: AssessmentContext): Promise<Record<string, unknown>> {
  const row = await ctx.db<{ org_id: string; scan_run_id: string; usage_json: string }>('usage_summary')
    .select('usage_json')
    .where({ org_id: ctx.orgId, scan_run_id: ctx.scanRunId })
    .first();
  if (!row) return {};
  return parseUsageSummary(row.usage_json).latestUsage;
}

async function getCostByProduct(ctx: AssessmentContext): Promise<Record<string, { committed: number; on_demand: number }>> {
  const row = await ctx.db<{ org_id: string; scan_run_id: string; cost_json: string | null }>('usage_summary')
    .select('cost_json')
    .where({ org_id: ctx.orgId, scan_run_id: ctx.scanRunId })
    .first();
  if (!row) return {};
  return groupChargesByProduct(parseCostJson(row.cost_json));
}

const HIGH_CARDINALITY_THRESHOLD = 200;

const customMetricsCardinalityRule: AssessmentRule = {
  id: 'cost-001',
  name: 'Custom metrics cost and tag cardinality',
  category: 'cost_optimization',
  severity: 'medium',
  description: 'High-cardinality tags are a common driver of custom-metrics cost growth',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const usage = await getLatestUsage(ctx);
    const customMetricsValue = typeof usage.custom_ts_avg === 'number' ? usage.custom_ts_avg : 0;

    if (customMetricsValue <= 0) {
      return { ruleId: 'cost-001', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    const highCardinalityTags = await ctx.db<{ org_id: string; scan_run_id: string; is_standard_key: number; tag_key: string; unique_value_count: number }>('tag_analysis')
      .select('tag_key', 'unique_value_count')
      .where({ org_id: ctx.orgId, scan_run_id: ctx.scanRunId, is_standard_key: 0 })
      .where('unique_value_count', '>=', HIGH_CARDINALITY_THRESHOLD)
      .orderBy('unique_value_count', 'desc')
      .limit(10);

    if (highCardinalityTags.length === 0) {
      return { ruleId: 'cost-001', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    const tagList = highCardinalityTags.map((t) => `${t.tag_key} (${t.unique_value_count} values)`).join(', ');

    return {
      ruleId: 'cost-001', passed: false, score: 60, maxScore: 100,
      findings: [{
        category: 'cost_optimization', ruleId: 'cost-001', ruleName: 'Custom metrics cost and tag cardinality',
        severity: 'medium',
        title: `${highCardinalityTags.length} high-cardinality tag(s) may be contributing to custom metrics cost`,
        description: `Custom metrics are actively in use, and ${highCardinalityTags.length} tag key(s) have very high unique-value counts: ${tagList}. Tags with unbounded cardinality (request IDs, pod names, user IDs) are a common driver of unexpected custom-metrics growth.`,
        impact: 'Unbounded tag cardinality on metrics can silently multiply the number of custom metric timeseries billed, well beyond what the dashboards/monitors actually need.',
        recommendation: 'Review whether these tags are applied to metrics (not just logs/APM). If so, consider excluding high-cardinality tags from metric submission or using them only on lower-volume signals.',
        affectedCount: highCardinalityTags.length, totalCount: highCardinalityTags.length, percentage: 100,
        affectedResources: highCardinalityTags.map((t) => ({ type: 'tag', id: t.tag_key, name: t.tag_key })),
        evidence: [{ type: 'metric', description: `Custom metrics usage (avg timeseries): ${customMetricsValue}`, source: '/api/v1/usage/summary' }],
      }],
    };
  },
};

const logIngestionCatchAllRule: AssessmentRule = {
  id: 'cost-002',
  name: 'Log ingestion cost and unfiltered indexes',
  category: 'cost_optimization',
  severity: 'medium',
  description: 'Log indexes with no exclusion filters ingest broadly and drive log cost',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const usage = await getLatestUsage(ctx);
    const logsIngestedBytes = typeof usage.logs_ingested_bytes_sum === 'number' ? usage.logs_ingested_bytes_sum : 0;

    if (logsIngestedBytes <= 0) {
      return { ruleId: 'cost-002', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    const catchAllIndexes = await ctx.db<{ org_id: string; scan_run_id: string; exclusion_filter_count: number; index_name: string }>('logs_indexes')
      .select('index_name')
      .where({ org_id: ctx.orgId, scan_run_id: ctx.scanRunId, exclusion_filter_count: 0 })
      .where((b) => b.whereNull('filter_query').orWhere('filter_query', '').orWhere('filter_query', '*'));

    if (catchAllIndexes.length === 0) {
      return { ruleId: 'cost-002', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    return {
      ruleId: 'cost-002', passed: false, score: 55, maxScore: 100,
      findings: [{
        category: 'cost_optimization', ruleId: 'cost-002', ruleName: 'Log ingestion cost and unfiltered indexes',
        severity: 'medium',
        title: `${catchAllIndexes.length} log index(es) with no exclusion filters likely driving ingestion cost`,
        description: `Log ingestion is active (${(logsIngestedBytes / 1e9).toFixed(1)} GB), and ${catchAllIndexes.length} index(es) — ${catchAllIndexes.map((i) => i.index_name).join(', ')} — have a catch-all filter and zero exclusion filters, meaning everything routed to them is ingested and indexed at full cost.`,
        impact: 'Unfiltered indexes commonly ingest debug/verbose logs at full price, inflating log management spend without adding investigative value.',
        recommendation: 'Add exclusion filters to sample or drop low-value log volume (debug/health-check noise) before it reaches indexing.',
        affectedCount: catchAllIndexes.length, totalCount: catchAllIndexes.length, percentage: 100,
        affectedResources: catchAllIndexes.map((i) => ({ type: 'logs_index', id: i.index_name, name: i.index_name })),
        evidence: [{ type: 'metric', description: `Logs ingested: ${(logsIngestedBytes / 1e9).toFixed(1)} GB`, source: '/api/v1/usage/summary' }],
      }],
    };
  },
};

const onDemandUntaggedHostsRule: AssessmentRule = {
  id: 'cost-003',
  name: 'On-demand overage and host tag coverage',
  category: 'cost_optimization',
  severity: 'high',
  description: 'Untagged hosts driving on-demand overage cannot be attributed to a team or service',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const costByProduct = await getCostByProduct(ctx);
    const hasHostOnDemand = Object.entries(costByProduct).some(
      ([name, cost]) => /host|infrastructure/i.test(name) && cost.on_demand > 0
    );

    if (!hasHostOnDemand) {
      return { ruleId: 'cost-003', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    const total = Number(
      (await ctx.db('hosts').where({ org_id: ctx.orgId, scan_run_id: ctx.scanRunId }).count({ c: '*' }).first())?.c ?? 0
    );
    const tagged = Number(
      (await ctx.db('hosts')
        .where({ org_id: ctx.orgId, scan_run_id: ctx.scanRunId, has_env_tag: 1, has_service_tag: 1 })
        .count({ c: '*' })
        .first())?.c ?? 0
    );
    const percentage = total === 0 ? 100 : Math.round((tagged / total) * 100);

    if (total === 0 || percentage >= 50) {
      return { ruleId: 'cost-003', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    return {
      ruleId: 'cost-003', passed: false, score: 40, maxScore: 100,
      findings: [{
        category: 'cost_optimization', ruleId: 'cost-003', ruleName: 'On-demand overage and host tag coverage',
        severity: 'high',
        title: `On-demand host charges present while only ${percentage}% of hosts have env+service tags`,
        description: `Host-related on-demand (overage) charges are being billed, but only ${tagged} of ${total} hosts (${percentage}%) have both env and service tags. Without those tags, this overage can't be attributed to a specific team or service.`,
        impact: 'Overage spend on untagged hosts is invisible in cost-by-team/service reporting, making it hard to identify who owns the growth or whether it\'s intentional.',
        recommendation: 'Tag hosts with env and service before investigating overage further — cost attribution has to come first, then the specific hosts driving it can be identified and right-sized.',
        affectedCount: total - tagged, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count', description: `${tagged}/${total} hosts have both env and service tags`, value: percentage, source: '/api/v2/usage/estimated_cost' }],
      }],
    };
  },
};

const unconfiguredCloudChecksRule: AssessmentRule = {
  id: 'cost-004',
  name: 'Cloud provider checks without a configured integration',
  category: 'cost_optimization',
  severity: 'low',
  description: 'A cloud-provider agent check running without the matching integration configured suggests ad-hoc setup',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const signal = await ctx.db<{ org_id: string; scan_run_id: string; product: string; signal: string; value: string }>('product_usage_signals')
      .select('value')
      .where({ org_id: ctx.orgId, scan_run_id: ctx.scanRunId, product: 'fleet', signal: 'installed_checks' })
      .first();

    if (!signal) {
      return { ruleId: 'cost-004', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    let installedChecks: Record<string, number> = {};
    try { installedChecks = JSON.parse(signal.value); } catch { /* ignore */ }

    const CLOUD_CHECKS: Record<string, string> = { aws: 'aws', azure: 'azure', gcp: 'gcp', 'google cloud platform': 'gcp' };
    const configuredProviders = new Set(
      (await ctx.db<{ org_id: string; scan_run_id: string; provider: string }>('cloud_accounts')
        .distinct('provider')
        .where({ org_id: ctx.orgId, scan_run_id: ctx.scanRunId }))
        .map((r) => r.provider)
    );

    const gaps = Object.entries(installedChecks)
      .filter(([check]) => CLOUD_CHECKS[check])
      .filter(([check]) => !configuredProviders.has(CLOUD_CHECKS[check]))
      .map(([check, hostCount]) => ({ check, provider: CLOUD_CHECKS[check], hostCount }));

    if (gaps.length === 0) {
      return { ruleId: 'cost-004', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    return {
      ruleId: 'cost-004', passed: false, score: 70, maxScore: 100,
      findings: [{
        category: 'cost_optimization', ruleId: 'cost-004', ruleName: 'Cloud provider checks without a configured integration',
        severity: 'low',
        title: `${gaps.length} cloud-provider check(s) detected on hosts with no matching integration configured`,
        description: gaps.map((g) => `${g.provider} check running on ${g.hostCount} host(s)`).join('; ') + '. The agent is auto-detecting cloud-provider metadata on hosts, but no corresponding integration is configured at the org level.',
        impact: 'Cloud resource/cost metadata from an unconfigured integration is often incomplete, and per-host ad-hoc setup (vs. a centrally configured integration) is a common sign of accidental or one-off enablement rather than deliberate rollout.',
        recommendation: 'Either configure the corresponding cloud integration at the org level (Integrations > AWS/Azure/GCP) for full metadata, or confirm the check running on these hosts is intentional.',
        affectedCount: gaps.length, totalCount: gaps.length, percentage: 100,
        affectedResources: gaps.map((g) => ({ type: 'check', id: g.check, name: g.check })),
        evidence: [{ type: 'config_gap', description: `Detected checks: ${gaps.map((g) => g.check).join(', ')}`, source: '/api/v1/hosts' }],
      }],
    };
  },
};

const unconfiguredCostManagementRule: AssessmentRule = {
  id: 'cost-005',
  name: 'Cloud accounts without Cloud Cost Management configured',
  category: 'cost_optimization',
  severity: 'medium',
  description: 'A configured cloud integration without Cloud Cost Management means no cost-by-tag/resource visibility for that provider',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const configuredCloudAccounts = await ctx.db<{ org_id: string; scan_run_id: string; provider: string }>('cloud_accounts')
      .distinct('provider')
      .where({ org_id: ctx.orgId, scan_run_id: ctx.scanRunId });

    if (configuredCloudAccounts.length === 0) {
      return { ruleId: 'cost-005', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    const ccmConfigured = new Set(
      (await ctx.db<{ org_id: string; scan_run_id: string; provider: string; configured: number }>('cost_management_config')
        .select('provider')
        .where({ org_id: ctx.orgId, scan_run_id: ctx.scanRunId, configured: 1 }))
        .map((r) => r.provider)
    );

    const gaps = configuredCloudAccounts.filter((a) => !ccmConfigured.has(a.provider));

    if (gaps.length === 0) {
      return { ruleId: 'cost-005', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    return {
      ruleId: 'cost-005', passed: false, score: 65, maxScore: 100,
      findings: [{
        category: 'cost_optimization', ruleId: 'cost-005', ruleName: 'Cloud accounts without Cloud Cost Management configured',
        severity: 'medium',
        title: `${gaps.length} cloud provider(s) have an integration configured but not Cloud Cost Management`,
        description: `${gaps.map((g) => g.provider).join(', ')} ${gaps.length === 1 ? 'has' : 'have'} a Datadog cloud integration configured, but Cloud Cost Management is not set up for ${gaps.length === 1 ? 'it' : 'them'}.`,
        impact: 'Without Cloud Cost Management, cost cannot be broken down by tag, service, or resource for that provider — only the aggregate estimated cost is visible.',
        recommendation: 'Configure Cloud Cost Management (Datadog > Cost Management) for each provider already integrated, to unlock cost-by-tag and cost-by-resource views.',
        affectedCount: gaps.length, totalCount: configuredCloudAccounts.length, percentage: Math.round((gaps.length / configuredCloudAccounts.length) * 100),
        affectedResources: gaps.map((g) => ({ type: 'cloud_provider', id: g.provider, name: g.provider })),
        evidence: [{ type: 'config_gap', description: `Cloud integrations without CCM: ${gaps.map((g) => g.provider).join(', ')}`, source: '/api/v2/cost/*_config' }],
      }],
    };
  },
};

export const costOptimizationRules: AssessmentRule[] = [
  customMetricsCardinalityRule,
  logIngestionCatchAllRule,
  onDemandUntaggedHostsRule,
  unconfiguredCloudChecksRule,
  unconfiguredCostManagementRule,
];

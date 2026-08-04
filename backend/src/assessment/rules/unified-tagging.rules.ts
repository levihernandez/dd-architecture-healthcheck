import type { AssessmentRule, AssessmentContext, RuleResult } from '../../types/assessment.types';

function pct(count: number, total: number): number {
  return total === 0 ? 100 : Math.round((count / total) * 100);
}

const envTagRule: AssessmentRule = {
  id: 'ust-001',
  name: 'Host env tag coverage',
  category: 'unified_tagging',
  severity: 'critical',
  description: 'All hosts must have the env tag for Unified Service Tagging',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;

    const total = (db.prepare(
      'SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ?'
    ).get(orgId, scanRunId) as { c: number })?.c ?? 0;

    const withEnv = (db.prepare(
      'SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ? AND has_env_tag = 1'
    ).get(orgId, scanRunId) as { c: number })?.c ?? 0;

    const missing = total - withEnv;
    const percentage = pct(withEnv, total);
    const passed = percentage >= 90;

    const affectedHosts = missing > 0
      ? (db.prepare(
          'SELECT host_name FROM hosts WHERE org_id = ? AND scan_run_id = ? AND has_env_tag = 0 LIMIT 20'
        ).all(orgId, scanRunId) as Array<{ host_name: string }>)
      : [];

    return {
      ruleId: 'ust-001',
      passed,
      score: percentage,
      maxScore: 100,
      findings: passed ? [] : [{
        category: 'unified_tagging',
        ruleId: 'ust-001',
        ruleName: 'Host env tag coverage',
        severity: percentage < 50 ? 'critical' : percentage < 75 ? 'high' : 'medium',
        title: `${missing} host(s) missing env tag (${percentage}% coverage)`,
        description: `Unified Service Tagging requires the env tag on all hosts. ${missing} of ${total} hosts are missing this tag.`,
        impact: 'Without env tags, you cannot correlate infrastructure metrics, APM traces, and logs across environments. Alerting and dashboards will lack environment context.',
        recommendation: 'Add env:<environment> tags to all hosts via your agent configuration, Ansible/Puppet/Chef automation, cloud provider tagging, or Datadog container tag injection.',
        affectedCount: missing,
        totalCount: total,
        percentage,
        affectedResources: affectedHosts.map((h) => ({
          type: 'host', id: h.host_name, name: h.host_name,
        })),
        evidence: [
          { type: 'count' as const, description: `${withEnv} of ${total} hosts have env tag`, value: percentage, source: '/api/v1/hosts' },
        ],
      }],
    };
  },
};

const serviceTagHostRule: AssessmentRule = {
  id: 'ust-002',
  name: 'Host service tag coverage',
  category: 'unified_tagging',
  severity: 'high',
  description: 'Hosts should have a service tag to identify workloads',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withService = (db.prepare('SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ? AND has_service_tag = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withService;
    const percentage = pct(withService, total);
    const passed = percentage >= 80;

    return {
      ruleId: 'ust-002', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'unified_tagging', ruleId: 'ust-002', ruleName: 'Host service tag coverage',
        severity: percentage < 50 ? 'high' : 'medium',
        title: `${missing} host(s) missing service tag (${percentage}% coverage)`,
        description: `${missing} of ${total} hosts lack a service tag, preventing APM-infrastructure correlation.`,
        impact: 'Trace-to-host correlation is broken without the service tag. Service-level dashboards and alerts will miss host-level signals.',
        recommendation: 'Add service:<name> tags to hosts running specific services. For multi-service hosts, tag with the primary service.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withService}/${total} hosts have service tag`, value: percentage, source: '/api/v1/hosts' }],
      }],
    };
  },
};

const versionTagRule: AssessmentRule = {
  id: 'ust-003',
  name: 'APM service version tag coverage',
  category: 'unified_tagging',
  severity: 'medium',
  description: 'APM services should report version tags for deployment tracking',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withVersion = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ? AND has_version_tag = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withVersion;
    const percentage = pct(withVersion, total);
    const passed = percentage >= 70;

    return {
      ruleId: 'ust-003', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'unified_tagging', ruleId: 'ust-003', ruleName: 'APM service version tag',
        severity: 'medium',
        title: `${missing} APM service(s) missing version tag (${percentage}% coverage)`,
        description: `Version tags enable deployment impact analysis, error rate comparisons across versions, and canary tracking.`,
        impact: 'Cannot compare error rates or latency across deployments without version tags.',
        recommendation: 'Inject DD_VERSION as an environment variable or use Datadog\'s unified service tagging auto-injection.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withVersion}/${total} services report version`, value: percentage, source: '/api/v1/services' }],
      }],
    };
  },
};

const monitorTagRule: AssessmentRule = {
  id: 'ust-004',
  name: 'Monitor env/service tag coverage',
  category: 'unified_tagging',
  severity: 'medium',
  description: 'Monitors should be tagged with env and service for grouping and routing',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withBoth = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ? AND has_env_tag = 1 AND has_service_tag = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withBoth;
    const percentage = pct(withBoth, total);
    const passed = percentage >= 75;

    return {
      ruleId: 'ust-004', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'unified_tagging', ruleId: 'ust-004', ruleName: 'Monitor env/service tags',
        severity: 'medium',
        title: `${missing} monitor(s) missing env or service tags (${percentage}% have both)`,
        description: `Monitors without env/service tags cannot be filtered by environment or service in dashboards and escalation policies.`,
        impact: 'Incident response is slower when on-call engineers cannot filter monitors by service or environment.',
        recommendation: 'Add env:<env> and service:<service> tags to all monitors. Use Terraform or monitor templates to enforce standards.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withBoth}/${total} monitors have both env and service tags`, value: percentage, source: '/api/v1/monitor' }],
      }],
    };
  },
};

const syntheticsTagRule: AssessmentRule = {
  id: 'ust-005',
  name: 'Synthetics env/service tag coverage',
  category: 'unified_tagging',
  severity: 'low',
  description: 'Synthetics tests should be tagged with env and service',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withBoth = (db.prepare('SELECT COUNT(*) as c FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ? AND has_env_tag = 1 AND has_service_tag = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withBoth;
    const percentage = pct(withBoth, total);
    const passed = percentage >= 70;

    return {
      ruleId: 'ust-005', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'unified_tagging', ruleId: 'ust-005', ruleName: 'Synthetics env/service tags',
        severity: 'low',
        title: `${missing} synthetics test(s) missing env or service tags (${percentage}% coverage)`,
        description: `Synthetics tests without env/service tags cannot be correlated with APM and infrastructure signals.`,
        impact: 'Difficult to filter test results by environment or service during incidents.',
        recommendation: 'Add env and service tags to all Synthetics tests during creation or via bulk update.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withBoth}/${total} synthetics tests have env+service tags`, value: percentage, source: '/api/v1/synthetics/tests' }],
      }],
    };
  },
};

export const unifiedTaggingRules: AssessmentRule[] = [
  envTagRule,
  serviceTagHostRule,
  versionTagRule,
  monitorTagRule,
  syntheticsTagRule,
];

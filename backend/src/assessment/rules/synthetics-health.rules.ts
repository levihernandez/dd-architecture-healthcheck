import type { AssessmentRule, AssessmentContext, RuleResult } from '../../types/assessment.types';

function pct(count: number, total: number): number {
  return total === 0 ? 100 : Math.round((count / total) * 100);
}

const syntheticsWithoutNotificationsRule: AssessmentRule = {
  id: 'syn-001',
  name: 'Synthetics tests without notifications',
  category: 'synthetics_health',
  severity: 'medium',
  description: 'Synthetic test failures should trigger notifications',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withNotif = (db.prepare('SELECT COUNT(*) as c FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ? AND has_notification = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withNotif;
    const percentage = pct(withNotif, total);
    const passed = percentage >= 80;

    return {
      ruleId: 'syn-001', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'synthetics_health', ruleId: 'syn-001', ruleName: 'Synthetics without notifications',
        severity: 'medium',
        title: `${missing} synthetics test(s) have no notification routing`,
        description: `Tests without notifications will not alert on-call when critical user journeys fail.`,
        impact: 'Silent test failures go unnoticed, potentially letting customer-facing issues linger.',
        recommendation: 'Add notification handles (@pagerduty, @slack-channel) to all Synthetics tests. Link tests to monitors for unified alerting.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withNotif}/${total} tests have notifications`, value: percentage, source: '/api/v1/synthetics/tests' }],
      }],
    };
  },
};

const syntheticsLocationCoverageRule: AssessmentRule = {
  id: 'syn-002',
  name: 'Synthetics single-location tests',
  category: 'synthetics_health',
  severity: 'low',
  description: 'Tests should run from multiple locations to avoid false positives',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const singleLoc = (db.prepare('SELECT COUNT(*) as c FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ? AND location_count = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const percentage = pct(singleLoc, total);
    const passed = percentage < 30;

    return {
      ruleId: 'syn-002', passed, score: Math.max(0, 100 - percentage), maxScore: 100,
      findings: passed ? [] : [{
        category: 'synthetics_health', ruleId: 'syn-002', ruleName: 'Single-location synthetics',
        severity: 'low',
        title: `${singleLoc} synthetics test(s) run from only 1 location`,
        description: `Single-location tests are prone to false positives from regional Datadog infrastructure issues.`,
        impact: 'False positive alerts from regional outages cause alert fatigue and erode trust in synthetic monitoring.',
        recommendation: 'Configure at least 2-3 locations per test, spanning different geographic regions relevant to your user base.',
        affectedCount: singleLoc, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${singleLoc}/${total} tests have 1 location`, value: singleLoc, source: '/api/v1/synthetics/tests' }],
      }],
    };
  },
};

export const syntheticsHealthRules: AssessmentRule[] = [
  syntheticsWithoutNotificationsRule,
  syntheticsLocationCoverageRule,
];

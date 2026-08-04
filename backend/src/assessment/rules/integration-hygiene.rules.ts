import type { AssessmentRule, AssessmentContext, RuleResult } from '../../types/assessment.types';

const cloudIntegrationCoverageRule: AssessmentRule = {
  id: 'int-001',
  name: 'Cloud integration coverage',
  category: 'integration_hygiene',
  severity: 'medium',
  description: 'Cloud integrations should be configured for all detected cloud accounts',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM cloud_accounts WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withErrors = (db.prepare('SELECT COUNT(*) as c FROM cloud_accounts WHERE org_id = ? AND scan_run_id = ? AND has_errors = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const passed = withErrors === 0;

    return {
      ruleId: 'int-001', passed, score: total === 0 ? 100 : Math.max(0, 100 - withErrors * 20), maxScore: 100,
      findings: passed ? [] : [{
        category: 'integration_hygiene', ruleId: 'int-001', ruleName: 'Cloud integration errors',
        severity: 'high',
        title: `${withErrors} cloud account(s) have integration errors`,
        description: `Cloud accounts with errors may be missing metrics, generating gaps in infrastructure visibility.`,
        impact: 'Cloud resource metrics and tags are not being collected, creating blind spots in cloud infrastructure monitoring.',
        recommendation: 'Review cloud integration configuration. Verify IAM roles/permissions. Check for expired credentials or removed resources.',
        affectedCount: withErrors, totalCount: total, percentage: total === 0 ? 0 : Math.round((withErrors / total) * 100),
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withErrors}/${total} cloud accounts have errors`, value: withErrors, source: '/api/v1/integration/aws' }],
      }],
    };
  },
};

const notificationIntegrationRule: AssessmentRule = {
  id: 'int-002',
  name: 'Notification integrations',
  category: 'integration_hygiene',
  severity: 'high',
  description: 'At least one notification integration (PagerDuty, Slack, etc.) should be configured',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const notifIntegrations = db.prepare(`
      SELECT COUNT(*) as c FROM integrations
      WHERE org_id = ? AND scan_run_id = ? AND integration_type = 'notification' AND is_configured = 1
    `).get(orgId, scanRunId) as { c: number };
    const hasNotif = (notifIntegrations?.c ?? 0) > 0;

    return {
      ruleId: 'int-002', passed: hasNotif, score: hasNotif ? 100 : 0, maxScore: 100,
      findings: hasNotif ? [] : [{
        category: 'integration_hygiene', ruleId: 'int-002', ruleName: 'Notification integrations',
        severity: 'high',
        title: 'No notification integrations detected (PagerDuty/Slack/Webhooks)',
        description: `Without notification integrations, monitor alerts can only be delivered by email.`,
        impact: 'Email-only alerting is slow and unreliable for on-call scenarios. Incident response will be delayed.',
        recommendation: 'Configure PagerDuty for on-call paging and Slack for team notifications. Both are available in the Datadog Integrations page.',
        affectedCount: 0, totalCount: 0, percentage: 0,
        affectedResources: [],
        evidence: [{ type: 'config_gap' as const, description: 'No PagerDuty, Slack, or Webhook integrations found', source: '/api/v1/integration' }],
      }],
    };
  },
};

export const integrationHygieneRules: AssessmentRule[] = [
  cloudIntegrationCoverageRule,
  notificationIntegrationRule,
];

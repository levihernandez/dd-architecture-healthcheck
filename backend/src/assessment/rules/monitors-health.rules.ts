import type { AssessmentRule, AssessmentContext, RuleResult } from '../../types/assessment.types';

function pct(count: number, total: number): number {
  return total === 0 ? 100 : Math.round((count / total) * 100);
}

const mutedMonitorsRule: AssessmentRule = {
  id: 'mon-001',
  name: 'Long-muted monitors',
  category: 'monitors_health',
  severity: 'high',
  description: 'Monitors muted indefinitely represent blind spots in alerting coverage',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const muted = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ? AND is_muted = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const percentage = pct(muted, total);
    const passed = percentage < 10;

    return {
      ruleId: 'mon-001', passed, score: Math.max(0, 100 - percentage * 2), maxScore: 100,
      findings: passed ? [] : [{
        category: 'monitors_health', ruleId: 'mon-001', ruleName: 'Long-muted monitors',
        severity: percentage > 25 ? 'high' : 'medium',
        title: `${muted} monitor(s) are currently muted (${percentage}% of all monitors)`,
        description: `Muted monitors generate no alerts, creating potential blind spots in your alerting coverage.`,
        impact: 'Real incidents may go undetected if critical monitors remain muted past their intended window.',
        recommendation: 'Audit all muted monitors. Remove stale mutes, schedule downtime instead of muting, and implement a mute expiry review process.',
        affectedCount: muted, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${muted}/${total} monitors are muted`, value: muted, source: '/api/v1/monitor' }],
      }],
    };
  },
};

const monitorsWithoutPriorityRule: AssessmentRule = {
  id: 'mon-002',
  name: 'Monitors without priority',
  category: 'monitors_health',
  severity: 'medium',
  description: 'Monitors should have priority levels for effective on-call triage',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withPriority = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ? AND priority IS NOT NULL').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withPriority;
    const percentage = pct(withPriority, total);
    const passed = percentage >= 80;

    return {
      ruleId: 'mon-002', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'monitors_health', ruleId: 'mon-002', ruleName: 'Monitors without priority',
        severity: 'medium',
        title: `${missing} monitor(s) have no priority set (${percentage}% have priority)`,
        description: `Monitor priorities help on-call teams triage alerts effectively. P1-P5 provides a clear urgency signal.`,
        impact: 'All alerts look equally urgent, causing alert fatigue and slower response to critical issues.',
        recommendation: 'Set priority levels for all monitors. P1-P2 for customer-impacting, P3 for degradation, P4-P5 for informational.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withPriority}/${total} monitors have priority`, value: percentage, source: '/api/v1/monitor' }],
      }],
    };
  },
};

const monitorsWithoutNotificationsRule: AssessmentRule = {
  id: 'mon-003',
  name: 'Monitors without notification routing',
  category: 'monitors_health',
  severity: 'high',
  description: 'Monitors need notification routing to alert the right people',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withNotification = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ? AND has_notification = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withNotification;
    const percentage = pct(withNotification, total);
    const passed = percentage >= 90;

    return {
      ruleId: 'mon-003', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'monitors_health', ruleId: 'mon-003', ruleName: 'Monitors without notifications',
        severity: percentage < 70 ? 'high' : 'medium',
        title: `${missing} monitor(s) have no notification routing (${percentage}% have notifications)`,
        description: `Monitors without @-mentions or notification handles will not alert anyone when they fire.`,
        impact: 'Silent monitors provide no operational value and create a false sense of security.',
        recommendation: 'Add @pagerduty, @slack-channel, or @email notifications to all monitors. Use monitor notification templates for consistency.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withNotification}/${total} monitors have notifications`, value: percentage, source: '/api/v1/monitor' }],
      }],
    };
  },
};

const alertingMonitorsRule: AssessmentRule = {
  id: 'mon-004',
  name: 'Monitors in persistent alert state',
  category: 'monitors_health',
  severity: 'medium',
  description: 'Monitors stuck in ALERT state for extended periods indicate alert fatigue or stale monitors',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const alerting = (db.prepare(
      "SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ? AND overall_state IN ('Alert', 'ALERT')"
    ).get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const total = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const percentage = pct(alerting, total);
    const passed = percentage < 20;

    return {
      ruleId: 'mon-004', passed, score: Math.max(0, 100 - percentage), maxScore: 100,
      findings: passed ? [] : [{
        category: 'monitors_health', ruleId: 'mon-004', ruleName: 'Monitors in persistent alert state',
        severity: 'medium',
        title: `${alerting} monitor(s) currently in ALERT state (${percentage}% of monitors)`,
        description: `A high percentage of monitors in ALERT state suggests alert fatigue, misconfigured thresholds, or genuine ongoing incidents.`,
        impact: 'Alert fatigue leads engineers to ignore notifications, potentially missing real incidents.',
        recommendation: 'Review all alerting monitors. Adjust thresholds for chronic alerters, investigate underlying issues, or archive obsolete monitors.',
        affectedCount: alerting, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${alerting}/${total} monitors are alerting`, value: alerting, source: '/api/v1/monitor' }],
      }],
    };
  },
};

export const monitorsHealthRules: AssessmentRule[] = [
  mutedMonitorsRule,
  monitorsWithoutPriorityRule,
  monitorsWithoutNotificationsRule,
  alertingMonitorsRule,
];

import type { AssessmentRule, AssessmentContext, RuleResult } from '../../types/assessment.types';

function pct(count: number, total: number): number {
  return total === 0 ? 100 : Math.round((count / total) * 100);
}

const dashboardsWithoutTemplateVarsRule: AssessmentRule = {
  id: 'dash-001',
  name: 'Dashboards without template variables',
  category: 'dashboards_health',
  severity: 'low',
  description: 'Dashboards should use template variables to enable env/service filtering',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM dashboards WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withVars = (db.prepare('SELECT COUNT(*) as c FROM dashboards WHERE org_id = ? AND scan_run_id = ? AND has_template_variables = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withVars;
    const percentage = pct(withVars, total);
    const passed = percentage >= 70;

    return {
      ruleId: 'dash-001', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'dashboards_health', ruleId: 'dash-001', ruleName: 'Dashboards without template variables',
        severity: 'low',
        title: `${missing} dashboard(s) lack template variables (${percentage}% have them)`,
        description: `Template variables allow dashboards to be scoped by env, service, region, etc., making them reusable.`,
        impact: 'Dashboards without template variables are hard-coded to specific values, requiring duplication for each environment.',
        recommendation: 'Add env, service, and region template variables to operational dashboards. Use $env and $service in all widget queries.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withVars}/${total} dashboards have template variables`, value: percentage, source: '/api/v1/dashboard' }],
      }],
    };
  },
};

const lowWidgetDashboardsRule: AssessmentRule = {
  id: 'dash-002',
  name: 'Empty or sparse dashboards',
  category: 'dashboards_health',
  severity: 'info',
  description: 'Dashboards with very few widgets may be unused or incomplete',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const sparse = (db.prepare(
      'SELECT COUNT(*) as c FROM dashboards WHERE org_id = ? AND scan_run_id = ? AND widget_count < 3'
    ).get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const total = (db.prepare('SELECT COUNT(*) as c FROM dashboards WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const percentage = pct(sparse, total);
    const passed = percentage < 20;

    return {
      ruleId: 'dash-002', passed, score: Math.max(0, 100 - percentage), maxScore: 100,
      findings: passed ? [] : [{
        category: 'dashboards_health', ruleId: 'dash-002', ruleName: 'Sparse dashboards',
        severity: 'info',
        title: `${sparse} dashboard(s) have fewer than 3 widgets`,
        description: `Dashboards with very few widgets are likely incomplete, unused, or placeholder boards.`,
        impact: 'Dashboard clutter makes it harder for engineers to find useful observability resources.',
        recommendation: 'Review sparse dashboards. Delete unused ones or complete them. Implement a periodic dashboard hygiene review.',
        affectedCount: sparse, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${sparse}/${total} dashboards have < 3 widgets`, value: sparse, source: '/api/v1/dashboard' }],
      }],
    };
  },
};

export const dashboardsHealthRules: AssessmentRule[] = [
  dashboardsWithoutTemplateVarsRule,
  lowWidgetDashboardsRule,
];

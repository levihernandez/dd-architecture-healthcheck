import type { AssessmentRule, AssessmentContext, RuleResult } from '../../types/assessment.types';

const teamCoverageRule: AssessmentRule = {
  id: 'gov-001',
  name: 'Team structure',
  category: 'governance',
  severity: 'medium',
  description: 'Organization should have teams defined for ownership tracking',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const teamCount = Number(
      (await db('resources')
        .where({ org_id: orgId, scan_run_id: scanRunId, resource_type: 'team' })
        .count({ c: '*' })
        .first())?.c ?? 0
    );
    const passed = teamCount >= 2;

    return {
      ruleId: 'gov-001', passed, score: Math.min(100, teamCount * 20), maxScore: 100,
      findings: passed ? [] : [{
        category: 'governance', ruleId: 'gov-001', ruleName: 'Team structure',
        severity: 'medium',
        title: teamCount === 0 ? 'No teams defined in Datadog' : `Only ${teamCount} team(s) defined`,
        description: `Teams enable ownership tracking, on-call routing, and service ownership in the Service Catalog.`,
        impact: 'Without teams, service ownership is unclear and on-call routing must be configured manually per monitor.',
        recommendation: 'Create Datadog Teams for each engineering team. Assign services in the Service Catalog to their owning teams.',
        affectedCount: 0, totalCount: 0, percentage: 0,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${teamCount} teams found`, value: teamCount, source: '/api/v2/teams' }],
      }],
    };
  },
};

const ssoStatusRule: AssessmentRule = {
  id: 'gov-002',
  name: 'SSO configuration status',
  category: 'governance',
  severity: 'info',
  description: 'High-level SSO enablement status check (no sensitive config collected)',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const ssoSignal = await db<{ org_id: string; scan_run_id: string; product: string; signal: string; value: string }>('product_usage_signals')
      .select('value')
      .where({ org_id: orgId, scan_run_id: scanRunId, product: 'governance', signal: 'sso_status' })
      .first();

    if (!ssoSignal) {
      return { ruleId: 'gov-002', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    let status: { saml_enabled?: boolean; saml_strict_mode?: boolean } = {};
    try { status = JSON.parse(ssoSignal.value); } catch { /* ignore */ }

    const passed = Boolean(status.saml_enabled);

    return {
      ruleId: 'gov-002', passed, score: passed ? 100 : 60, maxScore: 100,
      findings: passed ? [] : [{
        category: 'governance', ruleId: 'gov-002', ruleName: 'SSO configuration',
        severity: 'info',
        title: 'SAML/SSO does not appear to be enabled',
        description: 'SSO provides centralized authentication and simplifies user lifecycle management.',
        impact: 'Without SSO, users must manage separate Datadog credentials. Offboarding requires manual deactivation.',
        recommendation: 'Enable SAML SSO integration with your identity provider (Okta, Azure AD, etc.). Enable strict mode to require SSO for all users.',
        affectedCount: 0, totalCount: 0, percentage: 0,
        affectedResources: [],
        evidence: [{ type: 'config_gap' as const, description: 'SAML SSO not enabled (high-level signal only)', source: '/api/v1/org' }],
      }],
    };
  },
};

export const governanceRules: AssessmentRule[] = [
  teamCoverageRule,
  ssoStatusRule,
];

import type { AssessmentRule, AssessmentContext, RuleResult } from '../../types/assessment.types';

function pct(count: number, total: number): number {
  return total === 0 ? 100 : Math.round((count / total) * 100);
}

const missingServiceCatalogRule: AssessmentRule = {
  id: 'svc-001',
  name: 'Service catalog coverage',
  category: 'service_architecture',
  severity: 'high',
  description: 'All APM services should have service catalog entries with ownership',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withCatalog = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ? AND has_service_catalog = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withCatalog;
    const percentage = pct(withCatalog, total);
    const passed = percentage >= 80;

    const affectedServices = missing > 0
      ? (db.prepare('SELECT service_name FROM services WHERE org_id = ? AND scan_run_id = ? AND has_service_catalog = 0 LIMIT 20').all(orgId, scanRunId) as Array<{ service_name: string }>)
      : [];

    return {
      ruleId: 'svc-001', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'service_architecture', ruleId: 'svc-001', ruleName: 'Service catalog coverage',
        severity: percentage < 50 ? 'high' : 'medium',
        title: `${missing} APM service(s) missing service catalog entry (${percentage}% coverage)`,
        description: `Service catalog provides ownership, runbooks, team mapping, and lifecycle metadata. ${missing} services lack catalog entries.`,
        impact: 'During incidents, engineers cannot determine who owns the service or find runbooks. Onboarding is slower. Service dependencies are opaque.',
        recommendation: 'Create service catalog entries for all APM services using the Datadog UI, Terraform provider, or GitHub integration. Include team, tier, lifecycle, and contact information.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: affectedServices.map((s) => ({ type: 'service', id: s.service_name, name: s.service_name })),
        evidence: [{ type: 'count' as const, description: `${withCatalog}/${total} services have catalog entries`, value: percentage, source: '/api/v2/catalog/entity' }],
      }],
    };
  },
};

const servicesWithoutMonitorsRule: AssessmentRule = {
  id: 'svc-002',
  name: 'Services without monitors',
  category: 'service_architecture',
  severity: 'high',
  description: 'Every production service should have at least one monitor',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withMonitor = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ? AND has_monitor = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withMonitor;
    const percentage = pct(withMonitor, total);
    const passed = percentage >= 90;

    return {
      ruleId: 'svc-002', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'service_architecture', ruleId: 'svc-002', ruleName: 'Services without monitors',
        severity: percentage < 50 ? 'critical' : 'high',
        title: `${missing} service(s) have no associated monitors (${percentage}% monitored)`,
        description: `Services without monitors cannot alert on degradation or outages.`,
        impact: 'Silent failures will go undetected until customers report issues.',
        recommendation: 'Create at minimum an APM error rate and latency monitor for each service. Use Datadog\'s Watchdog or APM monitor templates as a starting point.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withMonitor}/${total} services have monitors`, value: percentage, source: '/api/v1/services' }],
      }],
    };
  },
};

const servicesWithoutSLOsRule: AssessmentRule = {
  id: 'svc-003',
  name: 'Services without SLOs',
  category: 'service_architecture',
  severity: 'medium',
  description: 'Production services should have SLOs defining reliability targets',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withSLO = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ? AND has_slo = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withSLO;
    const percentage = pct(withSLO, total);
    const passed = percentage >= 60;

    return {
      ruleId: 'svc-003', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'service_architecture', ruleId: 'svc-003', ruleName: 'Services without SLOs',
        severity: 'medium',
        title: `${missing} service(s) have no SLOs defined (${percentage}% have SLOs)`,
        description: `SLOs formalize reliability targets and provide error budgets for engineering decision-making.`,
        impact: 'Without SLOs, teams cannot objectively communicate reliability posture to stakeholders or make data-driven release decisions.',
        recommendation: 'Define SLOs for critical services starting with availability (error rate < x%) and latency (p99 < xms). Use APM or metric-based SLOs.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withSLO}/${total} services have SLOs`, value: percentage, source: '/api/v1/slo' }],
      }],
    };
  },
};

const servicesWithoutOwnerRule: AssessmentRule = {
  id: 'svc-004',
  name: 'Services missing ownership',
  category: 'service_architecture',
  severity: 'high',
  description: 'Every service should have a declared owner/team',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;
    const total = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withOwner = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ? AND has_owner = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const missing = total - withOwner;
    const percentage = pct(withOwner, total);
    const passed = percentage >= 85;

    return {
      ruleId: 'svc-004', passed, score: percentage, maxScore: 100,
      findings: passed ? [] : [{
        category: 'service_architecture', ruleId: 'svc-004', ruleName: 'Services missing ownership',
        severity: 'high',
        title: `${missing} service(s) have no declared team/owner (${percentage}% have owners)`,
        description: `Services without owners create toil during incidents: on-call engineers don't know who to contact.`,
        impact: 'Longer MTTR, unclear accountability, and difficulty prioritizing technical debt.',
        recommendation: 'Add team ownership via service catalog entries or the team tag. Ensure all services in the Service Catalog have a team field populated.',
        affectedCount: missing, totalCount: total, percentage,
        affectedResources: [],
        evidence: [{ type: 'count' as const, description: `${withOwner}/${total} services have owners`, value: percentage, source: '/api/v2/catalog/entity' }],
      }],
    };
  },
};

export const serviceArchitectureRules: AssessmentRule[] = [
  missingServiceCatalogRule,
  servicesWithoutMonitorsRule,
  servicesWithoutSLOsRule,
  servicesWithoutOwnerRule,
];

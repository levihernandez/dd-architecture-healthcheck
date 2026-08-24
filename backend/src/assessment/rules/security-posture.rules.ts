import type { AssessmentRule, AssessmentContext, RuleResult } from '../../types/assessment.types';

const STALE_INCIDENT_DAYS = 7;

const unresolvedCriticalFindingsRule: AssessmentRule = {
  id: 'sec-001',
  name: 'Unresolved critical/high security findings',
  category: 'security_posture',
  severity: 'critical',
  description: 'Critical and high-severity security findings (CSPM/AppSec/Cloud SIEM) should be triaged and resolved',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;

    const total = Number(
      (await db('security_findings').where({ org_id: orgId, scan_run_id: scanRunId }).count({ c: '*' }).first())?.c ?? 0
    );

    const unresolved = await db<{ org_id: string; scan_run_id: string; status: string | null; finding_id: string; category: string; severity: string; resource_name: string | null; rule_name: string | null }>('security_findings')
      .select('finding_id', 'category', 'severity', 'resource_name', 'rule_name')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .whereIn('severity', ['critical', 'high'])
      .where((builder) => builder.whereNull('status').orWhereNotIn('status', ['resolved', 'muted', 'skipped']))
      .limit(20);

    if (unresolved.length === 0) {
      return { ruleId: 'sec-001', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    const percentage = total === 0 ? 0 : Math.round(((total - unresolved.length) / total) * 100);

    return {
      ruleId: 'sec-001', passed: false, score: Math.max(0, 100 - unresolved.length * 10), maxScore: 100,
      findings: [{
        category: 'security_posture', ruleId: 'sec-001', ruleName: 'Unresolved critical/high security findings',
        severity: 'critical',
        title: `${unresolved.length} unresolved critical/high security finding(s)`,
        description: `${unresolved.length} of ${total} security findings are critical or high severity and not yet resolved or muted, spanning ${new Set(unresolved.map((f) => f.category)).size} categor(y/ies).`,
        impact: 'Unresolved high-severity security findings (misconfigurations, exposed resources, detected threats) represent live risk until triaged.',
        recommendation: 'Triage each finding in Datadog Cloud Security Management — resolve, mute with justification, or assign an owner.',
        affectedCount: unresolved.length, totalCount: total, percentage,
        affectedResources: unresolved.map((f) => ({ type: 'security_finding', id: f.finding_id, name: f.resource_name ?? f.rule_name ?? f.finding_id })),
        evidence: [{ type: 'count', description: `${unresolved.length} unresolved of ${total} total findings`, source: '/api/v2/security_monitoring/findings' }],
      }],
    };
  },
};

const staleIncidentsRule: AssessmentRule = {
  id: 'sec-002',
  name: 'Incidents open longer than a week',
  category: 'security_posture',
  severity: 'high',
  description: 'Incidents left open for an extended period risk losing context and delaying resolution',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;

    const cutoff = new Date(Date.now() - STALE_INCIDENT_DAYS * 86400_000).toISOString();

    const total = Number(
      (await db('incidents')
        .where({ org_id: orgId, scan_run_id: scanRunId })
        .where((builder) => builder.whereNull('state').orWhere('state', '!=', 'resolved'))
        .count({ c: '*' })
        .first())?.c ?? 0
    );

    const stale = await db<{ org_id: string; scan_run_id: string; state: string | null; incident_id: string; title: string | null; severity: string | null; created_at_dd: string }>('incidents')
      .select('incident_id', 'title', 'severity', 'created_at_dd')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .where((builder) => builder.whereNull('state').orWhere('state', '!=', 'resolved'))
      .whereNotNull('created_at_dd')
      .where('created_at_dd', '<', cutoff)
      .limit(20);

    if (stale.length === 0) {
      return { ruleId: 'sec-002', passed: true, score: 100, maxScore: 100, findings: [] };
    }

    const percentage = total === 0 ? 0 : Math.round(((total - stale.length) / total) * 100);

    return {
      ruleId: 'sec-002', passed: false, score: Math.max(0, 100 - stale.length * 15), maxScore: 100,
      findings: [{
        category: 'security_posture', ruleId: 'sec-002', ruleName: 'Incidents open longer than a week',
        severity: 'high',
        title: `${stale.length} incident(s) open longer than ${STALE_INCIDENT_DAYS} days`,
        description: `${stale.length} of ${total} open incidents were created more than ${STALE_INCIDENT_DAYS} days ago and haven't been resolved.`,
        impact: 'Long-running open incidents risk losing context, delaying customer-facing resolution, and skewing incident metrics.',
        recommendation: 'Review each stale incident — resolve, downgrade, or explicitly document why it remains open.',
        affectedCount: stale.length, totalCount: total, percentage,
        affectedResources: stale.map((i) => ({ type: 'incident', id: i.incident_id, name: i.title ?? i.incident_id })),
        evidence: [{ type: 'count', description: `${stale.length} of ${total} open incidents are stale`, source: '/api/v2/incidents' }],
      }],
    };
  },
};

export const securityPostureRules: AssessmentRule[] = [
  unresolvedCriticalFindingsRule,
  staleIncidentsRule,
];

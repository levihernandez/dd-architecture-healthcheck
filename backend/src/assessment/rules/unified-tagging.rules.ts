import type { AssessmentRule, AssessmentContext, RuleResult, AffectedResource } from '../../types/assessment.types';
import { recommendationForTagKey, severityFromPriority } from '../../tagging/recommendation';
import { lookupTag } from '../../tagging/tag-dictionary';

const AFFECTED_CAP = 25;

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
          `SELECT host_name FROM hosts WHERE org_id = ? AND scan_run_id = ? AND has_env_tag = 0 LIMIT ${AFFECTED_CAP}`
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
        tagKey: 'env',
        bestPractice: recommendationForTagKey('env'),
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

    const affectedServices = missing > 0
      ? (db.prepare(
          `SELECT service_name, env FROM services WHERE org_id = ? AND scan_run_id = ? AND has_version_tag = 0 LIMIT ${AFFECTED_CAP}`
        ).all(orgId, scanRunId) as Array<{ service_name: string; env: string | null }>)
      : [];

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
        affectedResources: affectedServices.map((s) => ({
          type: 'service', id: `${s.service_name}:${s.env ?? 'unknown'}`, name: s.service_name,
        })),
        evidence: [{ type: 'count' as const, description: `${withVersion}/${total} services report version`, value: percentage, source: '/api/v1/services' }],
        tagKey: 'version',
        bestPractice: recommendationForTagKey('version'),
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

    // Primary tagKey chosen as 'service' rather than 'env': env coverage is
    // already surfaced in detail by ust-001, so the more useful drill-down
    // here — and the one that most directly affects on-call routing — is
    // which monitors lack a service tag. Both columns still gate whether the
    // monitor is flagged (has_env_tag AND has_service_tag), only the
    // recommendation/tagKey attached to the finding is narrowed to 'service'.
    const affectedMonitors = missing > 0
      ? (db.prepare(
          `SELECT monitor_id, monitor_name FROM monitors WHERE org_id = ? AND scan_run_id = ? AND (has_env_tag = 0 OR has_service_tag = 0) LIMIT ${AFFECTED_CAP}`
        ).all(orgId, scanRunId) as Array<{ monitor_id: number; monitor_name: string | null }>)
      : [];

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
        affectedResources: affectedMonitors.map((m) => ({
          type: 'monitor', id: String(m.monitor_id), name: m.monitor_name ?? `Monitor ${m.monitor_id}`,
        })),
        evidence: [{ type: 'count' as const, description: `${withBoth}/${total} monitors have both env and service tags`, value: percentage, source: '/api/v1/monitor' }],
        tagKey: 'service',
        bestPractice: recommendationForTagKey('service'),
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

    // Same choice as ust-004: 'service' is the primary tagKey for this
    // finding since env coverage is already covered in detail by ust-001.
    const affectedTests = missing > 0
      ? (db.prepare(
          `SELECT public_id, test_name FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ? AND (has_env_tag = 0 OR has_service_tag = 0) LIMIT ${AFFECTED_CAP}`
        ).all(orgId, scanRunId) as Array<{ public_id: string; test_name: string | null }>)
      : [];

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
        affectedResources: affectedTests.map((t) => ({
          type: 'synthetics_test', id: t.public_id, name: t.test_name ?? t.public_id,
        })),
        evidence: [{ type: 'count' as const, description: `${withBoth}/${total} synthetics tests have env+service tags`, value: percentage, source: '/api/v1/synthetics/tests' }],
        tagKey: 'service',
        bestPractice: recommendationForTagKey('service'),
      }],
    };
  },
};

const teamTagDef = lookupTag('team');
const teamTagSeverity = severityFromPriority(teamTagDef?.priority ?? 'critical');

const teamTagRule: AssessmentRule = {
  id: 'ust-006',
  name: 'Team tag coverage',
  category: 'unified_tagging',
  severity: teamTagSeverity,
  description: 'Hosts, monitors, and APM services should carry a team tag for ownership and routing',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;

    const hostTotal = (db.prepare('SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const hostWithTeam = (db.prepare('SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ? AND has_team_tag = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;

    const monitorTotal = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const monitorWithTeam = (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ? AND has_team_tag = 1').get(orgId, scanRunId) as { c: number })?.c ?? 0;

    // services table has a direct `team` text column (populated from the APM
    // services endpoint's `team` field) rather than a has_team_tag flag.
    const serviceTotal = (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const serviceWithTeam = (db.prepare(
      "SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ? AND team IS NOT NULL AND team != ''"
    ).get(orgId, scanRunId) as { c: number })?.c ?? 0;

    const total = hostTotal + monitorTotal + serviceTotal;
    const withTeam = hostWithTeam + monitorWithTeam + serviceWithTeam;
    const missing = total - withTeam;
    const percentage = pct(withTeam, total);
    const passed = percentage >= 90;

    const affectedResources: AffectedResource[] = [];
    if (!passed) {
      const missingHosts = db.prepare(
        `SELECT host_name FROM hosts WHERE org_id = ? AND scan_run_id = ? AND has_team_tag = 0 LIMIT ${AFFECTED_CAP}`
      ).all(orgId, scanRunId) as Array<{ host_name: string }>;
      affectedResources.push(...missingHosts.map((h) => ({ type: 'host', id: h.host_name, name: h.host_name })));

      if (affectedResources.length < AFFECTED_CAP) {
        const missingMonitors = db.prepare(
          `SELECT monitor_id, monitor_name FROM monitors WHERE org_id = ? AND scan_run_id = ? AND has_team_tag = 0 LIMIT ${AFFECTED_CAP - affectedResources.length}`
        ).all(orgId, scanRunId) as Array<{ monitor_id: number; monitor_name: string | null }>;
        affectedResources.push(...missingMonitors.map((m) => ({ type: 'monitor', id: String(m.monitor_id), name: m.monitor_name ?? `Monitor ${m.monitor_id}` })));
      }

      if (affectedResources.length < AFFECTED_CAP) {
        const missingServices = db.prepare(
          `SELECT service_name, env FROM services WHERE org_id = ? AND scan_run_id = ? AND (team IS NULL OR team = '') LIMIT ${AFFECTED_CAP - affectedResources.length}`
        ).all(orgId, scanRunId) as Array<{ service_name: string; env: string | null }>;
        affectedResources.push(...missingServices.map((s) => ({ type: 'service', id: `${s.service_name}:${s.env ?? 'unknown'}`, name: s.service_name })));
      }
    }

    return {
      ruleId: 'ust-006',
      passed,
      score: percentage,
      maxScore: 100,
      findings: passed ? [] : [{
        category: 'unified_tagging',
        ruleId: 'ust-006',
        ruleName: 'Team tag coverage',
        severity: teamTagSeverity,
        title: `${missing} resource(s) missing team tag (${percentage}% coverage)`,
        description: `Team tags enable alert routing, incident ownership, and cost chargeback. ${missing} of ${total} hosts/monitors/services are missing this tag.`,
        impact: 'Alerts and incidents on untagged resources have no clear owner, slowing escalation and accountability.',
        recommendation: 'Add team:<name> matching the Datadog Teams handle to all hosts (agent extra_tags), monitors (tags array), and APM services.',
        affectedCount: missing,
        totalCount: total,
        percentage,
        affectedResources,
        evidence: [
          { type: 'count' as const, description: `${hostWithTeam}/${hostTotal} hosts, ${monitorWithTeam}/${monitorTotal} monitors, ${serviceWithTeam}/${serviceTotal} services have team tag`, value: percentage, source: '/api/v1/hosts, /api/v1/monitor, /api/v1/services' },
        ],
        tagKey: 'team',
        bestPractice: recommendationForTagKey('team'),
      }],
    };
  },
};

const applicationTagDef = lookupTag('application');
const applicationTagSeverity = severityFromPriority(applicationTagDef?.priority ?? 'critical');
// aliases from the tag dictionary's 'application' entry
const APPLICATION_TAG_KEYS = ['application', ...(applicationTagDef?.aliases ?? ['app_group', 'workload'])];
const APPLICATION_TAG_PLACEHOLDERS = APPLICATION_TAG_KEYS.map(() => '?').join(', ');

const applicationTagRule: AssessmentRule = {
  id: 'ust-007',
  name: 'Application tag coverage',
  category: 'unified_tagging',
  severity: applicationTagSeverity,
  description: 'Hosts and services should carry an application tag grouping them into a business workload',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;

    // Hosts: resource_tags is populated for resource_type='host' by the
    // infrastructure collector, so we can check tag presence directly.
    const hostTotal = (db.prepare('SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const hostWithApplication = (db.prepare(
      `SELECT COUNT(DISTINCT resource_id) as c FROM resource_tags
       WHERE org_id = ? AND scan_run_id = ? AND resource_type = 'host' AND tag_key IN (${APPLICATION_TAG_PLACEHOLDERS})`
    ).get(orgId, scanRunId, ...APPLICATION_TAG_KEYS) as { c: number })?.c ?? 0;

    // Services: no resource_tags rows exist for resource_type='service', so
    // fall back to the service_catalog.tags JSON blob (array of "key:value"
    // strings) as a best-effort text search.
    const serviceTotal = (db.prepare('SELECT COUNT(*) as c FROM service_catalog WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const likeClauses = APPLICATION_TAG_KEYS.map((k) => `tags LIKE '%${k}:%'`).join(' OR ');
    const serviceWithApplication = serviceTotal > 0
      ? (db.prepare(
          `SELECT COUNT(*) as c FROM service_catalog WHERE org_id = ? AND scan_run_id = ? AND (${likeClauses})`
        ).get(orgId, scanRunId) as { c: number })?.c ?? 0
      : 0;

    const total = hostTotal + serviceTotal;
    const withApplication = hostWithApplication + serviceWithApplication;
    const missing = total - withApplication;
    const percentage = pct(withApplication, total);
    const passed = percentage >= 70;

    const affectedResources: AffectedResource[] = [];
    if (!passed) {
      const missingHosts = db.prepare(
        `SELECT h.host_name FROM hosts h
         WHERE h.org_id = ? AND h.scan_run_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM resource_tags rt
             WHERE rt.org_id = h.org_id AND rt.scan_run_id = h.scan_run_id
               AND rt.resource_type = 'host' AND rt.resource_id = h.host_name
               AND rt.tag_key IN (${APPLICATION_TAG_PLACEHOLDERS})
           )
         LIMIT ${AFFECTED_CAP}`
      ).all(orgId, scanRunId, ...APPLICATION_TAG_KEYS) as Array<{ host_name: string }>;
      affectedResources.push(...missingHosts.map((h) => ({ type: 'host', id: h.host_name, name: h.host_name })));

      if (affectedResources.length < AFFECTED_CAP) {
        const missingServices = db.prepare(
          `SELECT service_name FROM service_catalog
           WHERE org_id = ? AND scan_run_id = ? AND NOT (${likeClauses})
           LIMIT ${AFFECTED_CAP - affectedResources.length}`
        ).all(orgId, scanRunId) as Array<{ service_name: string }>;
        affectedResources.push(...missingServices.map((s) => ({ type: 'service', id: s.service_name, name: s.service_name })));
      }
    }

    return {
      ruleId: 'ust-007',
      passed,
      score: percentage,
      maxScore: 100,
      findings: passed ? [] : [{
        category: 'unified_tagging',
        ruleId: 'ust-007',
        ruleName: 'Application tag coverage',
        severity: applicationTagSeverity,
        title: `${missing} resource(s) missing application tag (${percentage}% coverage)`,
        description: `The application tag groups hosts and services into a larger business workload for rollup dashboards and scorecards. ${missing} of ${total} hosts/services are missing it.`,
        impact: 'Without an application tag, you cannot produce application-level rollup dashboards or align monitoring with business workloads that span multiple services.',
        recommendation: 'Define an application taxonomy and add application:<name> to all resources belonging to that application via agent extra_tags, pod annotations, and service catalog entries.',
        affectedCount: missing,
        totalCount: total,
        percentage,
        affectedResources,
        evidence: [
          { type: 'count' as const, description: `${hostWithApplication}/${hostTotal} hosts, ${serviceWithApplication}/${serviceTotal} catalog services have an application tag`, value: percentage, source: '/api/v2/catalog/entity' },
        ],
        tagKey: 'application',
        bestPractice: recommendationForTagKey('application'),
      }],
    };
  },
};

const tierTagDef = lookupTag('tier');
const tierTagSeverity = severityFromPriority(tierTagDef?.priority ?? 'moderate');

const tierTagRule: AssessmentRule = {
  id: 'ust-008',
  name: 'Tier tag coverage',
  category: 'unified_tagging',
  severity: tierTagSeverity,
  description: 'APM services in the service catalog should carry a tier tag reflecting business criticality',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;

    // Per the tag dictionary, tier's primary scope is APM services. The
    // service_catalog table has a first-class `tier` column (populated from
    // the entity schema's `tier` field), which is a more reliable signal
    // than a resource_tags lookup — service_catalog rows aren't mirrored
    // into resource_tags at all.
    const total = (db.prepare('SELECT COUNT(*) as c FROM service_catalog WHERE org_id = ? AND scan_run_id = ?').get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const withTier = (db.prepare(
      "SELECT COUNT(*) as c FROM service_catalog WHERE org_id = ? AND scan_run_id = ? AND tier IS NOT NULL AND tier != ''"
    ).get(orgId, scanRunId) as { c: number })?.c ?? 0;

    const missing = total - withTier;
    const percentage = pct(withTier, total);
    const passed = percentage >= 60;

    const affectedServices = !passed
      ? (db.prepare(
          `SELECT service_name FROM service_catalog WHERE org_id = ? AND scan_run_id = ? AND (tier IS NULL OR tier = '') LIMIT ${AFFECTED_CAP}`
        ).all(orgId, scanRunId) as Array<{ service_name: string }>)
      : [];

    return {
      ruleId: 'ust-008',
      passed,
      score: percentage,
      maxScore: 100,
      findings: passed ? [] : [{
        category: 'unified_tagging',
        ruleId: 'ust-008',
        ruleName: 'Tier tag coverage',
        severity: tierTagSeverity,
        title: `${missing} service catalog entr${missing === 1 ? 'y' : 'ies'} missing tier (${percentage}% coverage)`,
        description: `Tier reflects business criticality (0 = most critical) and is used to prioritize on-call coverage and SLO strictness. ${missing} of ${total} service catalog entries are missing it.`,
        impact: 'Without tier classification, all services are treated as equally critical, leading to alert fatigue and misallocated on-call effort.',
        recommendation: 'Assign tier:<0|1|2|3> to every service catalog entry during onboarding, and propagate to hosts, monitors, and SLOs via extra_tags or annotations.',
        affectedCount: missing,
        totalCount: total,
        percentage,
        affectedResources: affectedServices.map((s) => ({ type: 'service', id: s.service_name, name: s.service_name })),
        evidence: [
          { type: 'count' as const, description: `${withTier}/${total} service catalog entries have a tier`, value: percentage, source: '/api/v2/catalog/entity' },
        ],
        tagKey: 'tier',
        bestPractice: recommendationForTagKey('tier'),
      }],
    };
  },
};

// Note: there is deliberately no "hosts must have a service tag" rule here.
// A host commonly runs multiple services, so blanket-tagging it with one
// service is the anti-pattern, not the goal — service/version belong at the
// workload level (APM services, monitors, synthetics, RUM), which is what
// versionTagRule/monitorTagRule/syntheticsTagRule below actually check.
export const unifiedTaggingRules: AssessmentRule[] = [
  envTagRule,
  versionTagRule,
  monitorTagRule,
  syntheticsTagRule,
  teamTagRule,
  applicationTagRule,
  tierTagRule,
];

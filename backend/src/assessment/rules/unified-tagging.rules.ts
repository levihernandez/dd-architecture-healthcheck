import type { Knex } from 'knex';
import type { AssessmentRule, AssessmentContext, RuleResult, AffectedResource } from '../../types/assessment.types';
import { recommendationForTagKey, severityFromPriority } from '../../tagging/recommendation';
import { lookupTag } from '../../tagging/tag-dictionary';

const AFFECTED_CAP = 25;

function pct(count: number, total: number): number {
  return total === 0 ? 100 : Math.round((count / total) * 100);
}

async function countRows(db: AssessmentContext['db'], table: string, orgId: string, scanRunId: string, extra?: Record<string, unknown>): Promise<number> {
  const row = await db(table).where({ org_id: orgId, scan_run_id: scanRunId, ...extra }).count({ c: '*' }).first();
  return Number(row?.c ?? 0);
}

const envTagRule: AssessmentRule = {
  id: 'ust-001',
  name: 'Host env tag coverage',
  category: 'unified_tagging',
  severity: 'critical',
  description: 'All hosts must have the env tag for Unified Service Tagging',
  async run(ctx: AssessmentContext): Promise<RuleResult> {
    const { orgId, scanRunId, db } = ctx;

    const total = await countRows(db, 'hosts', orgId, scanRunId);
    const withEnv = await countRows(db, 'hosts', orgId, scanRunId, { has_env_tag: 1 });

    const missing = total - withEnv;
    const percentage = pct(withEnv, total);
    const passed = percentage >= 90;

    const affectedHosts = missing > 0
      ? await db<{ org_id: string; scan_run_id: string; has_env_tag: number; host_name: string }>('hosts')
          .select('host_name')
          .where({ org_id: orgId, scan_run_id: scanRunId, has_env_tag: 0 })
          .limit(AFFECTED_CAP)
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
    const total = await countRows(db, 'services', orgId, scanRunId);
    const withVersion = await countRows(db, 'services', orgId, scanRunId, { has_version_tag: 1 });
    const missing = total - withVersion;
    const percentage = pct(withVersion, total);
    const passed = percentage >= 70;

    const affectedServices = missing > 0
      ? await db<{ org_id: string; scan_run_id: string; has_version_tag: number; service_name: string; env: string | null }>('services')
          .select('service_name', 'env')
          .where({ org_id: orgId, scan_run_id: scanRunId, has_version_tag: 0 })
          .limit(AFFECTED_CAP)
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
    const total = await countRows(db, 'monitors', orgId, scanRunId);
    const withBoth = await countRows(db, 'monitors', orgId, scanRunId, { has_env_tag: 1, has_service_tag: 1 });
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
      ? await db<{ org_id: string; scan_run_id: string; has_env_tag: number; has_service_tag: number; monitor_id: number; monitor_name: string | null }>('monitors')
          .select('monitor_id', 'monitor_name')
          .where({ org_id: orgId, scan_run_id: scanRunId })
          .where((b) => b.where('has_env_tag', 0).orWhere('has_service_tag', 0))
          .limit(AFFECTED_CAP)
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
    const total = await countRows(db, 'synthetics_tests', orgId, scanRunId);
    const withBoth = await countRows(db, 'synthetics_tests', orgId, scanRunId, { has_env_tag: 1, has_service_tag: 1 });
    const missing = total - withBoth;
    const percentage = pct(withBoth, total);
    const passed = percentage >= 70;

    // Same choice as ust-004: 'service' is the primary tagKey for this
    // finding since env coverage is already covered in detail by ust-001.
    const affectedTests = missing > 0
      ? await db<{ org_id: string; scan_run_id: string; has_env_tag: number; has_service_tag: number; public_id: string; test_name: string | null }>('synthetics_tests')
          .select('public_id', 'test_name')
          .where({ org_id: orgId, scan_run_id: scanRunId })
          .where((b) => b.where('has_env_tag', 0).orWhere('has_service_tag', 0))
          .limit(AFFECTED_CAP)
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

    const hostTotal = await countRows(db, 'hosts', orgId, scanRunId);
    const hostWithTeam = await countRows(db, 'hosts', orgId, scanRunId, { has_team_tag: 1 });

    const monitorTotal = await countRows(db, 'monitors', orgId, scanRunId);
    const monitorWithTeam = await countRows(db, 'monitors', orgId, scanRunId, { has_team_tag: 1 });

    // services table has a direct `team` text column (populated from the APM
    // services endpoint's `team` field) rather than a has_team_tag flag.
    const serviceTotal = await countRows(db, 'services', orgId, scanRunId);
    const serviceWithTeam = Number(
      (await db('services')
        .where({ org_id: orgId, scan_run_id: scanRunId })
        .whereNotNull('team')
        .where('team', '!=', '')
        .count({ c: '*' })
        .first())?.c ?? 0
    );

    const total = hostTotal + monitorTotal + serviceTotal;
    const withTeam = hostWithTeam + monitorWithTeam + serviceWithTeam;
    const missing = total - withTeam;
    const percentage = pct(withTeam, total);
    const passed = percentage >= 90;

    const affectedResources: AffectedResource[] = [];
    if (!passed) {
      const missingHosts = await db<{ org_id: string; scan_run_id: string; has_team_tag: number; host_name: string }>('hosts')
        .select('host_name')
        .where({ org_id: orgId, scan_run_id: scanRunId, has_team_tag: 0 })
        .limit(AFFECTED_CAP);
      affectedResources.push(...missingHosts.map((h) => ({ type: 'host', id: h.host_name, name: h.host_name })));

      if (affectedResources.length < AFFECTED_CAP) {
        const missingMonitors = await db<{ org_id: string; scan_run_id: string; has_team_tag: number; monitor_id: number; monitor_name: string | null }>('monitors')
          .select('monitor_id', 'monitor_name')
          .where({ org_id: orgId, scan_run_id: scanRunId, has_team_tag: 0 })
          .limit(AFFECTED_CAP - affectedResources.length);
        affectedResources.push(...missingMonitors.map((m) => ({ type: 'monitor', id: String(m.monitor_id), name: m.monitor_name ?? `Monitor ${m.monitor_id}` })));
      }

      if (affectedResources.length < AFFECTED_CAP) {
        const missingServices = await db<{ org_id: string; scan_run_id: string; team: string | null; service_name: string; env: string | null }>('services')
          .select('service_name', 'env')
          .where({ org_id: orgId, scan_run_id: scanRunId })
          .where((b) => b.whereNull('team').orWhere('team', ''))
          .limit(AFFECTED_CAP - affectedResources.length);
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
    const hostTotal = await countRows(db, 'hosts', orgId, scanRunId);
    const hostWithApplication = Number(
      (await db('resource_tags')
        .where({ org_id: orgId, scan_run_id: scanRunId, resource_type: 'host' })
        .whereIn('tag_key', APPLICATION_TAG_KEYS)
        .countDistinct({ c: 'resource_id' })
        .first())?.c ?? 0
    );

    // Services: no resource_tags rows exist for resource_type='service', so
    // fall back to the service_catalog.tags JSON blob (array of "key:value"
    // strings) as a best-effort text search.
    const serviceTotal = await countRows(db, 'service_catalog', orgId, scanRunId);
    const applyTagLikeClauses = <T extends Knex.QueryBuilder>(builder: T): T => {
      for (const key of APPLICATION_TAG_KEYS) {
        builder.orWhere('tags', 'like', `%${key}:%`);
      }
      return builder;
    };
    const serviceWithApplication = serviceTotal > 0
      ? Number(
          (await db('service_catalog')
            .where({ org_id: orgId, scan_run_id: scanRunId })
            .where((b) => applyTagLikeClauses(b))
            .count({ c: '*' })
            .first())?.c ?? 0
        )
      : 0;

    const total = hostTotal + serviceTotal;
    const withApplication = hostWithApplication + serviceWithApplication;
    const missing = total - withApplication;
    const percentage = pct(withApplication, total);
    const passed = percentage >= 70;

    const affectedResources: AffectedResource[] = [];
    if (!passed) {
      const missingHosts = await db<{ org_id: string; scan_run_id: string; host_name: string }>({ h: 'hosts' })
        .select('h.host_name')
        .where('h.org_id', orgId)
        .andWhere('h.scan_run_id', scanRunId)
        .whereNotExists(function (this: Knex.QueryBuilder) {
          this.select(1)
            .from({ rt: 'resource_tags' })
            .whereRaw('rt.org_id = h.org_id AND rt.scan_run_id = h.scan_run_id AND rt.resource_id = h.host_name')
            .andWhere('rt.resource_type', 'host')
            .whereIn('rt.tag_key', APPLICATION_TAG_KEYS);
        })
        .limit(AFFECTED_CAP);
      affectedResources.push(...missingHosts.map((h) => ({ type: 'host', id: h.host_name, name: h.host_name })));

      if (affectedResources.length < AFFECTED_CAP) {
        const missingServices = await db<{ org_id: string; scan_run_id: string; tags: string | null; service_name: string }>('service_catalog')
          .select('service_name')
          .where({ org_id: orgId, scan_run_id: scanRunId })
          .whereNot((b) => applyTagLikeClauses(b))
          .limit(AFFECTED_CAP - affectedResources.length);
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
    const total = await countRows(db, 'service_catalog', orgId, scanRunId);
    const withTier = Number(
      (await db('service_catalog')
        .where({ org_id: orgId, scan_run_id: scanRunId })
        .whereNotNull('tier')
        .where('tier', '!=', '')
        .count({ c: '*' })
        .first())?.c ?? 0
    );

    const missing = total - withTier;
    const percentage = pct(withTier, total);
    const passed = percentage >= 60;

    const affectedServices = !passed
      ? await db<{ org_id: string; scan_run_id: string; tier: string | null; service_name: string }>('service_catalog')
          .select('service_name')
          .where({ org_id: orgId, scan_run_id: scanRunId })
          .where((b) => b.whereNull('tier').orWhere('tier', ''))
          .limit(AFFECTED_CAP)
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

import { getDatabase } from '../db/database';
import { parseUsageSummary } from './cost-data';
import { PRICING_ESTIMATES } from './analytics-insights';
import { getGrade } from './scorer';
import { parseHostRawJson } from './host-enrichment';
import type { ScoreGrade } from '../types/assessment.types';

export interface HostGapRow {
  hostName: string;
  cloudProvider: string;
  instanceType: string | null;
  region: string | null;
  availabilityZone: string | null;
  platform: string | null;
  agentVersion: string | null;
  envTag: string | null;
  serviceTag: string | null;
  hasEnvTag: boolean;
  hasServiceTag: boolean;
  hasVersionTag: boolean;
  hasTeamTag: boolean;
  hasApm: boolean;
  matchedService: string | null;
  installedChecks: string[];
  isBlindSpot: boolean;
}

export interface ProductGap {
  product: string;
  icon: string;
  hostsCoveredEstimate: number;
  totalHosts: number;
  coveragePct: number;
  gapCount: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  why: string;
  what: string;
  how: string;
  howMuch: string;
  improvement: string;
}

export interface ServiceMaturityRow {
  serviceName: string;
  env: string | null;
  team: string | null;
  score: number;
  grade: ScoreGrade;
  hasServiceCatalog: boolean;
  hasMonitor: boolean;
  hasSLO: boolean;
  hasVersionTag: boolean;
  hasOwner: boolean;
  missing: string[];
}

export interface AppBreakdownRow {
  type: string;
  label: string;
  icon: string;
  count: number;
  tagCoveragePct: number | null;
  tagCoverageNote: string;
}

export interface HostGapAnalysis {
  totalHosts: number;
  blindSpotCount: number;
  hosts: HostGapRow[];
  productGaps: ProductGap[];
  serviceMaturity: {
    services: ServiceMaturityRow[];
    avgScore: number;
    distribution: Record<ScoreGrade, number>;
  };
  appBreakdown: AppBreakdownRow[];
}

function severityFor(coveragePct: number): 'critical' | 'high' | 'medium' | 'low' {
  if (coveragePct < 30) return 'critical';
  if (coveragePct < 60) return 'high';
  if (coveragePct < 85) return 'medium';
  return 'low';
}

export async function analyzeHostGaps(orgId: string, scanRunId: string): Promise<HostGapAnalysis> {
  const db = getDatabase();

  const hostRows = await db<{
    org_id: string; scan_run_id: string;
    host_name: string; platform: string | null; agent_version: string | null;
    has_env_tag: number; has_service_tag: number; has_version_tag: number; has_team_tag: number;
    raw_json: string | null;
  }>('hosts')
    .select('host_name', 'platform', 'agent_version', 'has_env_tag', 'has_service_tag', 'has_version_tag', 'has_team_tag', 'raw_json')
    .where({ org_id: orgId, scan_run_id: scanRunId })
    .orderBy('host_name');

  // (env, service) → service_name, for cross-referencing APM presence per host.
  const serviceRows = await db<{ org_id: string; scan_run_id: string; service_name: string; env: string | null }>('services')
    .select('service_name', 'env')
    .where({ org_id: orgId, scan_run_id: scanRunId });
  const serviceByEnvService = new Map<string, string>();
  for (const s of serviceRows) {
    serviceByEnvService.set(`${(s.env ?? '').toLowerCase()}|${s.service_name.toLowerCase()}`, s.service_name);
  }

  const hosts: HostGapRow[] = hostRows.map((h) => {
    const meta = parseHostRawJson(h.raw_json);
    const { cloudProvider, instanceType, region, availabilityZone: az, envTag, serviceTag, installedChecks } = meta;

    const matchedService = envTag && serviceTag
      ? serviceByEnvService.get(`${envTag.toLowerCase()}|${serviceTag.toLowerCase()}`) ?? null
      : null;
    // The 'trace' Agent check is a direct signal the trace-agent is running on
    // this host, independent of whether its env/service tags happen to match a
    // known APM service — catches APM presence that tag-matching alone would miss.
    const hasApm = matchedService !== null || installedChecks.includes('trace');

    const hasEnvTag = Boolean(h.has_env_tag);
    const hasServiceTag = Boolean(h.has_service_tag);

    return {
      hostName: h.host_name,
      cloudProvider,
      instanceType,
      region,
      availabilityZone: az,
      platform: h.platform,
      agentVersion: h.agent_version,
      envTag, serviceTag,
      hasEnvTag, hasServiceTag,
      hasVersionTag: Boolean(h.has_version_tag),
      hasTeamTag: Boolean(h.has_team_tag),
      hasApm,
      matchedService,
      installedChecks,
      // A host with no env/service identity AND no APM match is functionally
      // unmanaged — nobody can tell what it is or who owns it from Datadog alone.
      isBlindSpot: !hasApm && !hasEnvTag && !hasServiceTag,
    };
  });

  const totalHosts = hosts.length;
  const blindSpotCount = hosts.filter((h) => h.isBlindSpot).length;

  // ── Product coverage gaps ────────────────────────────────────────────────────
  // Real per-host detection isn't possible for every product (Datadog's Hosts API
  // doesn't expose "is CSPM/CWS/NPM enabled on this host"), so these compare the
  // infra host count against the org's actual billed host count for each product
  // (from usage_summary) — an accurate gap size even though which specific hosts
  // make up the gap can't be named.
  const usageRow = await db<{ org_id: string; scan_run_id: string; usage_json: string }>('usage_summary')
    .select('usage_json')
    .where({ org_id: orgId, scan_run_id: scanRunId })
    .first();
  const { latestUsage } = usageRow ? parseUsageSummary(usageRow.usage_json) : { latestUsage: {} as Record<string, unknown> };
  const usageNum = (key: string): number => {
    const v = latestUsage[key];
    return typeof v === 'number' ? v : 0;
  };

  function makeGap(
    product: string, icon: string, coveredRaw: number,
    why: string, what: string, how: string, unitPrice: number, improvement: string
  ): ProductGap {
    const covered = Math.min(Math.round(coveredRaw), totalHosts);
    const coveragePct = totalHosts > 0 ? Math.round((covered / totalHosts) * 100) : 0;
    const gapCount = Math.max(totalHosts - covered, 0);
    return {
      product, icon, hostsCoveredEstimate: covered, totalHosts, coveragePct, gapCount,
      severity: severityFor(coveragePct),
      why, what, how,
      howMuch: gapCount > 0
        ? `~$${Math.round(gapCount * unitPrice).toLocaleString()}/mo of unrealized coverage (${gapCount} hosts × $${unitPrice}/host list price)`
        : 'No gap at current list pricing',
      improvement,
    };
  }

  const productGaps: ProductGap[] = totalHosts > 0 ? [
    makeGap(
      // Prefer the direct per-host signal (trace check / tag-matched service) over
      // usage billing, which can lag or read zero for brand-new/local test orgs —
      // take whichever signal shows more coverage rather than under-claiming.
      'APM Tracing', '🔵', Math.max(hosts.filter((h) => h.hasApm).length, usageNum('apm_host_top99p')),
      'Un-instrumented hosts have zero request-level or trace visibility — an outage there is invisible until a customer reports it, and there is no Service Map entry to route the alert.',
      'Install the Datadog APM tracing library for the application\'s language and enable auto-instrumentation.',
      'Add the ddtrace library, set DD_ENV/DD_SERVICE/DD_VERSION, restart the app, then verify traces arrive under APM → Services within a few minutes.',
      PRICING_ESTIMATES.apmHostMonthly,
      'Full request-level tracing, error tracking, Service Map placement, and Deployment Tracking for every affected host.'
    ),
    makeGap(
      'Cloud Security (CSPM)', '🛡️', usageNum('cspm_host_top99p'),
      'Hosts without CSPM are unscanned for misconfigurations (open ports, weak IAM, exposed storage) — the exact class of issue that leads to breaches and compliance findings.',
      'Enable Cloud Security Posture Management on the account/host.',
      'Turn on Cloud Security Management in the Datadog integration tile for the cloud account, or enable compliance_config in the Agent for on-prem hosts.',
      PRICING_ESTIMATES.cspmHostMonthly,
      'Continuous misconfiguration scanning against CIS/SOC2/PCI benchmarks with no code changes required.'
    ),
    makeGap(
      'Workload Security (CWS)', '🔒', usageNum('cws_host_top99p'),
      'Without runtime security, malicious process execution, privilege escalation, or file-integrity violations on these hosts go completely undetected.',
      'Enable Cloud Workload Security in the Agent.',
      'Set runtime_security_config.enabled: true in datadog.yaml (or the corresponding Helm/DaemonSet value for Kubernetes) and restart the Agent.',
      PRICING_ESTIMATES.cwsHostMonthly,
      'Real-time detection of suspicious process, file, and network activity at the kernel level.'
    ),
    makeGap(
      'Network Monitoring (NPM)', '🌐', usageNum('npm_host_top99p'),
      'Network-level latency and packet loss between these hosts and their dependencies is invisible — a slow upstream call looks identical to a slow app in APM alone.',
      'Enable Network Performance Monitoring in the Agent.',
      'Set network_config.enabled: true in the Agent\'s system-probe config and restart the Agent — no application changes required.',
      PRICING_ESTIMATES.npmHostMonthly,
      'Automatic network path visibility between every monitored host, independent of application instrumentation.'
    ),
  ].filter((g) => g.gapCount > 0 || g.hostsCoveredEstimate > 0) : [];

  // ── Service catalog maturity ─────────────────────────────────────────────────
  const svcRows = await db<{
    org_id: string; scan_run_id: string;
    service_name: string; env: string | null; team: string | null;
    has_service_catalog: number; has_monitor: number; has_slo: number;
    has_version_tag: number; has_owner: number;
  }>('services')
    .select('service_name', 'env', 'team', 'has_service_catalog', 'has_monitor', 'has_slo', 'has_version_tag', 'has_owner')
    .where({ org_id: orgId, scan_run_id: scanRunId })
    .orderBy('service_name');

  const services: ServiceMaturityRow[] = svcRows.map((s) => {
    const hasServiceCatalog = Boolean(s.has_service_catalog);
    const hasMonitor = Boolean(s.has_monitor);
    const hasSLO = Boolean(s.has_slo);
    const hasVersionTag = Boolean(s.has_version_tag);
    const hasOwner = Boolean(s.has_owner);
    const score = (hasServiceCatalog ? 30 : 0) + (hasMonitor ? 30 : 0) + (hasSLO ? 20 : 0)
      + (hasVersionTag ? 10 : 0) + (hasOwner ? 10 : 0);
    const missing: string[] = [];
    if (!hasServiceCatalog) missing.push('service catalog entry');
    if (!hasMonitor) missing.push('a monitor');
    if (!hasSLO) missing.push('an SLO');
    if (!hasVersionTag) missing.push('version tag (blocks Deployment Tracking)');
    if (!hasOwner) missing.push('an owning team');
    return {
      serviceName: s.service_name, env: s.env, team: s.team, score,
      grade: getGrade(score),
      hasServiceCatalog, hasMonitor, hasSLO, hasVersionTag, hasOwner, missing,
    };
  });

  const distribution: Record<ScoreGrade, number> = { excellent: 0, good: 0, needs_attention: 0, critical: 0 };
  for (const s of services) distribution[s.grade]++;
  const avgScore = services.length > 0
    ? Math.round(services.reduce((sum, s) => sum + s.score, 0) / services.length)
    : 0;

  // ── App breakdown (host vs serverless) ───────────────────────────────────────
  const appBreakdown: AppBreakdownRow[] = [
    {
      type: 'host', label: 'Hosts & VMs', icon: '🖥️', count: totalHosts,
      tagCoveragePct: totalHosts > 0 ? Math.round((hosts.filter((h) => h.hasEnvTag && h.hasServiceTag).length / totalHosts) * 100) : null,
      tagCoverageNote: 'env+service tag coverage, from host inventory.',
    },
    {
      type: 'serverless-lambda', label: 'Lambda Functions', icon: '⚡', count: Math.round(usageNum('lambda_functions_count')),
      tagCoveragePct: null,
      tagCoverageNote: 'No per-function inventory collected yet — tag coverage must be checked in the Lambda console or via DD_TAGS on the function.',
    },
    {
      type: 'serverless-fargate', label: 'Fargate Tasks', icon: '📦', count: Math.round(usageNum('fargate_tasks_count_avg')),
      tagCoveragePct: null,
      tagCoverageNote: 'No per-task inventory collected yet — tag coverage must be checked in the ECS/Fargate task definition.',
    },
  ].filter((a) => a.count > 0);

  return {
    totalHosts, blindSpotCount, hosts, productGaps,
    serviceMaturity: { services, avgScore, distribution },
    appBreakdown,
  };
}

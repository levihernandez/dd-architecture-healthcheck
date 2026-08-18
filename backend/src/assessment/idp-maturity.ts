// Internal Developer Portal maturity check: teams, Software Catalog health,
// Scorecards, reliability (SLOs + incident MTTR), and DORA metrics — with
// prescriptive setup guidance for whichever pillar isn't configured yet.

import { getDatabase } from '../db/database';
import { getGrade } from './scorer';
import type { ScoreGrade } from '../types/assessment.types';

export interface TeamRow {
  teamId: string;
  teamName: string | null;
  handle: string | null;
  userCount: number;
  linkCount: number;
  hasNoMembers: boolean;
  hasNoLinks: boolean;
}

export interface TeamsAnalysis {
  totalTeams: number;
  teamsWithNoMembers: number;
  teamsWithoutLinks: number;
  teams: TeamRow[];
}

export interface CatalogHealth {
  totalServices: number;
  inCatalogCount: number;
  catalogCoveragePct: number;
  withTierPct: number;
  withLifecyclePct: number;
  withOwnerPct: number;
  withLinksPct: number;
}

export interface ScorecardRuleSummary {
  ruleId: string;
  ruleName: string;
  enabled: boolean;
  isCustom: boolean;
  passCount: number;
  failCount: number;
  otherCount: number;
  passRatePct: number;
}

export interface ScorecardsAnalysis {
  configured: boolean;
  totalRules: number;
  enabledRules: number;
  totalOutcomes: number;
  overallPassRatePct: number;
  rules: ScorecardRuleSummary[];
}

export interface ReliabilityAnalysis {
  totalSLOs: number;
  servicesWithSloPct: number;
  totalIncidents: number;
  resolvedIncidents: number;
  avgResolutionHours: number | null;
}

export interface DoraSignal {
  signal: string;
  label: string;
  detected: boolean;
  value: number | null;
  unit: string;
}

export interface DoraAnalysis {
  configured: boolean;
  signals: DoraSignal[];
}

export interface PrescriptiveGuidance {
  area: string;
  icon: string;
  why: string;
  what: string;
  how: string;
  docsUrl: string;
  orgLinkKey: 'teams' | 'softwareCatalog' | 'scorecards' | 'doraMetrics';
}

export interface IdpMaturityAnalysis {
  teams: TeamsAnalysis;
  catalogHealth: CatalogHealth;
  scorecards: ScorecardsAnalysis;
  reliability: ReliabilityAnalysis;
  dora: DoraAnalysis;
  guidance: PrescriptiveGuidance[];
  overallScore: number;
  overallGrade: ScoreGrade;
}

const DORA_SIGNAL_META: Array<{ signal: string; label: string; unit: string }> = [
  { signal: 'deployment_frequency', label: 'Deployment Frequency', unit: 'deploys/30d' },
  { signal: 'lead_time_for_changes', label: 'Lead Time for Changes', unit: 'sec (avg)' },
  { signal: 'change_failure_rate', label: 'Change Failure Rate', unit: 'failures/30d' },
  { signal: 'time_to_restore', label: 'Time to Restore Service', unit: 'sec (avg)' },
];

export function analyzeIdpMaturity(orgId: string, scanRunId: string): IdpMaturityAnalysis {
  const db = getDatabase();

  // ── Teams ─────────────────────────────────────────────────────────────────
  const teamRows = db.prepare(`
    SELECT team_id, team_name, handle, user_count, link_count
    FROM teams WHERE org_id = ? AND scan_run_id = ? ORDER BY team_name
  `).all(orgId, scanRunId) as Array<{
    team_id: string; team_name: string | null; handle: string | null; user_count: number; link_count: number;
  }>;

  const teams: TeamRow[] = teamRows.map((t) => ({
    teamId: t.team_id, teamName: t.team_name, handle: t.handle,
    userCount: t.user_count, linkCount: t.link_count,
    hasNoMembers: t.user_count === 0,
    hasNoLinks: t.link_count === 0,
  }));

  const teamsAnalysis: TeamsAnalysis = {
    totalTeams: teams.length,
    teamsWithNoMembers: teams.filter((t) => t.hasNoMembers).length,
    teamsWithoutLinks: teams.filter((t) => t.hasNoLinks).length,
    teams,
  };

  // ── Catalog health ────────────────────────────────────────────────────────
  const totalServices = (db.prepare(
    'SELECT COUNT(*) as n FROM services WHERE org_id = ? AND scan_run_id = ?'
  ).get(orgId, scanRunId) as { n: number }).n;
  const inCatalogCount = (db.prepare(
    "SELECT COUNT(*) as n FROM services WHERE org_id = ? AND scan_run_id = ? AND has_service_catalog = 1"
  ).get(orgId, scanRunId) as { n: number }).n;

  const catalogRows = db.prepare(
    'SELECT tier, lifecycle, owner, link_count FROM service_catalog WHERE org_id = ? AND scan_run_id = ?'
  ).all(orgId, scanRunId) as Array<{ tier: string | null; lifecycle: string | null; owner: string | null; link_count: number }>;

  const catalogCount = catalogRows.length;
  const pct = (n: number): number => catalogCount > 0 ? Math.round((n / catalogCount) * 100) : 0;

  const catalogHealth: CatalogHealth = {
    totalServices,
    inCatalogCount,
    catalogCoveragePct: totalServices > 0 ? Math.round((inCatalogCount / totalServices) * 100) : 0,
    withTierPct: pct(catalogRows.filter((c) => c.tier).length),
    withLifecyclePct: pct(catalogRows.filter((c) => c.lifecycle).length),
    withOwnerPct: pct(catalogRows.filter((c) => c.owner).length),
    withLinksPct: pct(catalogRows.filter((c) => c.link_count > 0).length),
  };

  // ── Scorecards ────────────────────────────────────────────────────────────
  const ruleRows = db.prepare(
    'SELECT rule_id, rule_name, enabled, is_custom FROM scorecard_rules WHERE org_id = ? AND scan_run_id = ?'
  ).all(orgId, scanRunId) as Array<{ rule_id: string; rule_name: string | null; enabled: number; is_custom: number }>;

  const outcomeRows = db.prepare(
    'SELECT rule_id, state FROM scorecard_outcomes WHERE org_id = ? AND scan_run_id = ?'
  ).all(orgId, scanRunId) as Array<{ rule_id: string | null; state: string | null }>;

  const rules: ScorecardRuleSummary[] = ruleRows.map((r) => {
    const outcomes = outcomeRows.filter((o) => o.rule_id === r.rule_id);
    const passCount = outcomes.filter((o) => (o.state ?? '').toUpperCase() === 'PASSED').length;
    const failCount = outcomes.filter((o) => (o.state ?? '').toUpperCase() === 'FAILED').length;
    const otherCount = outcomes.length - passCount - failCount;
    const scored = passCount + failCount;
    return {
      ruleId: r.rule_id, ruleName: r.rule_name ?? r.rule_id,
      enabled: Boolean(r.enabled), isCustom: Boolean(r.is_custom),
      passCount, failCount, otherCount,
      passRatePct: scored > 0 ? Math.round((passCount / scored) * 100) : 0,
    };
  });

  const totalPass = rules.reduce((s, r) => s + r.passCount, 0);
  const totalScored = rules.reduce((s, r) => s + r.passCount + r.failCount, 0);

  const scorecardsAnalysis: ScorecardsAnalysis = {
    configured: ruleRows.length > 0,
    totalRules: ruleRows.length,
    enabledRules: ruleRows.filter((r) => r.enabled).length,
    totalOutcomes: outcomeRows.length,
    overallPassRatePct: totalScored > 0 ? Math.round((totalPass / totalScored) * 100) : 0,
    rules,
  };

  // ── Reliability (SLOs + incident MTTR) ───────────────────────────────────
  const totalSLOs = (db.prepare(
    'SELECT COUNT(*) as n FROM slos WHERE org_id = ? AND scan_run_id = ?'
  ).get(orgId, scanRunId) as { n: number }).n;
  const servicesWithSlo = (db.prepare(
    'SELECT COUNT(*) as n FROM services WHERE org_id = ? AND scan_run_id = ? AND has_slo = 1'
  ).get(orgId, scanRunId) as { n: number }).n;

  const incidentRows = db.prepare(
    'SELECT created_at_dd, resolved_at_dd FROM incidents WHERE org_id = ? AND scan_run_id = ?'
  ).all(orgId, scanRunId) as Array<{ created_at_dd: string | null; resolved_at_dd: string | null }>;

  const resolutionHours = incidentRows
    .filter((i) => i.created_at_dd && i.resolved_at_dd)
    .map((i) => (new Date(i.resolved_at_dd!).getTime() - new Date(i.created_at_dd!).getTime()) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);

  const reliability: ReliabilityAnalysis = {
    totalSLOs,
    servicesWithSloPct: totalServices > 0 ? Math.round((servicesWithSlo / totalServices) * 100) : 0,
    totalIncidents: incidentRows.length,
    resolvedIncidents: resolutionHours.length,
    avgResolutionHours: resolutionHours.length > 0
      ? Math.round((resolutionHours.reduce((s, h) => s + h, 0) / resolutionHours.length) * 10) / 10
      : null,
  };

  // ── DORA ──────────────────────────────────────────────────────────────────
  const doraRows = db.prepare(
    "SELECT signal, value, detected FROM product_usage_signals WHERE org_id = ? AND scan_run_id = ? AND product = 'dora'"
  ).all(orgId, scanRunId) as Array<{ signal: string; value: string | null; detected: number }>;
  const doraBySignal = new Map(doraRows.map((r) => [r.signal, r]));

  const doraSignals: DoraSignal[] = DORA_SIGNAL_META.map((meta) => {
    const row = doraBySignal.get(meta.signal);
    return {
      signal: meta.signal, label: meta.label, unit: meta.unit,
      detected: Boolean(row?.detected),
      value: row?.value != null ? Math.round(parseFloat(row.value) * 100) / 100 : null,
    };
  });

  const dora: DoraAnalysis = {
    configured: doraSignals.some((s) => s.detected),
    signals: doraSignals,
  };

  // ── Prescriptive guidance — always shown, framed by whether it's configured ─
  const guidance: PrescriptiveGuidance[] = [
    {
      area: 'Teams', icon: '👥', orgLinkKey: 'teams',
      why: teamsAnalysis.totalTeams === 0
        ? 'No teams are defined — ownership, on-call routing, and Software Catalog filtering all depend on Teams existing first.'
        : `${teamsAnalysis.teamsWithNoMembers} of ${teamsAnalysis.totalTeams} teams have zero members, and ${teamsAnalysis.teamsWithoutLinks} have no links — those teams can't be paged or self-served for context during an incident.`,
      what: 'Create a Team per real on-call/ownership unit, add its members, and attach at least a runbook and a repo/dashboard link.',
      how: 'Organization Settings → Teams → New Team, then add members under the Members tab and links under the Links tab. Tag services with the team\'s handle (dd-team) so Software Catalog and monitors resolve ownership automatically.',
      docsUrl: 'https://docs.datadoghq.com/account_management/teams/',
    },
    {
      area: 'Software Catalog', icon: '📚', orgLinkKey: 'softwareCatalog',
      why: catalogHealth.catalogCoveragePct < 80
        ? `Only ${catalogHealth.catalogCoveragePct}% of detected services are registered in the Software Catalog — the rest have no tier, lifecycle, owner, or docs visible to on-call.`
        : `Catalog covers ${catalogHealth.catalogCoveragePct}% of services, but tier/lifecycle/links completeness (${catalogHealth.withTierPct}% / ${catalogHealth.withLifecyclePct}% / ${catalogHealth.withLinksPct}%) still has room to close.`,
      what: 'Register every production service with a `dd-service` entity file declaring team, tier, lifecycle, and contact/runbook links.',
      how: 'Commit a `service.datadog.yaml` (or use the in-app catalog editor) per repo, or auto-populate via `dd-team`/`dd-tier`/`dd-lifecycle` tags at the APM tracer level.',
      docsUrl: 'https://docs.datadoghq.com/tracing/service_catalog/',
    },
    {
      area: 'Scorecards', icon: '🎯', orgLinkKey: 'scorecards',
      why: !scorecardsAnalysis.configured
        ? 'No Scorecard rules are configured — there is no automated way to enforce production-readiness standards (ownership, on-call, runbooks, SLOs) across services.'
        : `${scorecardsAnalysis.enabledRules} of ${scorecardsAnalysis.totalRules} rules are enabled, with an overall ${scorecardsAnalysis.overallPassRatePct}% pass rate across ${scorecardsAnalysis.totalOutcomes} evaluated outcomes.`,
      what: 'Define Scorecard rules for the non-negotiables (has an owner, has an on-call, has a runbook link, has an SLO) and require them before a service is considered production-ready.',
      how: 'Software Catalog → Scorecards → New Rule — start with the built-in rule templates, then layer custom rules keyed off catalog schema fields.',
      docsUrl: 'https://docs.datadoghq.com/software_catalog/scorecards/',
    },
    {
      area: 'Reliability (SLOs + Incidents)', icon: '🛟', orgLinkKey: 'teams',
      why: reliability.servicesWithSloPct < 60
        ? `Only ${reliability.servicesWithSloPct}% of services have an SLO — reliability targets aren't defined for most of the fleet, so there's no error budget to alert against.`
        : reliability.avgResolutionHours != null
          ? `${reliability.servicesWithSloPct}% SLO coverage, with incidents resolving in ${reliability.avgResolutionHours}h on average across ${reliability.resolvedIncidents} resolved incidents.`
          : `${reliability.servicesWithSloPct}% SLO coverage; incident resolution times aren't computable yet (no resolved incidents with timestamps).`,
      what: 'Define an SLO per customer-facing service tied to a real user-journey metric, and route Incident Management through it so MTTR is tracked automatically.',
      how: 'SLOs → New SLO, scope it to the service\'s primary latency/availability metric; enable Incident Management on the same services so resolution timestamps populate MTTR.',
      docsUrl: 'https://docs.datadoghq.com/service_management/service_level_objectives/',
    },
    {
      area: 'DORA Metrics', icon: '🚀', orgLinkKey: 'doraMetrics',
      why: !dora.configured
        ? 'No DORA deployment/failure events are being ingested yet — deployment frequency, lead time, change failure rate, and MTTR are all currently unmeasured.'
        : 'DORA signals are flowing — use them to spot regressions in deployment frequency or failure rate before they show up as incidents.',
      what: 'Ingest deployment and failure events from CI/CD so Datadog can compute all four DORA metrics automatically.',
      how: 'Connect a supported CI provider integration (GitHub Actions, GitLab, CircleCI, Jenkins) for automatic event capture, or POST directly to the DORA Metrics ingestion API from the deploy pipeline.',
      docsUrl: 'https://docs.datadoghq.com/dora_metrics/',
    },
  ];

  // ── Overall composite (teams 15%, catalog 30%, scorecards 20%, reliability 25%, DORA 10%) ─
  const teamsScore = teamsAnalysis.totalTeams > 0
    ? Math.round(100 * (1 - (teamsAnalysis.teamsWithNoMembers + teamsAnalysis.teamsWithoutLinks) / (teamsAnalysis.totalTeams * 2)))
    : 0;
  const catalogScore = Math.round(
    catalogHealth.catalogCoveragePct * 0.4 + catalogHealth.withOwnerPct * 0.2
    + catalogHealth.withTierPct * 0.2 + catalogHealth.withLinksPct * 0.2
  );
  const scorecardsScore = scorecardsAnalysis.configured ? scorecardsAnalysis.overallPassRatePct : 0;
  const reliabilityScore = reliability.servicesWithSloPct;
  const doraScore = dora.configured ? 100 : 0;

  const overallScore = Math.round(
    teamsScore * 0.15 + catalogScore * 0.30 + scorecardsScore * 0.20 + reliabilityScore * 0.25 + doraScore * 0.10
  );

  return {
    teams: teamsAnalysis, catalogHealth, scorecards: scorecardsAnalysis, reliability, dora,
    guidance, overallScore, overallGrade: getGrade(overallScore),
  };
}

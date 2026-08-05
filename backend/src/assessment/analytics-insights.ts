// Shared helpers for the Analytics page: a cost figure per product domain (real
// billing when available, otherwise a clearly-labeled list-price estimate) and a
// short list of quick, data-driven recommendations per domain. Kept separate from
// analytics.routes.ts so the route stays readable — this is pure computation, no DB access.

import type { ProductBreakdownRow } from './cost-data';

export interface CostFigure {
  amount: number;
  source: 'real' | 'estimated';
  note?: string;
}

// Approximate Datadog list prices, used ONLY as a fallback estimate when no real
// billing data was collected for this org/scan. Always surfaced with source:'estimated'
// so the UI can visually distinguish them from actual billed amounts.
const PRICING_ESTIMATES = {
  infraHostMonthly: 15,
  apmHostMonthly: 31,
  customMetricsPer100Monthly: 5,
  logsIngestPerGb: 0.10,
  syntheticsApiPer10k: 5,
  syntheticsBrowserPer1k: 12,
  rumSessionPer1k: 1.5,
  npmHostMonthly: 6,
  ndmDeviceMonthly: 9.5,
  dbmHostMonthly: 70,
  cspmHostMonthly: 12.5,
  cwsHostMonthly: 15,
};

export function domainCost(
  products: ProductBreakdownRow[],
  keywords: string[],
  estimate?: { volume: number; unitPrice: number; unit: string } | { amount: number; note: string }
): CostFigure | null {
  const matched = products.filter(p =>
    keywords.some(k => p.metricKey.toLowerCase().includes(k) || p.name.toLowerCase().includes(k))
  );
  const real = matched.reduce((s, p) => s + p.committedCost + p.onDemandCost, 0);
  if (real > 0) return { amount: Math.round(real), source: 'real' };
  if (!estimate) return null;
  if ('amount' in estimate) {
    return estimate.amount > 0 ? { amount: Math.round(estimate.amount), source: 'estimated', note: estimate.note } : null;
  }
  if (estimate.volume > 0 && estimate.unitPrice > 0) {
    return {
      amount: Math.round(estimate.volume * estimate.unitPrice),
      source: 'estimated',
      note: `${estimate.volume.toLocaleString()} ${estimate.unit} × $${estimate.unitPrice} list price`,
    };
  }
  return null;
}

export { PRICING_ESTIMATES };

// ── Recommendation generators — pure functions over already-fetched data ──────────

export function infrastructureRecommendations(input: {
  totalHosts: number; tagCoverage: { env: number; service: number; version: number; team: number };
}): string[] {
  const recs: string[] = [];
  const { tagCoverage, totalHosts } = input;
  if (totalHosts === 0) return ['No hosts detected in this scan.'];
  if (tagCoverage.env < 80) recs.push(`env tag coverage is ${tagCoverage.env}% — untagged hosts can't be filtered by environment in dashboards/monitors.`);
  if (tagCoverage.service < 80) recs.push(`service tag coverage is ${tagCoverage.service}% — link hosts to owning services for cleaner cost/ownership attribution.`);
  if (tagCoverage.team < 60) recs.push(`team tag coverage is ${tagCoverage.team}% — this is the biggest blocker to routing alerts/costs to the right team.`);
  if (recs.length === 0) recs.push('Tag coverage is healthy across env/service/version/team.');
  return recs;
}

export function customMetricsRecommendations(input: {
  risk: 'low' | 'medium' | 'high'; utilizationPct: number; topDrivers: Array<{ key: string; uniqueValues: number }>;
}): string[] {
  const recs: string[] = [];
  if (input.risk === 'high') recs.push(`Custom metrics utilization is ${input.utilizationPct}% of the standard allotment — likely already incurring on-demand overage charges.`);
  else if (input.risk === 'medium') recs.push(`Custom metrics utilization is ${input.utilizationPct}% — monitor closely, on-demand billing kicks in above 100%.`);
  if (input.topDrivers[0]) recs.push(`"${input.topDrivers[0].key}" is the top cardinality driver with ${input.topDrivers[0].uniqueValues} unique values — check whether it needs to be that granular (e.g. avoid tagging with request IDs or timestamps).`);
  if (recs.length === 0) recs.push('Custom metrics volume is within a healthy range for the current host count.');
  return recs;
}

export function logsRecommendations(input: {
  totalIndexes: number; totalExclusionFilters: number; rateLimitedCount: number;
  flexIndexCount: number; totalDailyLimitEvents: number;
}): string[] {
  const recs: string[] = [];
  if (input.totalIndexes === 0) return ['No log indexes detected in this scan.'];
  if (input.totalExclusionFilters === 0) recs.push('No exclusion filters configured on any index — 100% of ingested logs are being indexed, which is the single biggest lever for reducing log costs.');
  if (input.rateLimitedCount > 0) recs.push(`${input.rateLimitedCount} index(es) are hitting their daily limit — logs beyond the cap are silently dropped, which can hide real signal.`);
  if (input.flexIndexCount === 0) recs.push('No Flex Logs indexes detected — moving low-query, long-retention indexes to Flex tier typically cuts indexing cost significantly.');
  if (input.totalDailyLimitEvents === 0) recs.push('No daily limits set on any index — an unexpected traffic spike has no cost ceiling.');
  if (recs.length === 0) recs.push('Log pipeline hygiene looks solid: exclusion filters, daily limits, and Flex tier usage are all in place.');
  return recs;
}

export function syntheticsRecommendations(input: {
  apiTests: number; browserTests: number; details: Array<{ locations: number; type: string }>;
}): string[] {
  const recs: string[] = [];
  const total = input.apiTests + input.browserTests;
  if (total === 0) return ['No synthetic tests detected in this scan.'];
  const browserRatio = input.browserTests / total;
  if (browserRatio > 0.5) recs.push(`${Math.round(browserRatio * 100)}% of tests are browser tests, which cost significantly more per run than API tests — check whether some can be converted to API tests.`);
  const highLocationTests = input.details.filter(d => d.locations > 5).length;
  if (highLocationTests > 0) recs.push(`${highLocationTests} test(s) run from more than 5 locations — each additional location multiplies run cost linearly, confirm the geographic spread is actually needed.`);
  if (recs.length === 0) recs.push('Synthetic test mix and location spread look cost-efficient.');
  return recs;
}

export function apmRecommendations(input: {
  totalServices: number; svcInCatalog: number; svcWithMonitor: number; svcWithSLO: number;
}): string[] {
  const recs: string[] = [];
  if (input.totalServices === 0) return ['No APM services detected in this scan.'];
  const catalogPct = Math.round((input.svcInCatalog / input.totalServices) * 100);
  const monitorPct = Math.round((input.svcWithMonitor / input.totalServices) * 100);
  const sloPct = Math.round((input.svcWithSLO / input.totalServices) * 100);
  if (catalogPct < 80) recs.push(`Only ${catalogPct}% of services are registered in the Service Catalog — this limits ownership visibility and dependency mapping.`);
  if (monitorPct < 80) recs.push(`Only ${monitorPct}% of services have a monitor — services without alerting can fail silently.`);
  if (sloPct < 50) recs.push(`Only ${sloPct}% of services have an SLO — consider defining error-rate/latency SLOs for customer-facing services first.`);
  if (recs.length === 0) recs.push('APM service coverage (catalog, monitors, SLOs) is in good shape.');
  return recs;
}

export function integrationsRecommendations(input: {
  total: number; configured: number; enabled: number;
}): string[] {
  const recs: string[] = [];
  if (input.total === 0) return ['No integrations detected in this scan.'];
  const configuredNotEnabled = input.configured - input.enabled;
  if (configuredNotEnabled > 0) recs.push(`${configuredNotEnabled} integration(s) are configured but not enabled — this is a silent data gap, metrics/logs stop flowing with no obvious error.`);
  const unconfigured = input.total - input.configured;
  if (unconfigured > 0) recs.push(`${unconfigured} integration(s) detected but not fully configured — verify whether they're intentionally partial or need setup.`);
  if (recs.length === 0) recs.push('All detected integrations are configured and enabled.');
  return recs;
}

export function monitorsRecommendations(input: {
  total: number; mutedCount: number; withoutNotification: number;
  withoutEnvTag: number; withoutServiceTag: number; withoutTeamTag: number;
}): string[] {
  const recs: string[] = [];
  if (input.total === 0) return ['No monitors detected in this scan.'];
  if (input.mutedCount > input.total * 0.2) recs.push(`${input.mutedCount} monitors (>20%) are muted — a high mute rate usually signals alert fatigue or noisy thresholds worth tuning instead of silencing.`);
  if (input.withoutNotification > 0) recs.push(`${input.withoutNotification} monitor(s) have no notification channel — alerts fire but nobody gets paged.`);
  if (input.withoutTeamTag > input.total * 0.5) recs.push(`${input.withoutTeamTag} monitor(s) (>50%) are missing a team tag — alerts can't be routed to the owning team.`);
  if (recs.length === 0) recs.push('Monitor hygiene (mute rate, notifications, tagging) looks healthy.');
  return recs;
}

export function sloRecommendations(input: { total: number; svcWithSLO: number; totalServices: number }): string[] {
  const recs: string[] = [];
  if (input.total === 0) return ['No SLOs detected — consider defining at least one SLO (error rate or latency) per customer-facing service.'];
  if (input.totalServices > 0 && input.svcWithSLO / input.totalServices < 0.5) {
    recs.push(`Only ${input.svcWithSLO} of ${input.totalServices} APM services have an SLO — prioritize the highest-traffic or most customer-facing ones first.`);
  }
  if (recs.length === 0) recs.push('SLO coverage across APM services looks solid.');
  return recs;
}

export function governanceRecommendations(input: {
  userCount: number | null; roleCount: number | null; findingsCount: number; teamTagCoveragePct: number;
}): string[] {
  const recs: string[] = [];
  if (input.findingsCount > 0) recs.push(`${input.findingsCount} governance/tagging finding(s) open — these directly affect ownership and access clarity.`);
  if (input.teamTagCoveragePct < 60) recs.push(`Team tag coverage is ${input.teamTagCoveragePct}% — this is the primary signal for "who owns this," and it's the first thing to fix for governance maturity.`);
  if (input.roleCount != null && input.roleCount <= 3) recs.push(`Only ${input.roleCount} role(s) detected — very few custom roles usually means broad, non-least-privilege access.`);
  if (recs.length === 0) recs.push('No major governance gaps detected in this scan.');
  return recs;
}

export function rumRecommendations(input: { total: number; byType: Record<string, number> }): string[] {
  if (input.total === 0) return ['No RUM applications detected — RUM provides frontend performance, error tracking, and session replay visibility that backend APM alone can\'t.'];
  const recs: string[] = [];
  if (!input.byType['ios'] && !input.byType['android']) recs.push('No mobile (iOS/Android) RUM applications detected — if this org ships a mobile app, confirm whether it should be instrumented.');
  if (recs.length === 0) recs.push('RUM application coverage looks reasonable for the detected app types.');
  return recs;
}

export function fleetRecommendations(input: { agentVersions: Record<string, number> }): string[] {
  const entries = Object.entries(input.agentVersions);
  if (entries.length === 0) return ['No Agent version data collected.'];
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const outdated = entries.filter(([ver]) => parseInt(ver.replace('.x', '')) < 7).reduce((s, [, n]) => s + n, 0);
  if (outdated > 0) return [`${outdated} of ${total} hosts (${Math.round((outdated / total) * 100)}%) run an Agent version older than 7.x — upgrade for current features and security fixes.`];
  return ['Agent fleet is on modern (7.x+) versions across all hosts.'];
}

export function securityRecommendations(input: {
  total: number; unresolvedCritical: number; openIncidents: number; totalIncidents: number;
}): string[] {
  const recs: string[] = [];
  if (input.unresolvedCritical > 0) recs.push(`${input.unresolvedCritical} unresolved critical/high security finding(s) — triage these first.`);
  if (input.openIncidents > 0) recs.push(`${input.openIncidents} of ${input.totalIncidents} incidents are still open — confirm each has an owner and a postmortem plan.`);
  if (recs.length === 0 && input.total === 0 && input.totalIncidents === 0) recs.push('No security findings or incidents recorded in this scan.');
  else if (recs.length === 0) recs.push('No unresolved critical findings or open incidents — security posture looks stable.');
  return recs;
}

export function proxyRecommendations(input: { npm: number; ndm: number; dbm: number }): string[] {
  const recs: string[] = [];
  if (input.dbm === 0) recs.push('No database-integration signal detected — if this org runs Postgres/MySQL/Oracle/MongoDB/SQL Server, confirm manually whether DBM should be enabled.');
  if (input.npm === 0 && input.ndm === 0) recs.push('No network-monitoring signal detected — this is a proxy heuristic, not a real collector, so verify directly in Datadog if CNM/NDM matters here.');
  if (recs.length === 0) recs.push('Network/database integration signals were detected — confirm the underlying products (CNM/NDM/DBM) are actually enabled, since this is a proxy signal.');
  return recs;
}

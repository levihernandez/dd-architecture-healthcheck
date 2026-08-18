import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDTeamLink, DDTeamMembership, DDScorecardRule, DDScorecardOutcome } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

interface TeamResourceRow {
  resource_id: string;
  resource_name: string | null;
  raw_json: string | null;
}

async function fetchTeamMembers(client: DatadogClient, teamId: string): Promise<{ count: number; handles: string[] }> {
  const res = await client.getRaw<{
    data?: DDTeamMembership[];
    included?: Array<{ type: string; id: string; attributes?: { handle?: string; email?: string } }>;
  }>(`/api/v2/team/${teamId}/memberships`, { include: 'user', 'page[size]': 100 });

  if (res.status !== 'success' || !res.data) return { count: 0, handles: [] };
  const userById = new Map(
    (res.data.included ?? []).filter((i) => i.type === 'users')
      .map((u) => [u.id, u.attributes?.handle ?? u.attributes?.email ?? u.id])
  );
  const handles = (res.data.data ?? []).map((m) => userById.get(m.relationships?.user?.data?.id ?? '') ?? 'unknown');
  return { count: handles.length, handles };
}

async function fetchTeamLinks(client: DatadogClient, teamId: string): Promise<{ count: number; labels: string[] }> {
  const res = await client.getRaw<{ data?: DDTeamLink[] }>(`/api/v2/team/${teamId}/links`);
  if (res.status !== 'success' || !res.data?.data) return { count: 0, labels: [] };
  return { count: res.data.data.length, labels: res.data.data.map((l) => l.attributes?.label ?? l.attributes?.url ?? 'link') };
}

// Best-effort: Datadog's DORA Metrics product computes these under the `dora.*`
// metric namespace once deployment/failure events are ingested (via CI provider
// integrations or the ingestion API). There is no dedicated "read the computed
// DORA KPIs" REST resource, so detection goes through the standard Metrics query
// API — an empty result here means DORA isn't configured yet, not that the
// collector failed.
async function queryDoraMetric(
  client: DatadogClient, query: string, fromSec: number, toSec: number
): Promise<{ detected: boolean; value: number | null }> {
  const res = await client.getRaw<{ series?: Array<{ pointlist?: Array<[number, number | null]> }> }>(
    '/api/v1/query', { query, from: fromSec, to: toSec }
  );
  if (res.status !== 'success' || !res.data?.series?.length) return { detected: false, value: null };
  const points = res.data.series.flatMap((s) => s.pointlist ?? []).filter((p) => p[1] != null);
  if (points.length === 0) return { detected: false, value: null };
  const sum = points.reduce((s, p) => s + (p[1] ?? 0), 0);
  return { detected: true, value: sum / points.length };
}

export async function collectIdp(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting IDP maturity data (teams, scorecards, DORA)`);

  const db = getDatabase();
  const now = new Date().toISOString();
  let totalItems = 0;
  let requestCount = 0;

  // ── Teams: enrich the team list governance.collector.ts already stored in
  // `resources` (resource_type='team') with per-team membership and links data.
  const teamRows = db.prepare(
    `SELECT resource_id, resource_name, raw_json FROM resources WHERE org_id = ? AND scan_run_id = ? AND resource_type = 'team'`
  ).all(orgId, scanRunId) as TeamResourceRow[];

  const insertTeam = db.prepare(`
    INSERT OR REPLACE INTO teams
      (id, org_id, scan_run_id, team_id, team_name, handle, description,
       user_count, link_count, member_handles, link_labels, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const t of teamRows) {
    let snapshot: { handle?: string; user_count?: number } = {};
    try { snapshot = t.raw_json ? JSON.parse(t.raw_json) : {}; } catch { /* malformed snapshot */ }

    const [members, links] = await Promise.all([
      fetchTeamMembers(client, t.resource_id),
      fetchTeamLinks(client, t.resource_id),
    ]);
    requestCount += 2;

    insertTeam.run(
      uuidv4(), orgId, scanRunId,
      t.resource_id, t.resource_name, snapshot.handle ?? null, null,
      Math.max(members.count, snapshot.user_count ?? 0), links.count,
      JSON.stringify(members.handles), JSON.stringify(links.labels),
      safeJsonSnapshot({ team_id: t.resource_id, name: t.resource_name, member_count: members.count, link_count: links.count }),
      now, now
    );
    totalItems++;
  }

  // ── Scorecards ──────────────────────────────────────────────────────────────
  const rulesResult = await client.getV2Paginated<DDScorecardRule>('/api/v2/scorecard/rules');
  requestCount += rulesResult.requestCount;

  const ruleNameById = new Map<string, string>();
  if (rulesResult.status === 'success') {
    const insertRule = db.prepare(`
      INSERT OR REPLACE INTO scorecard_rules
        (id, org_id, scan_run_id, rule_id, rule_name, description, enabled, is_custom, raw_json, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const txn = db.transaction((rules: DDScorecardRule[]) => {
      for (const rule of rules) {
        ruleNameById.set(rule.id, rule.attributes?.name ?? rule.id);
        insertRule.run(
          uuidv4(), orgId, scanRunId,
          rule.id, rule.attributes?.name ?? null, rule.attributes?.description ?? null,
          rule.attributes?.enabled ? 1 : 0, rule.attributes?.custom ? 1 : 0,
          safeJsonSnapshot(rule), now, now
        );
      }
    });
    try { txn(rulesResult.data); } catch (err) { logger.error(`[${orgId}] Failed to store scorecard rules`, err); }
    totalItems += rulesResult.itemCount;
  }

  const outcomesResult = rulesResult.status === 'success'
    ? await client.getV2Paginated<DDScorecardOutcome>('/api/v2/scorecard/outcomes')
    : null;
  if (outcomesResult) requestCount += outcomesResult.requestCount;

  if (outcomesResult?.status === 'success') {
    const insertOutcome = db.prepare(`
      INSERT OR REPLACE INTO scorecard_outcomes
        (id, org_id, scan_run_id, rule_id, rule_name, service_name, state, remarks, raw_json, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const txn = db.transaction((outcomes: DDScorecardOutcome[]) => {
      for (const o of outcomes) {
        const ruleId = o.attributes?.rule_id ?? o.relationships?.rule?.data?.id ?? '';
        insertOutcome.run(
          uuidv4(), orgId, scanRunId,
          ruleId, ruleNameById.get(ruleId) ?? ruleId,
          o.attributes?.service ?? null, o.attributes?.outcome ?? null,
          JSON.stringify((o.attributes?.remarks ?? []).map((r) => r.message).filter(Boolean)),
          safeJsonSnapshot(o), now, now
        );
      }
    });
    try { txn(outcomesResult.data); } catch (err) { logger.error(`[${orgId}] Failed to store scorecard outcomes`, err); }
    totalItems += outcomesResult.itemCount;
  }

  // ── DORA metrics (best-effort detection — see queryDoraMetric) ──────────────
  const toSec = Math.floor(Date.now() / 1000);
  const fromSec = toSec - 30 * 24 * 60 * 60;
  const doraQueries: Array<[string, string]> = [
    ['deployment_frequency', 'sum:dora.deployment.count{*}.as_count()'],
    ['lead_time_for_changes', 'avg:dora.deployment.lead_time{*}'],
    ['change_failure_rate', 'sum:dora.failure.count{*}.as_count()'],
    ['time_to_restore', 'avg:dora.failure.time_to_restore{*}'],
  ];

  const insertSignal = db.prepare(`
    INSERT OR REPLACE INTO product_usage_signals
      (id, org_id, scan_run_id, product, signal, value, detected, evidence, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let doraDetectedAny = false;
  for (const [signal, query] of doraQueries) {
    const result = await queryDoraMetric(client, query, fromSec, toSec);
    requestCount++;
    if (result.detected) doraDetectedAny = true;
    insertSignal.run(
      uuidv4(), orgId, scanRunId, 'dora', signal,
      result.value != null ? String(result.value) : null,
      result.detected ? 1 : 0,
      JSON.stringify({ query, windowDays: 30, note: 'Best-effort detection via the dora.* metric namespace — empty means DORA Metrics is not yet configured for this org.' }),
      now
    );
  }
  totalItems += doraQueries.length;

  logger.info(`[${orgId}] Collected IDP maturity data (${totalItems} items, DORA detected=${doraDetectedAny}) in ${Date.now() - start}ms`);
  return {
    collector: 'idp',
    status: 'success',
    itemCount: totalItems,
    durationMs: Date.now() - start,
    endpoint: '/api/v2/team/{id}/memberships, /api/v2/team/{id}/links, /api/v2/scorecard/rules, /api/v2/scorecard/outcomes, /api/v1/query',
    requestCount,
    pageCount: rulesResult.pageCount + (outcomesResult?.pageCount ?? 0),
    truncated: rulesResult.truncated || Boolean(outcomesResult?.truncated),
    rateLimitRemaining: rulesResult.rateLimitRemaining,
  };
}

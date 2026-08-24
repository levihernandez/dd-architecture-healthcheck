import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDTeamLink, DDTeamMembership, DDScorecardRule, DDScorecardOutcome } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

interface TeamResourceRow {
  org_id: string;
  scan_run_id: string;
  resource_type: string;
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
  const teamRows = await db<TeamResourceRow>('resources')
    .where({ org_id: orgId, scan_run_id: scanRunId, resource_type: 'team' })
    .select('resource_id', 'resource_name', 'raw_json');

  for (const t of teamRows) {
    let snapshot: { handle?: string; user_count?: number } = {};
    try { snapshot = t.raw_json ? JSON.parse(t.raw_json) : {}; } catch { /* malformed snapshot */ }

    const [members, links] = await Promise.all([
      fetchTeamMembers(client, t.resource_id),
      fetchTeamLinks(client, t.resource_id),
    ]);
    requestCount += 2;

    // `teams` has a unique(org_id, team_id) constraint (not on id), so the
    // original INSERT OR REPLACE deletes any existing row for this team and
    // inserts a fresh one (including a new id) — replicate that exactly with
    // an explicit delete+insert rather than onConflict().merge(), since a
    // composite/partial unique target can behave differently across the
    // sqlite and postgres dialects this app supports.
    await db('teams').where({ org_id: orgId, team_id: t.resource_id }).delete();
    await db('teams').insert({
      id: uuidv4(), org_id: orgId, scan_run_id: scanRunId,
      team_id: t.resource_id, team_name: t.resource_name, handle: snapshot.handle ?? null, description: null,
      user_count: Math.max(members.count, snapshot.user_count ?? 0), link_count: links.count,
      member_handles: JSON.stringify(members.handles), link_labels: JSON.stringify(links.labels),
      raw_json: safeJsonSnapshot({ team_id: t.resource_id, name: t.resource_name, member_count: members.count, link_count: links.count }),
      first_seen: now, last_seen: now,
    });
    totalItems++;
  }

  // ── Scorecards ──────────────────────────────────────────────────────────────
  const rulesResult = await client.getV2Paginated<DDScorecardRule>('/api/v2/scorecard/rules');
  requestCount += rulesResult.requestCount;

  const ruleNameById = new Map<string, string>();
  if (rulesResult.status === 'success') {
    try {
      await db.transaction(async (trx) => {
        for (const rule of rulesResult.data) {
          ruleNameById.set(rule.id, rule.attributes?.name ?? rule.id);
          // `scorecard_rules` has unique(org_id, rule_id) — see teams note above
          // for why this is an explicit delete+insert instead of onConflict().merge().
          await trx('scorecard_rules').where({ org_id: orgId, rule_id: rule.id }).delete();
          await trx('scorecard_rules').insert({
            id: uuidv4(), org_id: orgId, scan_run_id: scanRunId,
            rule_id: rule.id, rule_name: rule.attributes?.name ?? null, description: rule.attributes?.description ?? null,
            enabled: rule.attributes?.enabled ? 1 : 0, is_custom: rule.attributes?.custom ? 1 : 0,
            raw_json: safeJsonSnapshot(rule), first_seen: now, last_seen: now,
          });
        }
      });
    } catch (err) { logger.error(`[${orgId}] Failed to store scorecard rules`, err); }
    totalItems += rulesResult.itemCount;
  }

  const outcomesResult = rulesResult.status === 'success'
    ? await client.getV2Paginated<DDScorecardOutcome>('/api/v2/scorecard/outcomes')
    : null;
  if (outcomesResult) requestCount += outcomesResult.requestCount;

  if (outcomesResult?.status === 'success') {
    try {
      await db.transaction(async (trx) => {
        for (const o of outcomesResult.data) {
          const ruleId = o.attributes?.rule_id ?? o.relationships?.rule?.data?.id ?? '';
          const serviceName = o.attributes?.service ?? null;
          // `scorecard_outcomes` has unique(org_id, scan_run_id, rule_id, service_name)
          // — see teams note above for why this is an explicit delete+insert
          // instead of onConflict().merge().
          await trx('scorecard_outcomes')
            .where({ org_id: orgId, scan_run_id: scanRunId, rule_id: ruleId, service_name: serviceName })
            .delete();
          await trx('scorecard_outcomes').insert({
            id: uuidv4(), org_id: orgId, scan_run_id: scanRunId,
            rule_id: ruleId, rule_name: ruleNameById.get(ruleId) ?? ruleId,
            service_name: serviceName, state: o.attributes?.outcome ?? null,
            remarks: JSON.stringify((o.attributes?.remarks ?? []).map((r) => r.message).filter(Boolean)),
            raw_json: safeJsonSnapshot(o), first_seen: now, last_seen: now,
          });
        }
      });
    } catch (err) { logger.error(`[${orgId}] Failed to store scorecard outcomes`, err); }
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

  let doraDetectedAny = false;
  for (const [signal, query] of doraQueries) {
    const result = await queryDoraMetric(client, query, fromSec, toSec);
    requestCount++;
    if (result.detected) doraDetectedAny = true;
    // `product_usage_signals` has unique(org_id, product, signal) — see teams
    // note above for why this is an explicit delete+insert instead of
    // onConflict().merge().
    await db('product_usage_signals').where({ org_id: orgId, product: 'dora', signal }).delete();
    await db('product_usage_signals').insert({
      id: uuidv4(), org_id: orgId, scan_run_id: scanRunId, product: 'dora', signal,
      value: result.value != null ? String(result.value) : null,
      detected: result.detected ? 1 : 0,
      evidence: JSON.stringify({ query, windowDays: 30, note: 'Best-effort detection via the dora.* metric namespace — empty means DORA Metrics is not yet configured for this org.' }),
      checked_at: now,
    });
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

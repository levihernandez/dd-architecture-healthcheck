import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDRumApplication } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

export async function collectRUM(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting RUM applications`);

  const db = getDatabase();
  const now = new Date().toISOString();

  const result = await client.getV2Paginated<DDRumApplication>('/api/v2/rum/applications');

  if (result.status !== 'success') {
    logger.info(`[${orgId}] RUM applications: ${result.status}`);
    return {
      collector: 'rum',
      status: result.status,
      itemCount: 0,
      error: result.error,
      durationMs: Date.now() - start,
      endpoint: result.endpoint,
      requestCount: result.requestCount,
      pageCount: result.pageCount,
      truncated: result.truncated,
      rateLimitRemaining: result.rateLimitRemaining,
    };
  }

  try {
    await db.transaction(async (trx) => {
      for (const app of result.data) {
        const attrs = app.attributes;
        const appId = attrs.application_id ?? app.id;
        const token = attrs.client_token;
        // Store first 8 chars of client token as a hint (these are non-secret public tokens)
        const tokenHint = token ? token.slice(0, 12) + '...' : null;
        const createdMs = attrs.created_at;

        // `rum_applications` has unique(org_id, app_id) — the original
        // INSERT OR REPLACE deletes any existing row for this app and inserts
        // a fresh one (including a new id). Replicated here as an explicit
        // delete+insert rather than onConflict().merge(), since a composite
        // unique target can behave differently across the sqlite and postgres
        // dialects this app supports.
        await trx('rum_applications').where({ org_id: orgId, app_id: appId }).delete();
        await trx('rum_applications').insert({
          id: uuidv4(), org_id: orgId, scan_run_id: scanRunId,
          app_id: appId,
          app_name: attrs.name ?? null,
          app_type: attrs.type ?? null,
          framework: attrs.framework ?? null,
          client_token_hint: tokenHint,
          created_at_dd: createdMs ? new Date(createdMs).toISOString() : null,
          raw_json: safeJsonSnapshot({ id: appId, name: attrs.name, type: attrs.type, framework: attrs.framework }),
          first_seen: now, last_seen: now,
        });
      }
    });
  } catch (err) {
    logger.error(`[${orgId}] Failed to store RUM application data`, err);
  }

  // Also write a summary signal for analytics
  if (result.itemCount > 0) {
    const byType: Record<string, number> = {};
    for (const app of result.data) {
      const t = app.attributes.type ?? 'unknown';
      byType[t] = (byType[t] ?? 0) + 1;
    }
    // `product_usage_signals` has unique(org_id, product, signal) — see note
    // above for why this is an explicit delete+insert instead of
    // onConflict().merge().
    await db('product_usage_signals').where({ org_id: orgId, product: 'rum', signal: 'applications' }).delete();
    await db('product_usage_signals').insert({
      id: uuidv4(), org_id: orgId, scan_run_id: scanRunId,
      product: 'rum', signal: 'applications',
      value: String(result.itemCount), detected: 1,
      evidence: JSON.stringify(byType), checked_at: now,
    });
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} RUM applications in ${Date.now() - start}ms`);
  return {
    collector: 'rum',
    status: 'success',
    itemCount: result.itemCount,
    durationMs: Date.now() - start,
    endpoint: result.endpoint,
    requestCount: result.requestCount,
    pageCount: result.pageCount,
    truncated: result.truncated,
    rateLimitRemaining: result.rateLimitRemaining,
  };
}

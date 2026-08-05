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

  const insert = db.prepare(`
    INSERT OR REPLACE INTO rum_applications
      (id, org_id, scan_run_id, app_id, app_name, app_type, framework,
       client_token_hint, created_at_dd, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction((apps: DDRumApplication[]) => {
    for (const app of apps) {
      const attrs = app.attributes;
      const appId = attrs.application_id ?? app.id;
      const token = attrs.client_token;
      // Store first 8 chars of client token as a hint (these are non-secret public tokens)
      const tokenHint = token ? token.slice(0, 12) + '...' : null;
      const createdMs = attrs.created_at;

      insert.run(
        uuidv4(), orgId, scanRunId,
        appId,
        attrs.name ?? null,
        attrs.type ?? null,
        attrs.framework ?? null,
        tokenHint,
        createdMs ? new Date(createdMs).toISOString() : null,
        safeJsonSnapshot({ id: appId, name: attrs.name, type: attrs.type, framework: attrs.framework }),
        now, now
      );
    }
  });

  try {
    txn(result.data);
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
    db.prepare(`
      INSERT OR REPLACE INTO product_usage_signals
        (id, org_id, scan_run_id, product, signal, value, detected, evidence, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), orgId, scanRunId,
      'rum', 'applications',
      String(result.itemCount), 1,
      JSON.stringify(byType), now
    );
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

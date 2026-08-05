import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDIncident } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

const ENDPOINT = '/api/v2/incidents';

export async function collectIncidents(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting incidents`);

  const result = await client.getV2Paginated<DDIncident>(ENDPOINT, {}, 50);

  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO permissions_report
      (id, org_id, scan_run_id, endpoint, status, status_code, error, tested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), orgId, scanRunId, ENDPOINT, result.status, null, result.error ?? null, now);

  if (result.status !== 'success') {
    return {
      collector: 'incidents',
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
    INSERT OR REPLACE INTO incidents
      (id, org_id, scan_run_id, incident_id, title, severity, state,
       created_at_dd, resolved_at_dd, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction((incidents: DDIncident[]) => {
    for (const incident of incidents) {
      const incidentId = incident.id;
      if (!incidentId) continue;
      const attrs = incident.attributes;
      insert.run(
        uuidv4(), orgId, scanRunId, incidentId,
        attrs?.title ?? null,
        attrs?.fields?.severity?.value ?? attrs?.severity ?? null,
        attrs?.state ?? null,
        attrs?.created ?? null,
        attrs?.resolved ?? null,
        safeJsonSnapshot(incident),
        now, now
      );
    }
  });

  try { txn(result.data); } catch (err) {
    logger.error(`[${orgId}] Failed to store incidents`, err);
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} incidents in ${Date.now() - start}ms`);
  return {
    collector: 'incidents',
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

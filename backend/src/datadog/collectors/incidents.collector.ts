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
  await db('permissions_report').insert({
    id: uuidv4(),
    org_id: orgId,
    scan_run_id: scanRunId,
    endpoint: ENDPOINT,
    status: result.status,
    status_code: null,
    error: result.error ?? null,
    tested_at: now,
  });

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

  const incidentRows: Record<string, unknown>[] = [];
  for (const incident of result.data) {
    const incidentId = incident.id;
    if (!incidentId) continue;
    const attrs = incident.attributes;
    incidentRows.push({
      id: uuidv4(),
      org_id: orgId,
      scan_run_id: scanRunId,
      incident_id: incidentId,
      title: attrs?.title ?? null,
      severity: attrs?.fields?.severity?.value ?? attrs?.severity ?? null,
      state: attrs?.state ?? null,
      created_at_dd: attrs?.created ?? null,
      resolved_at_dd: attrs?.resolved ?? null,
      raw_json: safeJsonSnapshot(incident),
      first_seen: now,
      last_seen: now,
    });
  }

  try {
    if (incidentRows.length > 0) {
      await db.transaction(async (trx) => {
        await trx('incidents').insert(incidentRows);
      });
    }
  } catch (err) {
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

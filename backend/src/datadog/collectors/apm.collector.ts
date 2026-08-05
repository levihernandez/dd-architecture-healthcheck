import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDService } from '../../types/datadog.types';
import type { CollectorResultSummary, CollectionLimits } from '../../types/api.types';

export async function collectAPM(
  client: DatadogClient,
  orgId: string,
  scanRunId: string,
  limits?: CollectionLimits
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting APM services`);

  // Services endpoint (v1) — paginated so orgs with >5000 services aren't silently truncated
  const result = await client.getPaginated<DDService>('/api/v1/services', {}, limits?.maxPagesServices ?? 100);

  if (result.status !== 'success' && result.status !== 'not_available') {
    return {
      collector: 'apm',
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

  // Also try the newer APM stats endpoint to discover env/version
  const spanStatsResult = await client.get<Record<string, unknown>>(
    '/api/v1/metrics',
    { from: Math.floor(Date.now() / 1000) - 3600, query: 'trace.*' }
  );

  const db = getDatabase();
  const now = new Date().toISOString();

  const insertService = db.prepare(`
    INSERT OR REPLACE INTO services
      (id, org_id, scan_run_id, service_name, env, version, team,
       has_service_catalog, has_monitor, has_slo, has_version_tag, has_owner,
       resource_count, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertResource = db.prepare(`
    INSERT OR REPLACE INTO resources
      (id, org_id, scan_run_id, resource_type, resource_id, resource_name,
       source_endpoint, first_seen, last_seen, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction((services: DDService[]) => {
    for (const svc of services) {
      if (!svc.service_name) continue;
      const hasVersion = Boolean(svc.version);

      insertService.run(
        uuidv4(), orgId, scanRunId,
        svc.service_name, svc.env ?? null, svc.version ?? null, svc.team ?? null,
        0, 0, 0,
        hasVersion ? 1 : 0,
        svc.team ? 1 : 0,
        svc.resources?.length ?? 0,
        safeJsonSnapshot(svc),
        now, now
      );

      insertResource.run(
        uuidv4(), orgId, scanRunId, 'service',
        `${svc.service_name}:${svc.env ?? 'unknown'}`,
        svc.service_name,
        '/api/v1/services', now, now,
        safeJsonSnapshot(svc)
      );
    }
  });

  if (result.data.length > 0) {
    try { txn(result.data); } catch (err) {
      logger.error(`[${orgId}] Failed to store APM data`, err);
    }
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} APM services in ${Date.now() - start}ms`);
  return {
    collector: 'apm',
    status: result.status === 'success' ? 'success' : 'not_available',
    itemCount: result.itemCount,
    durationMs: Date.now() - start,
    endpoint: `${result.endpoint}, ${spanStatsResult.endpoint}`,
    requestCount: result.requestCount + spanStatsResult.requestCount,
    pageCount: result.pageCount + spanStatsResult.pageCount,
    truncated: result.truncated,
    rateLimitRemaining: spanStatsResult.rateLimitRemaining ?? result.rateLimitRemaining,
  };
}

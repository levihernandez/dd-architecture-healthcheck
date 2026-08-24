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

  const serviceRows: Record<string, unknown>[] = [];
  const resourceRows: Record<string, unknown>[] = [];

  for (const svc of result.data) {
    if (!svc.service_name) continue;
    const hasVersion = Boolean(svc.version);

    serviceRows.push({
      id: uuidv4(),
      org_id: orgId,
      scan_run_id: scanRunId,
      service_name: svc.service_name,
      env: svc.env ?? null,
      version: svc.version ?? null,
      team: svc.team ?? null,
      has_service_catalog: 0,
      has_monitor: 0,
      has_slo: 0,
      has_version_tag: hasVersion ? 1 : 0,
      has_owner: svc.team ? 1 : 0,
      resource_count: svc.resources?.length ?? 0,
      raw_json: safeJsonSnapshot(svc),
      first_seen: now,
      last_seen: now,
    });

    resourceRows.push({
      id: uuidv4(),
      org_id: orgId,
      scan_run_id: scanRunId,
      resource_type: 'service',
      resource_id: `${svc.service_name}:${svc.env ?? 'unknown'}`,
      resource_name: svc.service_name,
      source_endpoint: '/api/v1/services',
      first_seen: now,
      last_seen: now,
      raw_json: safeJsonSnapshot(svc),
    });
  }

  if (serviceRows.length > 0) {
    try {
      await db.transaction(async (trx) => {
        await trx('services').insert(serviceRows);
        await trx('resources').insert(resourceRows);
      });
    } catch (err) {
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

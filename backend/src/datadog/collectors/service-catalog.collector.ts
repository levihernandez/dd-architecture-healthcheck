import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDServiceCatalogEntry } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

export async function collectServiceCatalog(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting service catalog`);

  const result = await client.getV2Paginated<DDServiceCatalogEntry>(
    '/api/v2/catalog/entity',
    { 'filter[kind]': 'service' }
  );

  if (result.status !== 'success') {
    return {
      collector: 'service_catalog',
      status: result.status,
      itemCount: 0,
      error: result.error,
      durationMs: Date.now() - start,
    };
  }

  const db = getDatabase();
  const now = new Date().toISOString();

  const insertCatalog = db.prepare(`
    INSERT OR REPLACE INTO service_catalog
      (id, org_id, scan_run_id, service_name, team, owner, tier, lifecycle,
       description, tags, contacts, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateServiceHasCatalog = db.prepare(`
    UPDATE services SET has_service_catalog = 1
    WHERE org_id = ? AND service_name = ?
  `);

  const txn = db.transaction((entries: DDServiceCatalogEntry[]) => {
    for (const entry of entries) {
      const schema = entry.attributes?.schema;
      const serviceName = schema?.['dd-service'] ?? entry.id ?? 'unknown';
      const team = schema?.['dd-team'] ?? entry.attributes?.teams?.[0];
      const owner = entry.attributes?.owner;
      const tags = schema?.tags ?? entry.attributes?.tags ?? [];
      const contacts = schema?.contacts ?? [];

      insertCatalog.run(
        uuidv4(), orgId, scanRunId,
        serviceName,
        team ?? null,
        owner ?? null,
        schema?.tier ?? null,
        schema?.lifecycle ?? null,
        schema?.description ?? null,
        JSON.stringify(tags),
        JSON.stringify(contacts),
        safeJsonSnapshot({ service_name: serviceName, team, owner, tier: schema?.tier,
          lifecycle: schema?.lifecycle, tags }),
        now, now
      );

      // Mark corresponding service entry
      updateServiceHasCatalog.run(orgId, serviceName);
    }
  });

  try { txn(result.data); } catch (err) {
    logger.error(`[${orgId}] Failed to store service catalog data`, err);
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} service catalog entries in ${Date.now() - start}ms`);
  return {
    collector: 'service_catalog',
    status: 'success',
    itemCount: result.itemCount,
    durationMs: Date.now() - start,
  };
}

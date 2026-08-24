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
      endpoint: result.endpoint,
      requestCount: result.requestCount,
      pageCount: result.pageCount,
      truncated: result.truncated,
      rateLimitRemaining: result.rateLimitRemaining,
    };
  }

  const db = getDatabase();
  const now = new Date().toISOString();

  try {
    await db.transaction(async (trx) => {
      for (const entry of result.data) {
        const schema = entry.attributes?.schema;
        const serviceName = schema?.['dd-service'] ?? entry.id ?? 'unknown';
        const team = schema?.['dd-team'] ?? entry.attributes?.teams?.[0];
        const owner = entry.attributes?.owner;
        const tags = schema?.tags ?? entry.attributes?.tags ?? [];
        const contacts = schema?.contacts ?? [];

        // service_catalog has a composite unique constraint on (org_id, service_name).
        // Reproduce INSERT OR REPLACE explicitly (select then conditional
        // insert/update) rather than onConflict().merge(), since composite-key
        // conflict targets can behave inconsistently across knex versions/dialects.
        const patch = {
          scan_run_id: scanRunId,
          service_name: serviceName,
          team: team ?? null,
          owner: owner ?? null,
          tier: schema?.tier ?? null,
          lifecycle: schema?.lifecycle ?? null,
          description: schema?.description ?? null,
          tags: JSON.stringify(tags),
          contacts: JSON.stringify(contacts),
          raw_json: safeJsonSnapshot({ service_name: serviceName, team, owner, tier: schema?.tier,
            lifecycle: schema?.lifecycle, tags }),
          last_seen: now,
        };

        const existing = await trx('service_catalog')
          .where({ org_id: orgId, service_name: serviceName })
          .first();

        if (existing) {
          await trx('service_catalog')
            .where({ org_id: orgId, service_name: serviceName })
            .update(patch);
        } else {
          await trx('service_catalog').insert({
            id: uuidv4(),
            org_id: orgId,
            ...patch,
            first_seen: now,
          });
        }

        // Mark corresponding service entry
        await trx('services').where({ org_id: orgId, service_name: serviceName }).update({ has_service_catalog: 1 });
      }
    });
  } catch (err) {
    logger.error(`[${orgId}] Failed to store service catalog data`, err);
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} service catalog entries in ${Date.now() - start}ms`);
  return {
    collector: 'service_catalog',
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

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDSLO } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

export async function collectSLOs(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting SLOs`);

  const result = await client.get<DDSLO>('/api/v1/slo', { limit: 1000 });

  if (result.status !== 'success') {
    return {
      collector: 'slos',
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
      for (const slo of result.data) {
        const tags = slo.tags ?? [];
        const tagKeys = tags.map((t) => t.split(':')[0].toLowerCase());
        const hasEnv = tagKeys.includes('env');
        const hasService = tagKeys.includes('service');

        // slos has a composite unique constraint on (org_id, slo_id). Reproduce
        // INSERT OR REPLACE explicitly (select then conditional insert/update)
        // rather than onConflict().merge(), since composite-key conflict targets
        // can behave inconsistently across knex versions/dialects.
        const patch = {
          scan_run_id: scanRunId,
          slo_id: slo.id,
          slo_name: slo.name,
          slo_type: slo.type,
          tags: JSON.stringify(tags),
          has_env_tag: hasEnv ? 1 : 0,
          has_service_tag: hasService ? 1 : 0,
          raw_json: safeJsonSnapshot({ id: slo.id, name: slo.name, type: slo.type, tags }),
          last_seen: now,
        };

        const existing = await trx('slos').where({ org_id: orgId, slo_id: slo.id }).first();

        if (existing) {
          await trx('slos').where({ org_id: orgId, slo_id: slo.id }).update(patch);
        } else {
          await trx('slos').insert({
            id: uuidv4(),
            org_id: orgId,
            ...patch,
            first_seen: now,
          });
        }

        // Cross-reference: mark services that have SLOs
        const serviceTags = tags.filter((t) => t.startsWith('service:'));
        for (const st of serviceTags) {
          const svcName = st.split(':')[1];
          if (svcName) {
            await trx('services').where({ org_id: orgId, service_name: svcName }).update({ has_slo: 1 });
          }
        }
      }
    });
  } catch (err) {
    logger.error(`[${orgId}] Failed to store SLO data`, err);
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} SLOs in ${Date.now() - start}ms`);
  return {
    collector: 'slos',
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

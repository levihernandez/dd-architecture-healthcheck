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
    };
  }

  const db = getDatabase();
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO slos
      (id, org_id, scan_run_id, slo_id, slo_name, slo_type, tags,
       has_env_tag, has_service_tag, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateServiceHasSLO = db.prepare(`
    UPDATE services SET has_slo = 1
    WHERE org_id = ? AND service_name = ?
  `);

  const txn = db.transaction((slos: DDSLO[]) => {
    for (const slo of slos) {
      const tags = slo.tags ?? [];
      const tagKeys = tags.map((t) => t.split(':')[0].toLowerCase());
      const hasEnv = tagKeys.includes('env');
      const hasService = tagKeys.includes('service');

      insert.run(
        uuidv4(), orgId, scanRunId,
        slo.id, slo.name, slo.type,
        JSON.stringify(tags),
        hasEnv ? 1 : 0, hasService ? 1 : 0,
        safeJsonSnapshot({ id: slo.id, name: slo.name, type: slo.type, tags }),
        now, now
      );

      // Cross-reference: mark services that have SLOs
      const serviceTags = tags.filter((t) => t.startsWith('service:'));
      for (const st of serviceTags) {
        const svcName = st.split(':')[1];
        if (svcName) updateServiceHasSLO.run(orgId, svcName);
      }
    }
  });

  try { txn(result.data); } catch (err) {
    logger.error(`[${orgId}] Failed to store SLO data`, err);
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} SLOs in ${Date.now() - start}ms`);
  return {
    collector: 'slos',
    status: 'success',
    itemCount: result.itemCount,
    durationMs: Date.now() - start,
  };
}

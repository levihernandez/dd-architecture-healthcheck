import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDLogsIndex, DDLogsPipeline } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

export async function collectLogs(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting logs configuration`);

  const [indexResult, pipelineResult] = await Promise.all([
    client.get<DDLogsIndex>('/api/v1/logs/config/indexes'),
    client.get<DDLogsPipeline>('/api/v1/logs/config/pipelines'),
  ]);

  const db = getDatabase();
  const now = new Date().toISOString();
  let totalItems = 0;
  let overallStatus: CollectorResultSummary['status'] = 'success';

  if (indexResult.status === 'success' && indexResult.data.length > 0) {
    try {
      // logs_indexes has UNIQUE(org_id, index_name) but no scan_run_id in that key, so a
      // repeat scan collides with the prior row — explicit select + conditional insert/update.
      await db.transaction(async (trx) => {
        for (const idx of indexResult.data) {
          const patch = {
            org_id: orgId,
            scan_run_id: scanRunId,
            index_name: idx.name,
            filter_query: idx.filter?.query ?? null,
            retention_days: idx.num_retention_days ?? null,
            daily_limit: idx.daily_limit ?? null,
            exclusion_filter_count: idx.exclusion_filters?.length ?? 0,
            is_rate_limited: idx.is_rate_limited ? 1 : 0,
            raw_json: safeJsonSnapshot(idx),
            last_seen: now,
          };
          const existing = await trx<{ id: string; org_id: string; index_name: string }>('logs_indexes')
            .select('id')
            .where({ org_id: orgId, index_name: idx.name })
            .first();
          if (existing) {
            await trx('logs_indexes').where({ id: existing.id }).update(patch);
          } else {
            await trx('logs_indexes').insert({ id: uuidv4(), first_seen: now, ...patch });
          }
        }
      });
    } catch (err) {
      logger.error(`[${orgId}] Failed to store logs index data`, err);
    }
    totalItems += indexResult.itemCount;
  } else if (indexResult.status !== 'success') {
    overallStatus = indexResult.status;
  }

  if (pipelineResult.status === 'success' && pipelineResult.data.length > 0) {
    try {
      // logs_pipelines has UNIQUE(org_id, pipeline_id) but no scan_run_id in that key, so a
      // repeat scan collides with the prior row — explicit select + conditional insert/update.
      await db.transaction(async (trx) => {
        for (const pipeline of pipelineResult.data) {
          const patch = {
            org_id: orgId,
            scan_run_id: scanRunId,
            pipeline_id: pipeline.id,
            pipeline_name: pipeline.name,
            is_enabled: pipeline.is_enabled ? 1 : 0,
            filter_query: pipeline.filter?.query ?? null,
            processor_count: pipeline.processors?.length ?? 0,
            is_read_only: pipeline.is_read_only ? 1 : 0,
            raw_json: safeJsonSnapshot(pipeline),
            last_seen: now,
          };
          const existing = await trx<{ id: string; org_id: string; pipeline_id: string }>('logs_pipelines')
            .select('id')
            .where({ org_id: orgId, pipeline_id: pipeline.id })
            .first();
          if (existing) {
            await trx('logs_pipelines').where({ id: existing.id }).update(patch);
          } else {
            await trx('logs_pipelines').insert({ id: uuidv4(), first_seen: now, ...patch });
          }
        }
      });
    } catch (err) {
      logger.error(`[${orgId}] Failed to store logs pipeline data`, err);
    }
    totalItems += pipelineResult.itemCount;
  }

  logger.info(`[${orgId}] Collected ${totalItems} logs resources in ${Date.now() - start}ms`);
  return {
    collector: 'logs',
    status: totalItems > 0 ? 'success' : overallStatus,
    itemCount: totalItems,
    durationMs: Date.now() - start,
    endpoint: `${indexResult.endpoint}, ${pipelineResult.endpoint}`,
    requestCount: indexResult.requestCount + pipelineResult.requestCount,
    pageCount: indexResult.pageCount + pipelineResult.pageCount,
    truncated: indexResult.truncated || pipelineResult.truncated,
    rateLimitRemaining: pipelineResult.rateLimitRemaining ?? indexResult.rateLimitRemaining,
  };
}

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
    const insertIndex = db.prepare(`
      INSERT OR REPLACE INTO logs_indexes
        (id, org_id, scan_run_id, index_name, filter_query, retention_days,
         daily_limit, exclusion_filter_count, is_rate_limited, raw_json, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const txn = db.transaction((indexes: DDLogsIndex[]) => {
      for (const idx of indexes) {
        insertIndex.run(
          uuidv4(), orgId, scanRunId,
          idx.name,
          idx.filter?.query ?? null,
          idx.num_retention_days ?? null,
          idx.daily_limit ?? null,
          idx.exclusion_filters?.length ?? 0,
          idx.is_rate_limited ? 1 : 0,
          safeJsonSnapshot(idx),
          now, now
        );
      }
    });
    try { txn(indexResult.data); } catch (err) {
      logger.error(`[${orgId}] Failed to store logs index data`, err);
    }
    totalItems += indexResult.itemCount;
  } else if (indexResult.status !== 'success') {
    overallStatus = indexResult.status;
  }

  if (pipelineResult.status === 'success' && pipelineResult.data.length > 0) {
    const insertPipeline = db.prepare(`
      INSERT OR REPLACE INTO logs_pipelines
        (id, org_id, scan_run_id, pipeline_id, pipeline_name, is_enabled,
         filter_query, processor_count, is_read_only, raw_json, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const txn = db.transaction((pipelines: DDLogsPipeline[]) => {
      for (const pipeline of pipelines) {
        insertPipeline.run(
          uuidv4(), orgId, scanRunId,
          pipeline.id, pipeline.name,
          pipeline.is_enabled ? 1 : 0,
          pipeline.filter?.query ?? null,
          pipeline.processors?.length ?? 0,
          pipeline.is_read_only ? 1 : 0,
          safeJsonSnapshot(pipeline),
          now, now
        );
      }
    });
    try { txn(pipelineResult.data); } catch (err) {
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

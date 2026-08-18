import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDEvent } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

const ENDPOINT = '/api/v2/events/search';
const EVENTS_WINDOW = 'now-24h';
const MAX_PAGES = parseInt(process.env.DATADOG_MAX_PAGES_EVENTS ?? '20');

type EventDimension = 'source' | 'service' | 'status';

export async function collectEvents(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting event stats (last 24h)`);

  const result = await client.postV2Paginated<DDEvent>(
    ENDPOINT,
    { filter: { from: EVENTS_WINDOW, to: 'now' }, page: { limit: 1000 }, sort: '-timestamp' },
    MAX_PAGES
  );

  if (result.status !== 'success') {
    return {
      collector: 'events',
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

  const counts: Record<EventDimension, Map<string, number>> = {
    source: new Map(),
    service: new Map(),
    status: new Map(),
  };

  const bump = (dimension: EventDimension, value: string | undefined) => {
    const key = value ?? 'unknown';
    counts[dimension].set(key, (counts[dimension].get(key) ?? 0) + 1);
  };

  for (const event of result.data) {
    bump('source', event.attributes?.source_type_name);
    bump('service', event.attributes?.service);
    bump('status', event.attributes?.status);
  }

  const db = getDatabase();
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO event_stats
      (id, org_id, scan_run_id, dimension, dimension_value, event_count, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    for (const dimension of Object.keys(counts) as EventDimension[]) {
      for (const [value, count] of counts[dimension]) {
        insert.run(uuidv4(), orgId, scanRunId, dimension, value, count, now);
      }
    }
  });

  try { txn(); } catch (err) {
    logger.error(`[${orgId}] Failed to store event stats`, err);
  }

  const dimensionCount = counts.source.size + counts.service.size + counts.status.size;
  logger.info(`[${orgId}] Collected stats for ${result.itemCount} events (${dimensionCount} distinct dimension values) in ${Date.now() - start}ms`);

  return {
    collector: 'events',
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

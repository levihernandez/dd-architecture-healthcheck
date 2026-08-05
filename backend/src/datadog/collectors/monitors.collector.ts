import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDMonitor } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

export async function collectMonitors(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting monitors`);

  const result = await client.getPaginated<DDMonitor>(
    '/api/v1/monitor',
    { with_downtimes: true, group_states: 'all', page_size: 1000 },
    100
  );

  if (result.status !== 'success') {
    return {
      collector: 'monitors',
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

  const insert = db.prepare(`
    INSERT OR REPLACE INTO monitors
      (id, org_id, scan_run_id, monitor_id, monitor_name, monitor_type, overall_state,
       priority, has_notification, has_env_tag, has_service_tag, has_team_tag,
       is_muted, muted_since, tags, message, created_at_dd, modified_at_dd,
       raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction((monitors: DDMonitor[]) => {
    for (const mon of monitors) {
      const tags = mon.tags ?? [];
      const tagKeys = tags.map((t) => t.split(':')[0].toLowerCase());
      const hasEnv = tagKeys.includes('env');
      const hasService = tagKeys.includes('service');
      const hasTeam = tagKeys.includes('team');
      const hasNotification = Boolean(
        mon.message && (mon.message.includes('@') || mon.message.includes('{{'))
      );
      const isMuted = Boolean(
        mon.options?.silenced && Object.keys(mon.options.silenced).length > 0
      );

      insert.run(
        uuidv4(), orgId, scanRunId,
        mon.id, mon.name, mon.type, mon.overall_state ?? null,
        mon.priority ?? null,
        hasNotification ? 1 : 0,
        hasEnv ? 1 : 0,
        hasService ? 1 : 0,
        hasTeam ? 1 : 0,
        isMuted ? 1 : 0,
        null,
        JSON.stringify(tags),
        mon.message?.substring(0, 500) ?? null,
        mon.created ?? null,
        mon.modified ?? null,
        safeJsonSnapshot(mon),
        now, now
      );
    }
  });

  try { txn(result.data); } catch (err) {
    logger.error(`[${orgId}] Failed to store monitor data`, err);
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} monitors in ${Date.now() - start}ms`);
  return {
    collector: 'monitors',
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

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

  try {
    // monitors has UNIQUE(org_id, monitor_id) but no scan_run_id in that key, so a repeat
    // scan collides with the prior row — explicit select + conditional insert/update.
    await db.transaction(async (trx) => {
      for (const mon of result.data) {
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

        const patch = {
          org_id: orgId,
          scan_run_id: scanRunId,
          monitor_id: mon.id,
          monitor_name: mon.name,
          monitor_type: mon.type,
          overall_state: mon.overall_state ?? null,
          priority: mon.priority ?? null,
          has_notification: hasNotification ? 1 : 0,
          has_env_tag: hasEnv ? 1 : 0,
          has_service_tag: hasService ? 1 : 0,
          has_team_tag: hasTeam ? 1 : 0,
          is_muted: isMuted ? 1 : 0,
          muted_since: null,
          tags: JSON.stringify(tags),
          message: mon.message?.substring(0, 500) ?? null,
          created_at_dd: mon.created ?? null,
          modified_at_dd: mon.modified ?? null,
          raw_json: safeJsonSnapshot(mon),
          last_seen: now,
        };

        const existing = await trx<{ id: string; org_id: string; monitor_id: number }>('monitors')
          .select('id')
          .where({ org_id: orgId, monitor_id: mon.id })
          .first();
        if (existing) {
          await trx('monitors').where({ id: existing.id }).update(patch);
        } else {
          await trx('monitors').insert({ id: uuidv4(), first_seen: now, ...patch });
        }
      }
    });
  } catch (err) {
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

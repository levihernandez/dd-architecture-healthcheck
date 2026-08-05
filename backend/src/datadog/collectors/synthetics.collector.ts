import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDSyntheticsTest } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

export async function collectSynthetics(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting synthetics tests`);

  const result = await client.get<DDSyntheticsTest>('/api/v1/synthetics/tests');

  if (result.status !== 'success') {
    return {
      collector: 'synthetics',
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
    INSERT OR REPLACE INTO synthetics_tests
      (id, org_id, scan_run_id, public_id, test_name, test_type, status,
       has_env_tag, has_service_tag, has_notification, location_count, tags,
       created_at_dd, modified_at_dd, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction((tests: DDSyntheticsTest[]) => {
    for (const test of tests) {
      const tags = test.tags ?? [];
      const tagKeys = tags.map((t) => t.split(':')[0].toLowerCase());
      const hasEnv = tagKeys.includes('env');
      const hasService = tagKeys.includes('service');
      const hasNotification = Boolean(
        test.message && test.message.trim().length > 0 &&
        (test.message.includes('@') || test.message.includes('{{'))
      );

      insert.run(
        uuidv4(), orgId, scanRunId,
        test.public_id, test.name, test.type, test.status,
        hasEnv ? 1 : 0, hasService ? 1 : 0, hasNotification ? 1 : 0,
        test.locations?.length ?? 0,
        JSON.stringify(tags),
        test.created_at ?? null, test.modified_at ?? null,
        safeJsonSnapshot({ public_id: test.public_id, name: test.name, type: test.type,
          status: test.status, tags: test.tags, locations: test.locations }),
        now, now
      );
    }
  });

  try { txn(result.data); } catch (err) {
    logger.error(`[${orgId}] Failed to store synthetics data`, err);
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} synthetics tests in ${Date.now() - start}ms`);
  return {
    collector: 'synthetics',
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

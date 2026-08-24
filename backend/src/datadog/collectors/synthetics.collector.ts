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

  try {
    await db.transaction(async (trx) => {
      for (const test of result.data) {
        const tags = test.tags ?? [];
        const tagKeys = tags.map((t) => t.split(':')[0].toLowerCase());
        const hasEnv = tagKeys.includes('env');
        const hasService = tagKeys.includes('service');
        const hasNotification = Boolean(
          test.message && test.message.trim().length > 0 &&
          (test.message.includes('@') || test.message.includes('{{'))
        );

        // `synthetics_tests` has unique(org_id, public_id) — the original
        // INSERT OR REPLACE deletes any existing row for this test and inserts
        // a fresh one (including a new id). Replicated here as an explicit
        // delete+insert rather than onConflict().merge(), since a composite
        // unique target can behave differently across the sqlite and postgres
        // dialects this app supports.
        await trx('synthetics_tests').where({ org_id: orgId, public_id: test.public_id }).delete();
        await trx('synthetics_tests').insert({
          id: uuidv4(), org_id: orgId, scan_run_id: scanRunId,
          public_id: test.public_id, test_name: test.name, test_type: test.type, status: test.status,
          has_env_tag: hasEnv ? 1 : 0, has_service_tag: hasService ? 1 : 0, has_notification: hasNotification ? 1 : 0,
          location_count: test.locations?.length ?? 0,
          tags: JSON.stringify(tags),
          created_at_dd: test.created_at ?? null, modified_at_dd: test.modified_at ?? null,
          raw_json: safeJsonSnapshot({ public_id: test.public_id, name: test.name, type: test.type,
            status: test.status, tags: test.tags, locations: test.locations }),
          first_seen: now, last_seen: now,
        });
      }
    });
  } catch (err) {
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

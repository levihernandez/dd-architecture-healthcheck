import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDSecurityFinding } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

const ENDPOINT = '/api/v2/security_monitoring/findings';

export async function collectSecurityFindings(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting security findings (CSPM/AppSec/Cloud SIEM)`);

  const result = await client.getV2Paginated<DDSecurityFinding>(ENDPOINT, {}, 50);

  const db = getDatabase();
  const now = new Date().toISOString();
  // `permissions_report` has no unique constraint besides its app-generated
  // `id` (which is always fresh here), so the original INSERT OR REPLACE was
  // never actually replacing anything — a plain insert is behavior-identical.
  await db('permissions_report').insert({
    id: uuidv4(), org_id: orgId, scan_run_id: scanRunId, endpoint: ENDPOINT,
    status: result.status, status_code: null, error: result.error ?? null, tested_at: now,
  });

  if (result.status !== 'success') {
    return {
      collector: 'security_findings',
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

  try {
    await db.transaction(async (trx) => {
      for (const finding of result.data) {
        const findingId = finding.id;
        if (!findingId) continue;
        const attrs = finding.attributes;
        // `security_findings` has unique(org_id, finding_id) — the original
        // INSERT OR REPLACE deletes any existing row for this finding and
        // inserts a fresh one (including a new id). Replicated here as an
        // explicit delete+insert rather than onConflict().merge(), since a
        // composite unique target can behave differently across the sqlite
        // and postgres dialects this app supports.
        await trx('security_findings').where({ org_id: orgId, finding_id: findingId }).delete();
        await trx('security_findings').insert({
          id: uuidv4(), org_id: orgId, scan_run_id: scanRunId, finding_id: findingId,
          category: attrs?.rule?.category ?? attrs?.category ?? 'unknown',
          severity: attrs?.severity ?? attrs?.evaluation ?? 'unknown',
          status: attrs?.status ?? null,
          resource_type: attrs?.resource_type ?? attrs?.resource?.type ?? null,
          resource_name: attrs?.resource?.name ?? null,
          rule_name: attrs?.rule?.name ?? null,
          raw_json: safeJsonSnapshot(finding),
          first_seen: now, last_seen: now,
        });
      }
    });
  } catch (err) {
    logger.error(`[${orgId}] Failed to store security findings`, err);
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} security findings in ${Date.now() - start}ms`);
  return {
    collector: 'security_findings',
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

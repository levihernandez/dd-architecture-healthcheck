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
  db.prepare(`
    INSERT OR REPLACE INTO permissions_report
      (id, org_id, scan_run_id, endpoint, status, status_code, error, tested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), orgId, scanRunId, ENDPOINT, result.status, null, result.error ?? null, now);

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

  const insert = db.prepare(`
    INSERT OR REPLACE INTO security_findings
      (id, org_id, scan_run_id, finding_id, category, severity, status,
       resource_type, resource_name, rule_name, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction((findings: DDSecurityFinding[]) => {
    for (const finding of findings) {
      const findingId = finding.id;
      if (!findingId) continue;
      const attrs = finding.attributes;
      insert.run(
        uuidv4(), orgId, scanRunId, findingId,
        attrs?.rule?.category ?? attrs?.category ?? 'unknown',
        attrs?.severity ?? attrs?.evaluation ?? 'unknown',
        attrs?.status ?? null,
        attrs?.resource_type ?? attrs?.resource?.type ?? null,
        attrs?.resource?.name ?? null,
        attrs?.rule?.name ?? null,
        safeJsonSnapshot(finding),
        now, now
      );
    }
  });

  try { txn(result.data); } catch (err) {
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

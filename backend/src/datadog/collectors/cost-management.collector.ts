import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDCostConfig } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

const PROVIDERS: Array<{ provider: string; endpoint: string }> = [
  { provider: 'aws', endpoint: '/api/v2/cost/aws_cur_config' },
  { provider: 'azure', endpoint: '/api/v2/cost/azure_uc_config' },
  { provider: 'gcp', endpoint: '/api/v2/cost/gcp_usage_cost_config' },
];

// Cloud Cost Management is a configured/not-configured probe per cloud provider —
// same pattern as the AWS/Azure/GCP integration probes in integrations.collector.ts.
export async function collectCostManagement(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting Cloud Cost Management configuration`);

  const db = getDatabase();
  const now = new Date().toISOString();

  const results = await Promise.all(
    PROVIDERS.map(({ endpoint }) => client.get<DDCostConfig>(endpoint))
  );

  const insertPermission = db.prepare(`
    INSERT OR REPLACE INTO permissions_report
      (id, org_id, scan_run_id, endpoint, status, status_code, error, tested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertConfig = db.prepare(`
    INSERT OR REPLACE INTO cost_management_config
      (id, org_id, scan_run_id, provider, configured, account_count, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let configuredCount = 0;
  let anySuccess = false;
  let lastError: string | undefined;
  let requestCount = 0;
  let rateLimitRemaining: number | undefined;

  for (let i = 0; i < PROVIDERS.length; i++) {
    const { provider, endpoint } = PROVIDERS[i];
    const result = results[i];
    requestCount += result.requestCount;
    rateLimitRemaining = result.rateLimitRemaining ?? rateLimitRemaining;

    insertPermission.run(uuidv4(), orgId, scanRunId, endpoint, result.status, null, result.error ?? null, now);

    if (result.status === 'success') {
      anySuccess = true;
      const configured = result.data.length > 0;
      if (configured) configuredCount++;
      try {
        insertConfig.run(
          uuidv4(), orgId, scanRunId, provider,
          configured ? 1 : 0, result.data.length,
          safeJsonSnapshot(result.data), now, now
        );
      } catch (err) {
        logger.error(`[${orgId}] Failed to store cost management config for ${provider}`, err);
      }
    } else {
      lastError = result.error;
    }
  }

  if (!anySuccess) {
    return {
      collector: 'cost_management',
      status: results[0].status,
      itemCount: 0,
      error: lastError,
      durationMs: Date.now() - start,
      endpoint: PROVIDERS.map((p) => p.endpoint).join(', '),
      requestCount,
      pageCount: PROVIDERS.length,
      truncated: false,
      rateLimitRemaining,
    };
  }

  logger.info(`[${orgId}] Cloud Cost Management: ${configuredCount}/${PROVIDERS.length} providers configured`);
  return {
    collector: 'cost_management',
    status: 'success',
    itemCount: configuredCount,
    durationMs: Date.now() - start,
    endpoint: PROVIDERS.map((p) => p.endpoint).join(', '),
    requestCount,
    pageCount: PROVIDERS.length,
    truncated: false,
    rateLimitRemaining,
  };
}

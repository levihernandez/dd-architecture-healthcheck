import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDCloudAccount } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

// Probe these integrations to detect what's configured
const INTEGRATION_PROBES = [
  'slack', 'pagerduty', 'jira', 'github', 'aws', 'azure', 'gcp',
  'kubernetes', 'docker', 'nginx', 'apache', 'mysql', 'postgres',
  'redis', 'mongodb', 'elasticsearch', 'kafka', 'rabbitmq', 'haproxy',
  'consul', 'vault', 'jenkins', 'circleci', 'terraform', 'ansible',
];

export async function collectIntegrations(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting integrations`);

  const db = getDatabase();
  const now = new Date().toISOString();
  let totalItems = 0;

  // Cloud accounts
  const [awsResult, azureResult, gcpResult] = await Promise.all([
    client.get<DDCloudAccount>('/api/v1/integration/aws'),
    client.get<Record<string, unknown>>('/api/v1/integration/azure'),
    client.get<Record<string, unknown>>('/api/v1/integration/gcp'),
  ]);

  const insertCloud = db.prepare(`
    INSERT OR REPLACE INTO cloud_accounts
      (id, org_id, scan_run_id, provider, account_id, account_name, status,
       metrics_enabled, resource_collection_enabled, has_errors, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (awsResult.status === 'success') {
    const txn = db.transaction((accounts: DDCloudAccount[]) => {
      for (const acc of accounts) {
        insertCloud.run(
          uuidv4(), orgId, scanRunId, 'aws',
          acc.account_id ?? null, acc.account_name ?? null, 'configured',
          acc.metrics_collection_enabled ? 1 : 0,
          acc.resource_collection_enabled ? 1 : 0,
          (acc.errors?.length ?? 0) > 0 ? 1 : 0,
          safeJsonSnapshot({ account_id: acc.account_id, metrics_collection_enabled: acc.metrics_collection_enabled }),
          now, now
        );
      }
    });
    try { txn(awsResult.data); } catch (err) {
      logger.error(`[${orgId}] Failed to store AWS account data`, err);
    }
    totalItems += awsResult.itemCount;
  }

  // Store integration probe results in permissions_report
  const insertPermission = db.prepare(`
    INSERT OR REPLACE INTO permissions_report
      (id, org_id, scan_run_id, endpoint, status, status_code, error, tested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [provider, result] of [
    ['aws', awsResult], ['azure', azureResult], ['gcp', gcpResult]
  ] as const) {
    insertPermission.run(
      uuidv4(), orgId, scanRunId,
      `/api/v1/integration/${provider}`,
      result.status, null, result.error ?? null, now
    );
  }

  // Probe webhooks / notification integrations
  const webhooksResult = await client.get<unknown>('/api/v1/integration/webhooks');
  const pagerdutyResult = await client.get<unknown>('/api/v1/integration/pagerduty');
  const slackResult = await client.get<unknown>('/api/v1/integration/slack');

  const insertIntegration = db.prepare(`
    INSERT OR REPLACE INTO integrations
      (id, org_id, scan_run_id, integration_name, integration_type, status,
       is_configured, is_enabled, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [name, result] of [
    ['webhooks', webhooksResult], ['pagerduty', pagerdutyResult], ['slack', slackResult]
  ] as const) {
    const isConfigured = result.status === 'success' && result.itemCount > 0;
    insertIntegration.run(
      uuidv4(), orgId, scanRunId, name, 'notification',
      result.status === 'success' ? 'configured' : result.status,
      isConfigured ? 1 : 0, isConfigured ? 1 : 0,
      null, now, now
    );
    if (isConfigured) totalItems++;
  }

  logger.info(`[${orgId}] Collected integration data in ${Date.now() - start}ms`);
  return {
    collector: 'integrations',
    status: 'success',
    itemCount: totalItems,
    durationMs: Date.now() - start,
  };
}

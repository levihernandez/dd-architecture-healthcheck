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

  if (awsResult.status === 'success') {
    try {
      // cloud_accounts has UNIQUE(org_id, provider, account_id) but no scan_run_id in that
      // key, so a repeat scan collides with the prior row — do an explicit select +
      // conditional insert/update inside a transaction rather than a blind insert.
      await db.transaction(async (trx) => {
        for (const acc of awsResult.data) {
          const patch = {
            org_id: orgId,
            scan_run_id: scanRunId,
            provider: 'aws',
            account_id: acc.account_id ?? null,
            account_name: acc.account_name ?? null,
            status: 'configured',
            metrics_enabled: acc.metrics_collection_enabled ? 1 : 0,
            resource_collection_enabled: acc.resource_collection_enabled ? 1 : 0,
            has_errors: (acc.errors?.length ?? 0) > 0 ? 1 : 0,
            raw_json: safeJsonSnapshot({ account_id: acc.account_id, metrics_collection_enabled: acc.metrics_collection_enabled }),
            last_seen: now,
          };
          const existing = await trx<{ id: string; org_id: string; provider: string; account_id: string | null }>('cloud_accounts')
            .select('id')
            .where({ org_id: orgId, provider: 'aws', account_id: acc.account_id ?? null })
            .first();
          if (existing) {
            await trx('cloud_accounts').where({ id: existing.id }).update(patch);
          } else {
            await trx('cloud_accounts').insert({ id: uuidv4(), first_seen: now, ...patch });
          }
        }
      });
    } catch (err) {
      logger.error(`[${orgId}] Failed to store AWS account data`, err);
    }
    totalItems += awsResult.itemCount;
  }

  // Store integration probe results in permissions_report
  const permissionRows = ([
    ['aws', awsResult], ['azure', azureResult], ['gcp', gcpResult]
  ] as const).map(([provider, result]) => ({
    id: uuidv4(),
    org_id: orgId,
    scan_run_id: scanRunId,
    endpoint: `/api/v1/integration/${provider}`,
    status: result.status,
    status_code: null,
    error: result.error ?? null,
    tested_at: now,
  }));
  await db('permissions_report').insert(permissionRows);

  // Probe webhooks / notification integrations
  const webhooksResult = await client.get<unknown>('/api/v1/integration/webhooks');
  const pagerdutyResult = await client.get<unknown>('/api/v1/integration/pagerduty');
  const slackResult = await client.get<unknown>('/api/v1/integration/slack');

  // integrations has UNIQUE(org_id, integration_name) but no scan_run_id in that key, so a
  // repeat scan collides with the prior row — explicit select + conditional insert/update.
  await db.transaction(async (trx) => {
    for (const [name, result] of [
      ['webhooks', webhooksResult], ['pagerduty', pagerdutyResult], ['slack', slackResult]
    ] as const) {
      const isConfigured = result.status === 'success' && result.itemCount > 0;
      if (isConfigured) totalItems++;
      const patch = {
        org_id: orgId,
        scan_run_id: scanRunId,
        integration_name: name,
        integration_type: 'notification',
        status: result.status === 'success' ? 'configured' : result.status,
        is_configured: isConfigured ? 1 : 0,
        is_enabled: isConfigured ? 1 : 0,
        raw_json: null,
        last_seen: now,
      };
      const existing = await trx<{ id: string; org_id: string; integration_name: string }>('integrations')
        .select('id')
        .where({ org_id: orgId, integration_name: name })
        .first();
      if (existing) {
        await trx('integrations').where({ id: existing.id }).update(patch);
      } else {
        await trx('integrations').insert({ id: uuidv4(), first_seen: now, ...patch });
      }
    }
  });

  const allResults = [awsResult, azureResult, gcpResult, webhooksResult, pagerdutyResult, slackResult];
  logger.info(`[${orgId}] Collected integration data in ${Date.now() - start}ms`);
  return {
    collector: 'integrations',
    status: 'success',
    itemCount: totalItems,
    durationMs: Date.now() - start,
    endpoint: [
      '/api/v1/integration/aws', '/api/v1/integration/azure', '/api/v1/integration/gcp',
      '/api/v1/integration/webhooks', '/api/v1/integration/pagerduty', '/api/v1/integration/slack',
    ].join(', '),
    requestCount: allResults.reduce((sum, r) => sum + r.requestCount, 0),
    pageCount: allResults.reduce((sum, r) => sum + r.pageCount, 0),
    truncated: allResults.some((r) => r.truncated),
    rateLimitRemaining: gcpResult.rateLimitRemaining,
  };
}

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDTeam, DDUser, DDOrgSettings } from '../../types/datadog.types';
import type { CollectorResultSummary } from '../../types/api.types';

export async function collectGovernance(
  client: DatadogClient,
  orgId: string,
  scanRunId: string
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting governance data`);

  const db = getDatabase();
  const now = new Date().toISOString();
  let totalItems = 0;

  // Teams
  const teamsResult = await client.getV2Paginated<DDTeam>('/api/v2/teams');

  if (teamsResult.status === 'success') {
    try {
      await db.transaction(async (trx) => {
        for (const team of teamsResult.data) {
          const resourceType = 'team';
          const resourceId = team.id;
          const patch = {
            org_id: orgId,
            scan_run_id: scanRunId,
            resource_type: resourceType,
            resource_id: resourceId,
            resource_name: team.attributes.name,
            source_endpoint: '/api/v2/teams',
            last_seen: now,
            raw_json: safeJsonSnapshot({ id: team.id, name: team.attributes.name,
              handle: team.attributes.handle, user_count: team.attributes.user_count }),
          };

          const existing = await trx('resources')
            .where({ org_id: orgId, resource_type: resourceType, resource_id: resourceId })
            .first();

          if (existing) {
            await trx('resources')
              .where({ org_id: orgId, resource_type: resourceType, resource_id: resourceId })
              .update(patch);
          } else {
            await trx('resources').insert({
              id: uuidv4(),
              ...patch,
              first_seen: now,
            });
          }
        }
      });
    } catch (err) {
      logger.error(`[${orgId}] Failed to store team data`, err);
    }
    totalItems += teamsResult.itemCount;
  }

  // Users (summary only - no PII beyond what's needed)
  const usersResult = await client.getV2Paginated<DDUser>('/api/v2/users', {
    'filter[status]': 'Active',
    'page[size]': 100,
  });

  if (usersResult.status === 'success') {
    const userSummary = {
      total: usersResult.itemCount,
      serviceAccounts: usersResult.data.filter((u) => u.attributes.service_account).length,
      mfaEnabled: usersResult.data.filter((u) => u.attributes.mfa_enabled).length,
    };

    await upsertProductUsageSignal(db, orgId, scanRunId, 'governance', 'user_count', {
      value: String(userSummary.total),
      detected: 1,
      evidence: JSON.stringify(userSummary),
      checked_at: now,
    });
    totalItems += 1;
  }

  // Org settings (high-level SSO signal only - no secrets)
  const orgSettingsResult = await client.get<DDOrgSettings>('/api/v1/org');

  if (orgSettingsResult.status === 'success' && orgSettingsResult.data.length > 0) {
    const orgData = orgSettingsResult.data[0] as unknown as { orgs?: DDOrgSettings['data'][] };
    const org = orgData?.orgs?.[0] ?? orgSettingsResult.data[0] as unknown as DDOrgSettings['data'];
    const settings = (org as DDOrgSettings['data'])?.attributes?.settings;

    if (settings) {
      // Record SSO status signal only - no IdP metadata, no certificates
      const ssoSignal = {
        saml_enabled: settings.saml?.enabled ?? false,
        saml_strict_mode: settings.saml_strict_mode?.enabled ?? false,
        saml_idp_metadata_uploaded: settings.saml_idp_metadata_uploaded ?? false,
        saml_autocreate_enabled: settings.saml_autocreate_users_domains?.enabled ?? false,
      };

      await upsertProductUsageSignal(db, orgId, scanRunId, 'governance', 'sso_status', {
        value: JSON.stringify(ssoSignal),
        detected: 1,
        evidence: JSON.stringify({ note: 'High-level SSO signal only. No IdP metadata or certificates collected.' }),
        checked_at: now,
      });
    }
  }

  // RBAC roles
  const rolesResult = await client.getV2Paginated<Record<string, unknown>>('/api/v2/roles');
  if (rolesResult.status === 'success') {
    await upsertProductUsageSignal(db, orgId, scanRunId, 'governance', 'role_count', {
      value: String(rolesResult.itemCount),
      detected: 1,
      evidence: null,
      checked_at: now,
    });
  }

  // Record permission results for all governance endpoints
  const permissionRows = ([
    ['/api/v2/teams', teamsResult],
    ['/api/v2/users', usersResult],
    ['/api/v1/org', orgSettingsResult],
    ['/api/v2/roles', rolesResult],
  ] as const).map(([endpoint, result]) => ({
    id: uuidv4(),
    org_id: orgId,
    scan_run_id: scanRunId,
    endpoint,
    status: result.status,
    status_code: null,
    error: result.error ?? null,
    tested_at: now,
  }));

  await db('permissions_report').insert(permissionRows);

  const allResults = [teamsResult, usersResult, orgSettingsResult, rolesResult];
  logger.info(`[${orgId}] Collected governance data (${totalItems} items) in ${Date.now() - start}ms`);
  return {
    collector: 'governance',
    status: 'success',
    itemCount: totalItems,
    durationMs: Date.now() - start,
    endpoint: '/api/v2/teams, /api/v2/users, /api/v1/org, /api/v2/roles',
    requestCount: allResults.reduce((sum, r) => sum + r.requestCount, 0),
    pageCount: allResults.reduce((sum, r) => sum + r.pageCount, 0),
    truncated: allResults.some((r) => r.truncated),
    rateLimitRemaining: rolesResult.rateLimitRemaining,
  };
}

// product_usage_signals has a composite unique constraint on (org_id, product, signal).
// INSERT OR REPLACE semantics are reproduced explicitly (select then conditional
// insert/update) rather than via onConflict().merge(), since composite-key conflict
// targets can behave inconsistently across knex versions/dialects.
async function upsertProductUsageSignal(
  db: ReturnType<typeof getDatabase>,
  orgId: string,
  scanRunId: string,
  product: string,
  signal: string,
  fields: { value: string | null; detected: number; evidence: string | null; checked_at: string }
): Promise<void> {
  const existing = await db('product_usage_signals').where({ org_id: orgId, product, signal }).first();

  if (existing) {
    await db('product_usage_signals')
      .where({ org_id: orgId, product, signal })
      .update({ scan_run_id: scanRunId, ...fields });
  } else {
    await db('product_usage_signals').insert({
      id: uuidv4(),
      org_id: orgId,
      scan_run_id: scanRunId,
      product,
      signal,
      ...fields,
    });
  }
}

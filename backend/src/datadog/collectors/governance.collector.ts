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
    const insert = db.prepare(`
      INSERT OR REPLACE INTO resources
        (id, org_id, scan_run_id, resource_type, resource_id, resource_name,
         source_endpoint, first_seen, last_seen, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const txn = db.transaction((teams: DDTeam[]) => {
      for (const team of teams) {
        insert.run(
          uuidv4(), orgId, scanRunId,
          'team', team.id, team.attributes.name,
          '/api/v2/teams', now, now,
          safeJsonSnapshot({ id: team.id, name: team.attributes.name,
            handle: team.attributes.handle, user_count: team.attributes.user_count })
        );
      }
    });
    try { txn(teamsResult.data); } catch (err) {
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

    db.prepare(`
      INSERT OR REPLACE INTO product_usage_signals
        (id, org_id, scan_run_id, product, signal, value, detected, evidence, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), orgId, scanRunId,
      'governance', 'user_count',
      String(userSummary.total), 1,
      JSON.stringify(userSummary), now
    );
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

      db.prepare(`
        INSERT OR REPLACE INTO product_usage_signals
          (id, org_id, scan_run_id, product, signal, value, detected, evidence, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), orgId, scanRunId,
        'governance', 'sso_status',
        JSON.stringify(ssoSignal), 1,
        JSON.stringify({ note: 'High-level SSO signal only. No IdP metadata or certificates collected.' }),
        now
      );
    }
  }

  // RBAC roles
  const rolesResult = await client.getV2Paginated<Record<string, unknown>>('/api/v2/roles');
  if (rolesResult.status === 'success') {
    db.prepare(`
      INSERT OR REPLACE INTO product_usage_signals
        (id, org_id, scan_run_id, product, signal, value, detected, evidence, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), orgId, scanRunId,
      'governance', 'role_count',
      String(rolesResult.itemCount), 1,
      null, now
    );
  }

  // Record permission results for all governance endpoints
  const insertPermission = db.prepare(`
    INSERT OR REPLACE INTO permissions_report
      (id, org_id, scan_run_id, endpoint, status, status_code, error, tested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [endpoint, result] of [
    ['/api/v2/teams', teamsResult],
    ['/api/v2/users', usersResult],
    ['/api/v1/org', orgSettingsResult],
    ['/api/v2/roles', rolesResult],
  ] as const) {
    insertPermission.run(
      uuidv4(), orgId, scanRunId,
      endpoint, result.status, null, result.error ?? null, now
    );
  }

  logger.info(`[${orgId}] Collected governance data (${totalItems} items) in ${Date.now() - start}ms`);
  return {
    collector: 'governance',
    status: 'success',
    itemCount: totalItems,
    durationMs: Date.now() - start,
  };
}

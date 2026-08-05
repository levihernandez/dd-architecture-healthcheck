import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';
import { encrypt, decrypt } from '../../utils/crypto';
import { logger } from '../../utils/logger';
import type { OrgConfig, DatadogSite } from '../../types/datadog.types';
import type { CreateOrgRequest, OrgResponse } from '../../types/api.types';

interface OrgRow {
  id: string;
  name: string;
  site: string;
  session_only: number;
  dd_org_name: string | null;
  dd_org_id: string | null;
  created_at: string;
  updated_at: string;
  last_scan_at: string | null;
  last_scan_status: string | null;
  notes: string | null;
}

interface CredRow {
  encrypted_api_key: string;
  encrypted_app_key: string;
}

export const OrgRepository = {
  create(req: CreateOrgRequest & { ddOrgId?: string; ddOrgName?: string }): OrgResponse {
    const db = getDatabase();
    // Prefer the org ID Datadog itself reports at connection time — keeps the row's
    // primary key stable across reconnects instead of minting a fresh app-generated UUID.
    const id = req.ddOrgId || uuidv4();
    const now = new Date().toISOString();

    const credId = uuidv4();
    const encApiKey = encrypt(req.apiKey);
    const encAppKey = encrypt(req.appKey);
    const keyHintApi = req.apiKey.slice(-4).padStart(8, '*');
    const keyHintApp = req.appKey.slice(-4).padStart(8, '*');

    db.transaction(() => {
      db.prepare(`
        INSERT INTO orgs (id, name, site, session_only, dd_org_id, dd_org_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.name, req.site, req.sessionOnly ? 1 : 0, req.ddOrgId ?? null, req.ddOrgName ?? null, now, now);

      db.prepare(`
        INSERT INTO api_credentials_metadata
          (id, org_id, encrypted_api_key, encrypted_app_key, key_hint_api, key_hint_app, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(credId, id, encApiKey, encAppKey, keyHintApi, keyHintApp, now, now);
    })();

    return this.findById(id)!;
  },

  findById(id: string): OrgResponse | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM orgs WHERE id = ?').get(id) as OrgRow | undefined;
    if (!row) return null;
    return rowToResponse(row);
  },

  findAll(): OrgResponse[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM orgs ORDER BY created_at DESC').all() as OrgRow[];
    return rows.map(rowToResponse);
  },

  update(id: string, updates: { name?: string; site?: string; apiKey?: string; appKey?: string }): OrgResponse | null {
    const db = getDatabase();
    const now = new Date().toISOString();

    if (updates.name || updates.site) {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (updates.name) { sets.push('name = ?'); params.push(updates.name); }
      if (updates.site) { sets.push('site = ?'); params.push(updates.site); }
      sets.push('updated_at = ?');
      params.push(now, id);
      db.prepare(`UPDATE orgs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }

    if (updates.apiKey || updates.appKey) {
      const cred = db.prepare(
        'SELECT * FROM api_credentials_metadata WHERE org_id = ?'
      ).get(id) as CredRow | undefined;

      if (cred) {
        const newEncApi = updates.apiKey ? encrypt(updates.apiKey) : cred.encrypted_api_key;
        const newEncApp = updates.appKey ? encrypt(updates.appKey) : cred.encrypted_app_key;
        const hintApi = updates.apiKey ? updates.apiKey.slice(-4).padStart(8, '*') : undefined;
        const hintApp = updates.appKey ? updates.appKey.slice(-4).padStart(8, '*') : undefined;

        db.prepare(`
          UPDATE api_credentials_metadata
          SET encrypted_api_key = ?, encrypted_app_key = ?,
              ${hintApi ? 'key_hint_api = ?,' : ''} ${hintApp ? 'key_hint_app = ?,' : ''}
              updated_at = ?
          WHERE org_id = ?
        `).run(
          newEncApi, newEncApp,
          ...(hintApi ? [hintApi] : []),
          ...(hintApp ? [hintApp] : []),
          now, id
        );
      }
    }

    return this.findById(id);
  },

  updateScanStatus(id: string, status: string, ddOrgName?: string, ddOrgId?: string): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE orgs SET last_scan_at = ?, last_scan_status = ?,
        ${ddOrgName ? 'dd_org_name = ?,' : ''} ${ddOrgId ? 'dd_org_id = ?,' : ''}
        updated_at = ?
      WHERE id = ?
    `).run(
      now, status,
      ...(ddOrgName ? [ddOrgName] : []),
      ...(ddOrgId ? [ddOrgId] : []),
      now, id
    );
  },

  delete(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM orgs WHERE id = ?').run(id);
    return result.changes > 0;
  },

  getCredentials(orgId: string): { apiKey: string; appKey: string; site: string } | null {
    const db = getDatabase();
    const org = db.prepare('SELECT site FROM orgs WHERE id = ?').get(orgId) as { site: string } | undefined;
    const cred = db.prepare(
      'SELECT encrypted_api_key, encrypted_app_key FROM api_credentials_metadata WHERE org_id = ?'
    ).get(orgId) as CredRow | undefined;

    if (!org || !cred) return null;

    try {
      return {
        apiKey: decrypt(cred.encrypted_api_key),
        appKey: decrypt(cred.encrypted_app_key),
        site: org.site,
      };
    } catch (err) {
      logger.error(`Failed to decrypt credentials for org ${orgId}`, err);
      return null;
    }
  },
};

function rowToResponse(row: OrgRow): OrgResponse {
  const db = getDatabase();
  const cred = db.prepare(
    'SELECT key_hint_api, key_hint_app FROM api_credentials_metadata WHERE org_id = ?'
  ).get(row.id) as { key_hint_api?: string; key_hint_app?: string } | undefined;

  return {
    id: row.id,
    name: row.name,
    site: row.site as DatadogSite,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionOnly: Boolean(row.session_only),
    lastScanAt: row.last_scan_at ?? undefined,
    lastScanStatus: (row.last_scan_status as OrgResponse['lastScanStatus']) ?? undefined,
    ddOrgName: row.dd_org_name ?? undefined,
    ddOrgId: row.dd_org_id ?? undefined,
  };
}

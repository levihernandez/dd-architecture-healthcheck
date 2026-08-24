import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';
import { encrypt, decrypt } from '../../utils/crypto';
import { logger } from '../../utils/logger';
import { AppError } from '../../api/middleware/error.middleware';
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
  created_by_user_id: string | null;
}

interface CredRow {
  org_id?: string;
  encrypted_api_key: string;
  encrypted_app_key: string;
}

export const OrgRepository = {
  async create(req: CreateOrgRequest & { ddOrgId?: string; ddOrgName?: string }, userId: string): Promise<OrgResponse> {
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

    await db.transaction(async (trx) => {
      await trx('orgs').insert({
        id,
        name: req.name,
        site: req.site,
        session_only: req.sessionOnly ? 1 : 0,
        dd_org_id: req.ddOrgId ?? null,
        dd_org_name: req.ddOrgName ?? null,
        created_by_user_id: userId,
        created_at: now,
        updated_at: now,
      });

      await trx('api_credentials_metadata').insert({
        id: credId,
        org_id: id,
        encrypted_api_key: encApiKey,
        encrypted_app_key: encAppKey,
        key_hint_api: keyHintApi,
        key_hint_app: keyHintApp,
        created_at: now,
        updated_at: now,
      });
    });

    return (await this.findById(id))!;
  },

  async findById(id: string): Promise<OrgResponse | null> {
    const db = getDatabase();
    const row = await db<OrgRow>('orgs').where({ id }).first();
    if (!row) return null;
    return rowToResponse(row);
  },

  async findAll(userId: string): Promise<OrgResponse[]> {
    const db = getDatabase();
    const rows = await db<OrgRow>('orgs').where({ created_by_user_id: userId }).orderBy('created_at', 'desc');
    return Promise.all(rows.map(rowToResponse));
  },

  /** Owner-agnostic lookup by Datadog org id — used only to detect an
   * existing connection for the reconnect-vs-conflict check in the create
   * route; ownership must still be enforced by the caller. */
  async findByIdUnscoped(id: string): Promise<{ id: string; createdByUserId: string | null } | null> {
    const db = getDatabase();
    const row = await db<OrgRow>('orgs').select('id', 'created_by_user_id').where({ id }).first();
    return row ? { id: row.id, createdByUserId: row.created_by_user_id } : null;
  },

  async update(id: string, updates: { name?: string; site?: string; apiKey?: string; appKey?: string }): Promise<OrgResponse | null> {
    const db = getDatabase();
    const now = new Date().toISOString();

    if (updates.name || updates.site) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (updates.name) patch.name = updates.name;
      if (updates.site) patch.site = updates.site;
      await db('orgs').where({ id }).update(patch);
    }

    if (updates.apiKey || updates.appKey) {
      const cred = await db<CredRow>('api_credentials_metadata').where({ org_id: id }).first();

      if (cred) {
        const patch: Record<string, unknown> = {
          encrypted_api_key: updates.apiKey ? encrypt(updates.apiKey) : cred.encrypted_api_key,
          encrypted_app_key: updates.appKey ? encrypt(updates.appKey) : cred.encrypted_app_key,
          updated_at: now,
        };
        if (updates.apiKey) patch.key_hint_api = updates.apiKey.slice(-4).padStart(8, '*');
        if (updates.appKey) patch.key_hint_app = updates.appKey.slice(-4).padStart(8, '*');

        await db('api_credentials_metadata').where({ org_id: id }).update(patch);
      } else {
        // No credentials row exists for this org (shouldn't normally happen —
        // create() always inserts one alongside the org — but silently
        // no-op'ing here previously made "Edit Keys" look like it saved when
        // it hadn't. Since there's nothing to merge with, both keys are
        // required to (re)create the row from scratch.
        if (!updates.apiKey || !updates.appKey) {
          throw new AppError(
            'This organization has no stored credentials — provide both the API key and Application key to restore them.',
            400
          );
        }
        await db('api_credentials_metadata').insert({
          id: uuidv4(),
          org_id: id,
          encrypted_api_key: encrypt(updates.apiKey),
          encrypted_app_key: encrypt(updates.appKey),
          key_hint_api: updates.apiKey.slice(-4).padStart(8, '*'),
          key_hint_app: updates.appKey.slice(-4).padStart(8, '*'),
          created_at: now,
          updated_at: now,
        });
      }
    }

    return this.findById(id);
  },

  async updateScanStatus(id: string, status: string, ddOrgName?: string, ddOrgId?: string): Promise<void> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { last_scan_at: now, last_scan_status: status, updated_at: now };
    if (ddOrgName) patch.dd_org_name = ddOrgName;
    if (ddOrgId) patch.dd_org_id = ddOrgId;
    await db('orgs').where({ id }).update(patch);
  },

  async delete(id: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db('orgs').where({ id }).delete();
    return result > 0;
  },

  async getCredentials(orgId: string): Promise<{ apiKey: string; appKey: string; site: string } | null> {
    const db = getDatabase();
    const org = await db<{ id: string; site: string }>('orgs').select('site').where({ id: orgId }).first();
    const cred = await db<CredRow>('api_credentials_metadata')
      .select('encrypted_api_key', 'encrypted_app_key')
      .where({ org_id: orgId })
      .first();

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

async function rowToResponse(row: OrgRow): Promise<OrgResponse> {
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

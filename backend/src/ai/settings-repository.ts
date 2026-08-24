import { getDatabase } from '../db/database';
import { encrypt, decrypt } from '../utils/crypto';
import { logger } from '../utils/logger';

export interface AISettingsPublic {
  provider: string;
  model: string | null;
  baseUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
  updatedAt: string | null;
}

export interface SaveAISettings {
  provider: string;
  model: string;
  apiKey?: string;    // omit to keep existing key
  clearKey?: boolean; // true to remove the key
  baseUrl?: string;
}

export const AISettingsRepository = {
  async get(): Promise<AISettingsPublic> {
    const db = getDatabase();
    const row = await db<{
      id: string; provider: string; model: string | null; encrypted_api_key: string | null;
      base_url: string | null; updated_at: string;
    }>('ai_settings').where({ id: 'default' }).first();

    if (!row) {
      return { provider: 'none', model: null, baseUrl: null, hasKey: false, keyHint: null, updatedAt: null };
    }

    let keyHint: string | null = null;
    if (row.encrypted_api_key) {
      try {
        const raw = decrypt(row.encrypted_api_key);
        keyHint = raw.length >= 4 ? `${'*'.repeat(Math.max(4, raw.length - 4))}${raw.slice(-4)}` : '****';
      } catch { keyHint = '****'; }
    }

    return {
      provider: row.provider,
      model: row.model,
      baseUrl: row.base_url,
      hasKey: Boolean(row.encrypted_api_key),
      keyHint,
      updatedAt: row.updated_at,
    };
  },

  async getDecryptedKey(): Promise<string | null> {
    const db = getDatabase();
    const row = await db<{ id: string; encrypted_api_key: string | null }>('ai_settings')
      .select('encrypted_api_key')
      .where({ id: 'default' })
      .first();
    if (!row?.encrypted_api_key) return null;
    try { return decrypt(row.encrypted_api_key); } catch (err) {
      logger.error('Failed to decrypt AI API key', err);
      return null;
    }
  },

  async save(settings: SaveAISettings): Promise<void> {
    const db = getDatabase();
    const now = new Date().toISOString();

    const existing = await db<{ id: string; encrypted_api_key: string | null }>('ai_settings')
      .select('encrypted_api_key')
      .where({ id: 'default' })
      .first();

    let newEncKey: string | null;
    if (settings.clearKey) {
      newEncKey = null;
    } else if (settings.apiKey) {
      newEncKey = encrypt(settings.apiKey);
    } else {
      newEncKey = existing?.encrypted_api_key ?? null;
    }

    await db('ai_settings')
      .insert({
        id: 'default',
        provider: settings.provider,
        model: settings.model,
        encrypted_api_key: newEncKey,
        base_url: settings.baseUrl ?? null,
        updated_at: now,
      })
      .onConflict('id')
      .merge();
  },
};

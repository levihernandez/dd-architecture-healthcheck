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
  get(): AISettingsPublic {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM ai_settings WHERE id = ?').get('default') as {
      provider: string; model: string | null; encrypted_api_key: string | null;
      base_url: string | null; updated_at: string;
    } | undefined;

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

  getDecryptedKey(): string | null {
    const db = getDatabase();
    const row = db.prepare('SELECT encrypted_api_key FROM ai_settings WHERE id = ?').get('default') as {
      encrypted_api_key: string | null;
    } | undefined;
    if (!row?.encrypted_api_key) return null;
    try { return decrypt(row.encrypted_api_key); } catch (err) {
      logger.error('Failed to decrypt AI API key', err);
      return null;
    }
  },

  save(settings: SaveAISettings): void {
    const db = getDatabase();
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT encrypted_api_key FROM ai_settings WHERE id = ?').get('default') as {
      encrypted_api_key: string | null;
    } | undefined;

    let newEncKey: string | null;
    if (settings.clearKey) {
      newEncKey = null;
    } else if (settings.apiKey) {
      newEncKey = encrypt(settings.apiKey);
    } else {
      newEncKey = existing?.encrypted_api_key ?? null;
    }

    db.prepare(`
      INSERT INTO ai_settings (id, provider, model, encrypted_api_key, base_url, updated_at)
      VALUES ('default', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        model = excluded.model,
        encrypted_api_key = excluded.encrypted_api_key,
        base_url = excluded.base_url,
        updated_at = excluded.updated_at
    `).run(settings.provider, settings.model, newEncKey, settings.baseUrl ?? null, now);
  },
};

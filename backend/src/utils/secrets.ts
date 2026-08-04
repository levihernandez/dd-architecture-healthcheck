import axios from 'axios';
import fs from 'fs';
import https from 'https';
import { logger } from './logger';

const ENC_PATTERN = /^ENC\[(.+)\]$/;
const TRANSIT_KEY = 'ai-app';

let cachedToken: string | null = null;

async function login(): Promise<string> {
  if (cachedToken) return cachedToken;

  const baoAddr = process.env.BAO_ADDR;
  const username = process.env.BAO_USERNAME;
  const password = process.env.BAO_PASSWORD;
  if (!baoAddr || !username || !password) {
    throw new Error('BAO_ADDR, BAO_USERNAME and BAO_PASSWORD must be set to resolve ENC[] values');
  }

  const httpsAgent = process.env.BAO_CACERT
    ? new https.Agent({ ca: fs.readFileSync(process.env.BAO_CACERT) })
    : undefined;

  const res = await axios.post(
    `${baoAddr}/v1/auth/userpass/login/${encodeURIComponent(username)}`,
    { password },
    {
      headers: process.env.BAO_NAMESPACE ? { 'X-Vault-Namespace': process.env.BAO_NAMESPACE } : undefined,
      httpsAgent,
    }
  );

  cachedToken = res.data.auth.client_token;
  return cachedToken!;
}

async function transitDecrypt(ciphertext: string): Promise<string> {
  const baoAddr = process.env.BAO_ADDR;
  const token = await login();

  const httpsAgent = process.env.BAO_CACERT
    ? new https.Agent({ ca: fs.readFileSync(process.env.BAO_CACERT) })
    : undefined;

  const res = await axios.post(
    `${baoAddr}/v1/transit/decrypt/${TRANSIT_KEY}`,
    { ciphertext },
    {
      headers: {
        'X-Vault-Token': token,
        ...(process.env.BAO_NAMESPACE ? { 'X-Vault-Namespace': process.env.BAO_NAMESPACE } : {}),
      },
      httpsAgent,
    }
  );

  return Buffer.from(res.data.data.plaintext, 'base64').toString('utf8');
}

/**
 * Scans process.env for ENC[...] values (OpenBao transit ciphertext) and
 * replaces them in place with the decrypted plaintext. No-op if nothing
 * is encrypted, so environments without OpenBao access (CI, prod with
 * plain env injection) don't need Bao reachable.
 */
export async function resolveEncryptedEnv(): Promise<void> {
  const keys = Object.keys(process.env).filter((k) => ENC_PATTERN.test(process.env[k] ?? ''));
  if (keys.length === 0) return;

  for (const key of keys) {
    const match = ENC_PATTERN.exec(process.env[key]!);
    const ciphertext = match![1];
    try {
      process.env[key] = await transitDecrypt(ciphertext);
    } catch (err) {
      logger.error(`Failed to decrypt ${key} via OpenBao: ${(err as Error).message}`);
      throw err;
    }
  }
  logger.info(`Resolved ${keys.length} ENC[] secret(s) via OpenBao`);
}

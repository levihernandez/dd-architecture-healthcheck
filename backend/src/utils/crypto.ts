import CryptoJS from 'crypto-js';

function getKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error('ENCRYPTION_KEY must be set and at least 16 characters');
  }
  return key;
}

export function encrypt(plaintext: string): string {
  return CryptoJS.AES.encrypt(plaintext, getKey()).toString();
}

export function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, getKey());
  return bytes.toString(CryptoJS.enc.Utf8);
}

export function encryptCredentials(credentials: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(credentials)) {
    result[k] = encrypt(v);
  }
  return result;
}

export function decryptCredentials(encrypted: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(encrypted)) {
    result[k] = decrypt(v);
  }
  return result;
}

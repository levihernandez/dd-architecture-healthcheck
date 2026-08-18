import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { logger } from './logger';

// Self-signed cert for local/standalone HTTPS — not for production use behind
// a public network. Generated once and reused across restarts; delete the
// files to force regeneration (e.g. after the 365-day expiry).
export function ensureTlsCredentials(certPath: string, keyPath: string): { cert: Buffer; key: Buffer } {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    logger.info(`No TLS cert found at ${certPath} — generating a self-signed one`);
    fs.mkdirSync(path.dirname(certPath), { recursive: true });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath,
      '-days', '365',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'inherit' });
  }
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

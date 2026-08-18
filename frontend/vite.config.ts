import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

// Mirrors backend/src/utils/tls.ts — kept separate since this runs outside
// the backend's TS build (vite.config.ts is loaded standalone by Vite).
function ensureTlsCredentials(certPath: string, keyPath: string) {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    fs.mkdirSync(path.dirname(certPath), { recursive: true });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath,
      '-days', '365',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'inherit' });
  }
  return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const httpsEnabled = env.HTTPS_ENABLED === 'true';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      https: httpsEnabled
        ? ensureTlsCredentials(
            env.SSL_CERT_PATH ?? path.resolve(__dirname, '../certs/cert.pem'),
            env.SSL_KEY_PATH ?? path.resolve(__dirname, '../certs/key.pem')
          )
        : undefined,
      proxy: {
        '/api': {
          target: httpsEnabled ? 'https://localhost:3001' : 'http://localhost:3001',
          changeOrigin: true,
          secure: false, // backend uses a self-signed cert in HTTPS mode
        },
      },
    },
  };
});

// Redact secrets from any data before logging, export, or AI prompts

const SECRET_PATTERNS = [
  /\bDD_API_KEY\b/gi,
  /\bDD_APP_KEY\b/gi,
  /\bapi[_-]?key\b/gi,
  /\bapp[_-]?key\b/gi,
  /\bsecret[_-]?key\b/gi,
  /\bpassword\b/gi,
  /\btoken\b/gi,
];

const SECRET_FIELD_NAMES = new Set([
  'api_key', 'app_key', 'apiKey', 'appKey', 'apikey', 'appkey',
  'secret', 'password', 'token', 'access_key', 'secret_key',
  'client_secret', 'private_key', 'auth_token', 'bearer_token',
]);

export function redactObject(obj: unknown, depth = 0): unknown {
  if (depth > 10) return obj;
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactString(obj);
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SECRET_FIELD_NAMES.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactObject(value, depth + 1);
    }
  }
  return result;
}

export function redactString(str: string): string {
  // Redact DD-style API keys (32 hex chars)
  return str.replace(/\b[a-f0-9]{32}\b/gi, '[REDACTED]');
}

export function safeJsonSnapshot(data: unknown): string {
  try {
    const redacted = redactObject(data);
    return JSON.stringify(redacted);
  } catch {
    return '{"error":"could not serialize"}';
  }
}

export function isSecretField(key: string): boolean {
  return SECRET_FIELD_NAMES.has(key.toLowerCase());
}

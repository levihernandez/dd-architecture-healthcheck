import path from 'path';
import fs from 'fs';
import type { Knex } from 'knex';

export function getKnexConfig(): Knex.Config {
  const client = (process.env.DB_CLIENT || 'sqlite').toLowerCase();

  if (client === 'postgres' || client === 'postgresql' || client === 'pg') {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when DB_CLIENT=postgres');
    }
    return {
      client: 'pg',
      connection: process.env.DATABASE_URL,
      pool: { min: 2, max: 10 },
      migrations: {
        directory: path.join(__dirname, 'migrations'),
        tableName: 'knex_migrations',
      },
    };
  }

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'health-check.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  return {
    client: 'better-sqlite3',
    connection: { filename: dbPath },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn: any, cb: (err: Error | null, conn: any) => void) => {
        conn.pragma('journal_mode = WAL');
        conn.pragma('foreign_keys = ON');
        conn.pragma('synchronous = NORMAL');
        conn.pragma('cache_size = -32000');
        cb(null, conn);
      },
    },
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      tableName: 'knex_migrations',
    },
  };
}

export function getDbClient(): 'sqlite' | 'postgres' {
  const client = (process.env.DB_CLIENT || 'sqlite').toLowerCase();
  return client === 'postgres' || client === 'postgresql' || client === 'pg' ? 'postgres' : 'sqlite';
}

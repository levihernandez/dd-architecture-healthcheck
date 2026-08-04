import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './schema';
import { logger } from '../utils/logger';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'health-check.db');
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -32000');

    runMigrations(db);
    logger.info(`SQLite database opened at ${dbPath}`);
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}

export function runInTransaction<T>(fn: (db: Database.Database) => T): T {
  const database = getDatabase();
  const txn = database.transaction(fn);
  return txn(database);
}

import knexFactory, { type Knex } from 'knex';
import { getKnexConfig } from './knexfile';
import { bootstrapLegacyDb } from './bootstrap-legacy-db';
import { migrateOrgIdsToDatadogOrgId, backfillOrgOwnership } from './legacy-data-migrations';
import { logger } from '../utils/logger';

let db: Knex | null = null;

export function getDatabase(): Knex {
  if (!db) {
    db = knexFactory(getKnexConfig());
  }
  return db;
}

export async function initDatabase(): Promise<void> {
  const database = getDatabase();
  await bootstrapLegacyDb(database);
  await database.migrate.latest();
  await migrateOrgIdsToDatadogOrgId(database);
  await backfillOrgOwnership(database);
  logger.info('Database schema migrations complete');
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
    logger.info('Database closed');
  }
}

export async function runInTransaction<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return getDatabase().transaction(fn);
}

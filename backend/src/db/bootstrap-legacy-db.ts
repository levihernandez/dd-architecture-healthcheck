import type { Knex } from 'knex';
import { logger } from '../utils/logger';

// A database created by the pre-Knex app (raw `CREATE TABLE IF NOT EXISTS` in
// schema.ts) already has all baseline tables but no `knex_migrations` tracking
// table. Running the baseline migration's up() against it would fail trying to
// CREATE TABLE on tables that already exist. Detect that case and mark the
// baseline migration as already-applied so `knex.migrate.latest()` only runs
// migrations that came after it. Fresh installs (no `orgs` table) are untouched
// and run the baseline migration normally.
export async function bootstrapLegacyDb(knex: Knex): Promise<void> {
  const hasOrgs = await knex.schema.hasTable('orgs');
  const hasMigrationsTable = await knex.schema.hasTable('knex_migrations');

  if (!hasOrgs || hasMigrationsTable) {
    return;
  }

  logger.info('[migration] Detected pre-Knex database — marking baseline migration as already applied');

  await knex.schema.createTable('knex_migrations', (t) => {
    t.increments('id').primary();
    t.string('name');
    t.integer('batch');
    t.timestamp('migration_time');
  });
  await knex.schema.createTable('knex_migrations_lock', (t) => {
    t.increments('index').primary();
    t.integer('is_locked');
  });
  await knex('knex_migrations_lock').insert({ is_locked: 0 });
  await knex('knex_migrations').insert({
    name: '00000000000001_baseline.ts',
    batch: 1,
    migration_time: new Date().toISOString(),
  });
}

import type { Knex } from 'knex';
import { logger } from '../utils/logger';

// One-time, idempotent: orgs created before per-user ownership existed have
// created_by_user_id = NULL. Assign them to the earliest-registered user
// (almost certainly the real account, not a test account created afterward)
// so existing scan history doesn't become orphaned/inaccessible the moment
// this migration ships. No-op once every org has an owner, and a no-op on a
// fresh install (no orgs yet to backfill).
export async function backfillOrgOwnership(knex: Knex): Promise<void> {
  const orphaned = await knex('orgs').whereNull('created_by_user_id').count<{ c: string | number }>({ c: '*' }).first();
  if (Number(orphaned?.c ?? 0) === 0) return;

  const earliestUser = await knex('users').select('id', 'email').orderBy('created_at', 'asc').first();
  if (!earliestUser) return; // no users registered yet — nothing to assign ownership to

  const updated = await knex('orgs').whereNull('created_by_user_id').update({ created_by_user_id: earliestUser.id });
  logger.info(`[migration] Assigned ${updated} pre-existing org(s) to earliest-registered user (${earliestUser.email})`);
}

// Tables keyed by org_id, referencing orgs(id). Every one of these must be
// repointed when an org's primary key is rewritten to its detected Datadog org ID.
const ORG_SCOPED_TABLES = [
  'api_credentials_metadata', 'scan_runs', 'resources', 'resource_tags', 'hosts',
  'services', 'service_catalog', 'monitors', 'dashboards', 'synthetics_tests',
  'logs_indexes', 'logs_pipelines', 'integrations', 'cloud_accounts', 'slos',
  'product_usage_signals', 'findings', 'scorecards', 'ai_assessments',
  'permissions_report', 'tag_analysis', 'org_context', 'usage_summary',
  'rum_applications', 'org_tag_template',
  'teams', 'scorecard_rules', 'scorecard_outcomes', 'event_stats',
];

// One-time (per org), idempotent: rewrites an org's primary key from its
// originally-generated UUID to its real Datadog org ID once that ID has been
// detected via credential validation. No-op once id === dd_org_id.
export async function migrateOrgIdsToDatadogOrgId(knex: Knex): Promise<void> {
  const candidates = await knex('orgs')
    .select('id', 'dd_org_id', 'name')
    .whereNotNull('dd_org_id')
    .whereNot('dd_org_id', '')
    .whereRaw('dd_org_id != id');

  for (const org of candidates as Array<{ id: string; dd_org_id: string; name: string }>) {
    const collision = await knex('orgs').where({ id: org.dd_org_id }).first();
    if (collision) {
      logger.warn(`[migration] Skipping org id migration for "${org.name}" (${org.id}) — target id ${org.dd_org_id} already in use`);
      continue;
    }

    logger.info(`[migration] Migrating org "${org.name}" primary key ${org.id} -> ${org.dd_org_id} (detected Datadog org ID)`);

    // Immediate FK enforcement can't tolerate a parent-key rename mid-flight
    // (child rows would momentarily point at a nonexistent id either order),
    // so it's disabled for the duration of this single transaction only.
    const isSqlite = knex.client.config.client === 'better-sqlite3' || knex.client.config.client === 'sqlite3';
    if (isSqlite) {
      await knex.raw('PRAGMA foreign_keys = OFF');
    }
    try {
      await knex.transaction(async (trx) => {
        for (const table of ORG_SCOPED_TABLES) {
          await trx(table).where({ org_id: org.id }).update({ org_id: org.dd_org_id });
        }
        await trx('orgs').where({ id: org.id }).update({ id: org.dd_org_id });
      });
    } finally {
      if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON');
      }
    }
  }
}

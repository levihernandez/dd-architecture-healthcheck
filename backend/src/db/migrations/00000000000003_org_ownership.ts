import type { Knex } from 'knex';

// Scopes org connections (and everything hanging off them via org_id) to the
// user who created them. Nullable + ON DELETE SET NULL: deleting a user must
// not cascade-delete their scan history, it just orphans it (inaccessible
// until reassigned — no automated reassignment on user deletion today).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orgs', (t) => {
    t.text('created_by_user_id').references('id').inTable('users').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orgs', (t) => {
    t.dropColumn('created_by_user_id');
  });
}

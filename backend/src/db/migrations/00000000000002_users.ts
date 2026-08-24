import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    t.text('id').primary();
    t.text('email').notNullable().unique();
    t.text('password_hash').notNullable();
    t.text('name');
    t.text('created_at').notNullable();
    t.text('updated_at').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}

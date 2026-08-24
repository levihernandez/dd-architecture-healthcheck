import { getDatabase } from '../database';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export const UserRepository = {
  async create(user: { id: string; email: string; passwordHash: string; name?: string | null }): Promise<UserRow> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const row: UserRow = {
      id: user.id,
      email: user.email,
      password_hash: user.passwordHash,
      name: user.name ?? null,
      created_at: now,
      updated_at: now,
    };
    await db('users').insert(row);
    return row;
  },

  async findByEmail(email: string): Promise<UserRow | null> {
    const db = getDatabase();
    const row = await db<UserRow>('users').where({ email }).first();
    return row ?? null;
  },

  async findById(id: string): Promise<UserRow | null> {
    const db = getDatabase();
    const row = await db<UserRow>('users').where({ id }).first();
    return row ?? null;
  },

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    const db = getDatabase();
    await db('users').where({ id }).update({ password_hash: passwordHash, updated_at: new Date().toISOString() });
  },
};

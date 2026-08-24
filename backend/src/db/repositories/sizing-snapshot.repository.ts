import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';

export interface SizingSnapshotInput {
  name: string;
  mode: string;
  orgId?: string;
  orgName?: string;
  totalListPrice: number;
  totalRealCost?: number;
  categoryCount: number;
  cart: unknown;
  state: Record<string, unknown>;
}

export interface SizingSnapshotSummary {
  id: string;
  name: string;
  createdAt: string;
  mode: string;
  orgId?: string;
  orgName?: string;
  totalListPrice: number;
  totalRealCost?: number;
  categoryCount: number;
  cart: unknown;
}

export interface SizingSnapshotRecord extends SizingSnapshotSummary {
  state: Record<string, unknown>;
}

interface SizingSnapshotRow {
  id: string;
  name: string;
  created_at: string;
  mode: string;
  org_id: string | null;
  org_name: string | null;
  total_list_price: number;
  total_real_cost: number | null;
  category_count: number;
  cart_json: string;
  state_json: string;
}

export const SizingSnapshotRepository = {
  async create(input: SizingSnapshotInput): Promise<SizingSnapshotRecord> {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    await db('sizing_snapshots').insert({
      id,
      name: input.name,
      created_at: now,
      mode: input.mode,
      org_id: input.orgId ?? null,
      org_name: input.orgName ?? null,
      total_list_price: input.totalListPrice,
      total_real_cost: input.totalRealCost ?? null,
      category_count: input.categoryCount,
      cart_json: JSON.stringify(input.cart),
      state_json: JSON.stringify(input.state),
    });

    return (await this.findById(id))!;
  },

  async listAll(): Promise<SizingSnapshotSummary[]> {
    const db = getDatabase();
    const rows = await db<Omit<SizingSnapshotRow, 'state_json'>>('sizing_snapshots')
      .select('id', 'name', 'created_at', 'mode', 'org_id', 'org_name', 'total_list_price', 'total_real_cost', 'category_count', 'cart_json')
      .orderBy('created_at', 'desc');
    return rows.map(rowToSummary);
  },

  async findById(id: string): Promise<SizingSnapshotRecord | null> {
    const db = getDatabase();
    const row = await db<SizingSnapshotRow>('sizing_snapshots').where({ id }).first();
    if (!row) return null;
    return { ...rowToSummary(row), state: JSON.parse(row.state_json) };
  },

  async delete(id: string): Promise<boolean> {
    const db = getDatabase();
    const result = await db('sizing_snapshots').where({ id }).delete();
    return result > 0;
  },
};

function rowToSummary(row: Omit<SizingSnapshotRow, 'state_json'>): SizingSnapshotSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    mode: row.mode,
    orgId: row.org_id ?? undefined,
    orgName: row.org_name ?? undefined,
    totalListPrice: row.total_list_price,
    totalRealCost: row.total_real_cost ?? undefined,
    categoryCount: row.category_count,
    cart: JSON.parse(row.cart_json),
  };
}

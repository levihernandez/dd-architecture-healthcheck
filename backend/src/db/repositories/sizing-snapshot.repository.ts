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
  create(input: SizingSnapshotInput): SizingSnapshotRecord {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO sizing_snapshots
        (id, name, created_at, mode, org_id, org_name, total_list_price, total_real_cost, category_count, cart_json, state_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.name, now, input.mode, input.orgId ?? null, input.orgName ?? null,
      input.totalListPrice, input.totalRealCost ?? null, input.categoryCount,
      JSON.stringify(input.cart), JSON.stringify(input.state)
    );
    return this.findById(id)!;
  },

  listAll(): SizingSnapshotSummary[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT id, name, created_at, mode, org_id, org_name, total_list_price, total_real_cost, category_count, cart_json FROM sizing_snapshots ORDER BY created_at DESC'
    ).all() as Omit<SizingSnapshotRow, 'state_json'>[];
    return rows.map(rowToSummary);
  },

  findById(id: string): SizingSnapshotRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM sizing_snapshots WHERE id = ?').get(id) as SizingSnapshotRow | undefined;
    if (!row) return null;
    return { ...rowToSummary(row), state: JSON.parse(row.state_json) };
  },

  delete(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM sizing_snapshots WHERE id = ?').run(id);
    return result.changes > 0;
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

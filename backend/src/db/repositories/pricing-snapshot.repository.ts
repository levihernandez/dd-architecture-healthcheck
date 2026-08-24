import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';

export interface PricingSnapshotItem {
  product: string;
  tier?: string;
  unit: string;
  price: number;
  rawText?: string;
}

export interface PricingSnapshotRecord {
  id: string;
  capturedAt: string;
  sourceUrl: string;
  product: string;
  tier?: string;
  unit: string;
  price: number;
  rawText?: string;
}

interface PricingSnapshotRow {
  id: string;
  captured_at: string;
  source_url: string;
  product: string;
  tier: string | null;
  unit: string;
  price: number;
  raw_text: string | null;
}

export const PricingSnapshotRepository = {
  async capture(sourceUrl: string, items: PricingSnapshotItem[], capturedAt?: string): Promise<PricingSnapshotRecord[]> {
    const db = getDatabase();
    const timestamp = capturedAt ?? new Date().toISOString();

    const rows = items.map((item) => ({
      id: uuidv4(),
      captured_at: timestamp,
      source_url: sourceUrl,
      product: item.product,
      tier: item.tier ?? null,
      unit: item.unit,
      price: item.price,
      raw_text: item.rawText ?? null,
    }));

    if (rows.length === 0) return [];

    await db('pricing_snapshots').insert(rows);

    const ids = rows.map((r) => r.id);
    const inserted = await db<PricingSnapshotRow>('pricing_snapshots').whereIn('id', ids);
    return inserted.map(rowToRecord);
  },

  async listAll(): Promise<PricingSnapshotRecord[]> {
    const db = getDatabase();
    const rows = await db<PricingSnapshotRow>('pricing_snapshots').orderBy('captured_at', 'desc');
    return rows.map(rowToRecord);
  },

  async history(product: string): Promise<PricingSnapshotRecord[]> {
    const db = getDatabase();
    const rows = await db<PricingSnapshotRow>('pricing_snapshots')
      .where({ product })
      .orderBy('captured_at', 'asc');
    return rows.map(rowToRecord);
  },

  async latestPerProduct(): Promise<PricingSnapshotRecord[]> {
    const db = getDatabase();
    const rows = await db<PricingSnapshotRow>('pricing_snapshots as ps')
      .where(
        'ps.captured_at',
        '=',
        db('pricing_snapshots').max('captured_at').where('product', db.ref('ps.product'))
      )
      .orderBy('ps.product', 'asc')
      .select('ps.*');
    return rows.map(rowToRecord);
  },
};

function rowToRecord(row: PricingSnapshotRow): PricingSnapshotRecord {
  return {
    id: row.id,
    capturedAt: row.captured_at,
    sourceUrl: row.source_url,
    product: row.product,
    tier: row.tier ?? undefined,
    unit: row.unit,
    price: row.price,
    rawText: row.raw_text ?? undefined,
  };
}

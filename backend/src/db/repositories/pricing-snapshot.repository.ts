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
  capture(sourceUrl: string, items: PricingSnapshotItem[], capturedAt?: string): PricingSnapshotRecord[] {
    const db = getDatabase();
    const timestamp = capturedAt ?? new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO pricing_snapshots (id, captured_at, source_url, product, tier, unit, price, raw_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const ids = items.map((item) => {
      const id = uuidv4();
      insert.run(id, timestamp, sourceUrl, item.product, item.tier ?? null, item.unit, item.price, item.rawText ?? null);
      return id;
    });
    const rows = db.prepare(
      `SELECT * FROM pricing_snapshots WHERE id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids) as PricingSnapshotRow[];
    return rows.map(rowToRecord);
  },

  listAll(): PricingSnapshotRecord[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM pricing_snapshots ORDER BY captured_at DESC'
    ).all() as PricingSnapshotRow[];
    return rows.map(rowToRecord);
  },

  history(product: string): PricingSnapshotRecord[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM pricing_snapshots WHERE product = ? ORDER BY captured_at ASC'
    ).all(product) as PricingSnapshotRow[];
    return rows.map(rowToRecord);
  },

  latestPerProduct(): PricingSnapshotRecord[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT ps.* FROM pricing_snapshots ps
      WHERE ps.captured_at = (
        SELECT MAX(captured_at) FROM pricing_snapshots WHERE product = ps.product
      )
      ORDER BY ps.product ASC
    `).all() as PricingSnapshotRow[];
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

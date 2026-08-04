import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';
import type { ScanRunResponse, CollectorResultSummary } from '../../types/api.types';

interface ScanRow {
  id: string;
  org_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  collector_results: string | null;
  finding_count: number;
  created_at: string;
}

export const ScanRepository = {
  create(orgId: string): ScanRunResponse {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO scan_runs (id, org_id, status, started_at, created_at)
      VALUES (?, ?, 'pending', ?, ?)
    `).run(id, orgId, now, now);

    return this.findById(id)!;
  },

  findById(id: string): ScanRunResponse | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM scan_runs WHERE id = ?').get(id) as ScanRow | undefined;
    if (!row) return null;
    return rowToResponse(row);
  },

  findByOrg(orgId: string, limit = 20): ScanRunResponse[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM scan_runs WHERE org_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(orgId, limit) as ScanRow[];
    return rows.map(rowToResponse);
  },

  findLatestByOrg(orgId: string): ScanRunResponse | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM scan_runs WHERE org_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1'
    ).get(orgId, 'completed') as ScanRow | undefined;
    return row ? rowToResponse(row) : null;
  },

  updateStatus(
    id: string,
    status: ScanRunResponse['status'],
    error?: string
  ): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    if (status === 'completed' || status === 'failed') {
      db.prepare(`
        UPDATE scan_runs SET status = ?, completed_at = ?, error = ? WHERE id = ?
      `).run(status, now, error ?? null, id);
    } else {
      db.prepare(`UPDATE scan_runs SET status = ? WHERE id = ?`).run(status, id);
    }
  },

  updateCollectorResults(id: string, results: CollectorResultSummary[]): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE scan_runs SET collector_results = ? WHERE id = ?
    `).run(JSON.stringify(results), id);
  },

  updateFindingCount(id: string, count: number): void {
    const db = getDatabase();
    db.prepare('UPDATE scan_runs SET finding_count = ? WHERE id = ?').run(count, id);
  },
};

function rowToResponse(row: ScanRow): ScanRunResponse {
  let collectorResults: CollectorResultSummary[] = [];
  if (row.collector_results) {
    try { collectorResults = JSON.parse(row.collector_results); } catch { /* ignore */ }
  }
  return {
    id: row.id,
    orgId: row.org_id,
    status: row.status as ScanRunResponse['status'],
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
    collectorResults,
    findingCount: row.finding_count,
  };
}

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
  async create(orgId: string): Promise<ScanRunResponse> {
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date().toISOString();

    await db('scan_runs').insert({
      id,
      org_id: orgId,
      status: 'pending',
      started_at: now,
      created_at: now,
    });

    return (await this.findById(id))!;
  },

  async findById(id: string): Promise<ScanRunResponse | null> {
    const db = getDatabase();
    const row = await db<ScanRow>('scan_runs').where({ id }).first();
    if (!row) return null;
    return rowToResponse(row);
  },

  async findByOrg(orgId: string, limit = 20): Promise<ScanRunResponse[]> {
    const db = getDatabase();
    const rows = await db<ScanRow>('scan_runs')
      .where({ org_id: orgId })
      .orderBy('started_at', 'desc')
      .limit(limit);
    return rows.map(rowToResponse);
  },

  async findLatestByOrg(orgId: string): Promise<ScanRunResponse | null> {
    const db = getDatabase();
    const row = await db<ScanRow>('scan_runs')
      .where({ org_id: orgId, status: 'completed' })
      .orderBy('started_at', 'desc')
      .first();
    return row ? rowToResponse(row) : null;
  },

  // The most recent completed scan for the org that started strictly before
  // `beforeScanId`'s own start time — used as the default "previous scan" to
  // diff against when a comparison doesn't specify one explicitly.
  async findPreviousCompleted(orgId: string, beforeScanId: string): Promise<ScanRunResponse | null> {
    const db = getDatabase();
    const row = await db<ScanRow>('scan_runs')
      .where({ org_id: orgId, status: 'completed' })
      .andWhere('started_at', '<', db('scan_runs').select('started_at').where({ id: beforeScanId }))
      .orderBy('started_at', 'desc')
      .first();
    return row ? rowToResponse(row) : null;
  },

  async updateStatus(
    id: string,
    status: ScanRunResponse['status'],
    error?: string
  ): Promise<void> {
    const db = getDatabase();
    const now = new Date().toISOString();
    if (status === 'completed' || status === 'failed') {
      await db('scan_runs').where({ id }).update({
        status,
        completed_at: now,
        error: error ?? null,
      });
    } else {
      await db('scan_runs').where({ id }).update({ status });
    }
  },

  async updateCollectorResults(id: string, results: CollectorResultSummary[]): Promise<void> {
    const db = getDatabase();
    await db('scan_runs').where({ id }).update({ collector_results: JSON.stringify(results) });
  },

  async updateFindingCount(id: string, count: number): Promise<void> {
    const db = getDatabase();
    await db('scan_runs').where({ id }).update({ finding_count: count });
  },

  // Every child table's scan_run_id FK is ON DELETE CASCADE (with foreign_keys=ON
  // set at connection time), so this single delete cleans up all collected data.
  async delete(id: string): Promise<void> {
    const db = getDatabase();
    await db('scan_runs').where({ id }).delete();
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

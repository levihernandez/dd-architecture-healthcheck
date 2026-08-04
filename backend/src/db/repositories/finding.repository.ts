import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';
import type { Finding, FindingCategory, FindingSeverity } from '../../types/assessment.types';

interface FindingRow {
  id: string;
  org_id: string;
  scan_run_id: string;
  category: string;
  rule_id: string;
  rule_name: string;
  severity: string;
  title: string;
  description: string;
  impact: string | null;
  recommendation: string | null;
  affected_count: number;
  total_count: number;
  percentage: number;
  affected_resources: string | null;
  evidence: string | null;
  tags: string | null;
  created_at: string;
}

export const FindingRepository = {
  insertMany(findings: Omit<Finding, 'id' | 'createdAt'>[]): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO findings
        (id, org_id, scan_run_id, category, rule_id, rule_name, severity, title, description,
         impact, recommendation, affected_count, total_count, percentage,
         affected_resources, evidence, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const txn = db.transaction((items: typeof findings) => {
      for (const f of items) {
        stmt.run(
          uuidv4(), f.orgId, f.scanRunId, f.category, f.ruleId, f.ruleName, f.severity,
          f.title, f.description, f.impact, f.recommendation,
          f.affectedCount, f.totalCount, f.percentage,
          JSON.stringify(f.affectedResources),
          JSON.stringify(f.evidence),
          JSON.stringify(f.tags ?? []),
          now
        );
      }
    });
    txn(findings);
  },

  findByScan(scanRunId: string, orgId: string): Finding[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM findings WHERE scan_run_id = ? AND org_id = ? ORDER BY severity, category'
    ).all(scanRunId, orgId) as FindingRow[];
    return rows.map(rowToFinding);
  },

  findByCategory(orgId: string, scanRunId: string, category: FindingCategory): Finding[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM findings WHERE org_id = ? AND scan_run_id = ? AND category = ?'
    ).all(orgId, scanRunId, category) as FindingRow[];
    return rows.map(rowToFinding);
  },

  countBySeverity(scanRunId: string, orgId: string): Record<FindingSeverity, number> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM findings WHERE scan_run_id = ? AND org_id = ?
      GROUP BY severity
    `).all(scanRunId, orgId) as Array<{ severity: string; count: number }>;

    const result: Record<FindingSeverity, number> = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    };
    for (const r of rows) {
      result[r.severity as FindingSeverity] = r.count;
    }
    return result;
  },

  deleteByOrg(orgId: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM findings WHERE org_id = ?').run(orgId);
  },
};

function rowToFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    orgId: row.org_id,
    scanRunId: row.scan_run_id,
    category: row.category as FindingCategory,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    severity: row.severity as FindingSeverity,
    title: row.title,
    description: row.description,
    impact: row.impact ?? '',
    recommendation: row.recommendation ?? '',
    affectedCount: row.affected_count,
    totalCount: row.total_count,
    percentage: row.percentage,
    affectedResources: row.affected_resources ? JSON.parse(row.affected_resources) : [],
    evidence: row.evidence ? JSON.parse(row.evidence) : [],
    tags: row.tags ? JSON.parse(row.tags) : [],
    createdAt: row.created_at,
  };
}

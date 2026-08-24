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
  async insertMany(findings: Omit<Finding, 'id' | 'createdAt'>[]): Promise<void> {
    const db = getDatabase();
    const now = new Date().toISOString();

    if (findings.length === 0) return;

    await db.transaction(async (trx) => {
      const rows = findings.map((f) => ({
        id: uuidv4(),
        org_id: f.orgId,
        scan_run_id: f.scanRunId,
        category: f.category,
        rule_id: f.ruleId,
        rule_name: f.ruleName,
        severity: f.severity,
        title: f.title,
        description: f.description,
        impact: f.impact,
        recommendation: f.recommendation,
        affected_count: f.affectedCount,
        total_count: f.totalCount,
        percentage: f.percentage,
        affected_resources: JSON.stringify(f.affectedResources),
        evidence: JSON.stringify(f.evidence),
        tags: JSON.stringify(f.tags ?? []),
        created_at: now,
      }));

      await trx('findings').insert(rows);
    });
  },

  async findByScan(scanRunId: string, orgId: string): Promise<Finding[]> {
    const db = getDatabase();
    const rows = await db<FindingRow>('findings')
      .where({ scan_run_id: scanRunId, org_id: orgId })
      .orderBy([{ column: 'severity' }, { column: 'category' }]);
    return rows.map(rowToFinding);
  },

  async findByCategory(orgId: string, scanRunId: string, category: FindingCategory): Promise<Finding[]> {
    const db = getDatabase();
    const rows = await db<FindingRow>('findings')
      .where({ org_id: orgId, scan_run_id: scanRunId, category });
    return rows.map(rowToFinding);
  },

  async countBySeverity(scanRunId: string, orgId: string): Promise<Record<FindingSeverity, number>> {
    const db = getDatabase();
    const rows = await db<FindingRow>('findings')
      .select('severity')
      .count({ count: '*' })
      .where({ scan_run_id: scanRunId, org_id: orgId })
      .groupBy('severity') as unknown as Array<{ severity: string; count: number | string }>;

    const result: Record<FindingSeverity, number> = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
    };
    for (const r of rows) {
      result[r.severity as FindingSeverity] = Number(r.count);
    }
    return result;
  },

  async deleteByOrg(orgId: string): Promise<void> {
    const db = getDatabase();
    await db('findings').where({ org_id: orgId }).delete();
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

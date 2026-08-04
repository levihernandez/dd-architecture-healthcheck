import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';
import type { OrgScorecard, CategoryScore } from '../../types/assessment.types';

interface ScorecardRow {
  id: string;
  org_id: string;
  scan_run_id: string;
  overall_score: number;
  overall_grade: string;
  category_scores: string;
  total_findings: number;
  critical_findings: number;
  high_findings: number;
  computed_at: string;
}

export const ScorecardRepository = {
  upsert(scorecard: Omit<OrgScorecard, 'id'>): OrgScorecard {
    const db = getDatabase();
    const id = uuidv4();
    db.prepare(`
      INSERT OR REPLACE INTO scorecards
        (id, org_id, scan_run_id, overall_score, overall_grade, category_scores,
         total_findings, critical_findings, high_findings, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      scorecard.orgId,
      scorecard.scanRunId,
      scorecard.overallScore,
      scorecard.overallGrade,
      JSON.stringify(scorecard.categoryScores),
      scorecard.totalFindings,
      scorecard.criticalFindings,
      scorecard.highFindings,
      scorecard.computedAt
    );
    return { ...scorecard } as OrgScorecard;
  },

  findByScan(orgId: string, scanRunId: string): OrgScorecard | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM scorecards WHERE org_id = ? AND scan_run_id = ?'
    ).get(orgId, scanRunId) as ScorecardRow | undefined;
    return row ? rowToScorecard(row) : null;
  },

  findLatestByOrg(orgId: string): OrgScorecard | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT s.* FROM scorecards s
      JOIN scan_runs sr ON s.scan_run_id = sr.id
      WHERE s.org_id = ? AND sr.status = 'completed'
      ORDER BY s.computed_at DESC LIMIT 1
    `).get(orgId) as ScorecardRow | undefined;
    return row ? rowToScorecard(row) : null;
  },

  findAllLatest(): OrgScorecard[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT s.* FROM scorecards s
      INNER JOIN (
        SELECT org_id, MAX(computed_at) as max_date FROM scorecards GROUP BY org_id
      ) latest ON s.org_id = latest.org_id AND s.computed_at = latest.max_date
    `).all() as ScorecardRow[];
    return rows.map(rowToScorecard);
  },
};

function rowToScorecard(row: ScorecardRow): OrgScorecard {
  let categoryScores: CategoryScore[] = [];
  try { categoryScores = JSON.parse(row.category_scores); } catch { /* ignore */ }
  return {
    orgId: row.org_id,
    scanRunId: row.scan_run_id,
    overallScore: row.overall_score,
    overallGrade: row.overall_grade as OrgScorecard['overallGrade'],
    categoryScores,
    totalFindings: row.total_findings,
    criticalFindings: row.critical_findings,
    highFindings: row.high_findings,
    computedAt: row.computed_at,
  };
}

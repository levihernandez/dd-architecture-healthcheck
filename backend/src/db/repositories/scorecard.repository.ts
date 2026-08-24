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
  async upsert(scorecard: Omit<OrgScorecard, 'id'>): Promise<OrgScorecard> {
    const db = getDatabase();
    const id = uuidv4();
    await db('scorecards')
      .insert({
        id,
        org_id: scorecard.orgId,
        scan_run_id: scorecard.scanRunId,
        overall_score: scorecard.overallScore,
        overall_grade: scorecard.overallGrade,
        category_scores: JSON.stringify(scorecard.categoryScores),
        total_findings: scorecard.totalFindings,
        critical_findings: scorecard.criticalFindings,
        high_findings: scorecard.highFindings,
        computed_at: scorecard.computedAt,
      })
      .onConflict(['org_id', 'scan_run_id'])
      .merge();
    return { ...scorecard } as OrgScorecard;
  },

  async findByScan(orgId: string, scanRunId: string): Promise<OrgScorecard | null> {
    const db = getDatabase();
    const row = await db<ScorecardRow>('scorecards')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .first();
    return row ? rowToScorecard(row) : null;
  },

  async findLatestByOrg(orgId: string): Promise<OrgScorecard | null> {
    const db = getDatabase();
    const row = await db<ScorecardRow>('scorecards as s')
      .join('scan_runs as sr', 's.scan_run_id', 'sr.id')
      .where('s.org_id', orgId)
      .andWhere('sr.status', 'completed')
      .orderBy('s.computed_at', 'desc')
      .select('s.*')
      .first();
    return row ? rowToScorecard(row) : null;
  },

  async findAllLatest(): Promise<OrgScorecard[]> {
    const db = getDatabase();
    const latest = db('scorecards')
      .select('org_id')
      .max('computed_at as max_date')
      .groupBy('org_id')
      .as('latest');
    const rows = await db<ScorecardRow>('scorecards as s')
      .innerJoin(latest, function () {
        this.on('s.org_id', '=', 'latest.org_id').andOn('s.computed_at', '=', 'latest.max_date');
      })
      .select('s.*');
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

import { FindingRepository } from '../db/repositories/finding.repository';
import { ScorecardRepository } from '../db/repositories/scorecard.repository';
import { ScanRepository } from '../db/repositories/scan.repository';
import { AppError } from '../api/middleware/error.middleware';
import type { Finding, FindingCategory, OrgScorecard, CategoryScore } from '../types/assessment.types';

export type FindingDiffStatus = 'new' | 'resolved' | 'worsened' | 'improved' | 'unchanged';

export interface FindingSnapshot {
  severity: Finding['severity'];
  title: string;
  affectedCount: number;
  totalCount: number;
  percentage: number;
}

export interface FindingDiff {
  ruleId: string;
  ruleName: string;
  category: FindingCategory;
  status: FindingDiffStatus;
  previous: FindingSnapshot | null;
  current: FindingSnapshot | null;
}

export interface CategoryComparison {
  category: FindingCategory;
  previousScore: number | null;
  currentScore: number | null;
  scoreDelta: number | null;
  concerns: FindingDiff[];
  improvements: FindingDiff[];
  unchangedCount: number;
}

export interface ScanComparisonResult {
  orgId: string;
  previousScanId: string;
  currentScanId: string;
  previousCompletedAt: string | null;
  currentCompletedAt: string | null;
  overallPreviousScore: number | null;
  overallCurrentScore: number | null;
  overallScoreDelta: number | null;
  categories: CategoryComparison[];
  topConcerns: FindingDiff[];
  topImprovements: FindingDiff[];
}

// Every category the assessment engine can produce a finding for — iterated
// so a category with zero findings in either scan (a real "nothing to report"
// state) still shows up with its score delta rather than silently vanishing.
const ALL_CATEGORIES: FindingCategory[] = [
  'unified_tagging', 'service_architecture', 'integration_hygiene', 'logs_health',
  'monitors_health', 'dashboards_health', 'synthetics_health', 'network_cloud',
  'governance', 'security_posture', 'cost_optimization',
];

const SEVERITY_RANK: Record<Finding['severity'], number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};

function toSnapshot(f: Finding): FindingSnapshot {
  return { severity: f.severity, title: f.title, affectedCount: f.affectedCount, totalCount: f.totalCount, percentage: f.percentage };
}

// A rule fires at most one Finding per scan (see backend/src/assessment/rules/*.ts
// — each rule's `run()` returns `findings: passed ? [] : [{...}]`), so ruleId is
// a safe 1:1 key for matching the "same issue" across two different scans.
function diffFinding(ruleId: string, ruleName: string, category: FindingCategory, prev: Finding | undefined, curr: Finding | undefined): FindingDiff {
  if (prev && !curr) return { ruleId, ruleName, category, status: 'resolved', previous: toSnapshot(prev), current: null };
  if (!prev && curr) return { ruleId, ruleName, category, status: 'new', previous: null, current: toSnapshot(curr) };
  if (!prev || !curr) throw new Error('diffFinding requires at least one side to be defined');

  const severityWorsened = SEVERITY_RANK[curr.severity] > SEVERITY_RANK[prev.severity];
  const severityImproved = SEVERITY_RANK[curr.severity] < SEVERITY_RANK[prev.severity];
  const coverageWorsened = curr.percentage < prev.percentage;
  const coverageImproved = curr.percentage > prev.percentage;

  let status: FindingDiffStatus = 'unchanged';
  if (severityWorsened || coverageWorsened) status = 'worsened';
  else if (severityImproved || coverageImproved) status = 'improved';

  return { ruleId, ruleName, category, status, previous: toSnapshot(prev), current: toSnapshot(curr) };
}

function categoryScoreOf(scorecard: OrgScorecard | null, category: FindingCategory): number | null {
  const entry = scorecard?.categoryScores.find((c: CategoryScore) => c.category === category);
  return entry?.percentage ?? null;
}

export function compareScans(orgId: string, previousScanId: string, currentScanId: string): ScanComparisonResult {
  const previousScan = ScanRepository.findById(previousScanId);
  const currentScan = ScanRepository.findById(currentScanId);
  if (!previousScan || previousScan.orgId !== orgId) throw new AppError('Previous scan not found for this org', 404);
  if (!currentScan || currentScan.orgId !== orgId) throw new AppError('Current scan not found for this org', 404);

  const previousFindings = FindingRepository.findByScan(previousScanId, orgId);
  const currentFindings = FindingRepository.findByScan(currentScanId, orgId);
  const previousScorecard = ScorecardRepository.findByScan(orgId, previousScanId);
  const currentScorecard = ScorecardRepository.findByScan(orgId, currentScanId);

  const prevByRule = new Map(previousFindings.map((f) => [f.ruleId, f]));
  const currByRule = new Map(currentFindings.map((f) => [f.ruleId, f]));
  const allRuleIds = new Set([...prevByRule.keys(), ...currByRule.keys()]);

  const diffsByCategory = new Map<FindingCategory, FindingDiff[]>();
  for (const ruleId of allRuleIds) {
    const prev = prevByRule.get(ruleId);
    const curr = currByRule.get(ruleId);
    const source = curr ?? prev!;
    const diff = diffFinding(ruleId, source.ruleName, source.category, prev, curr);
    const list = diffsByCategory.get(diff.category) ?? [];
    list.push(diff);
    diffsByCategory.set(diff.category, list);
  }

  const categories: CategoryComparison[] = ALL_CATEGORIES.map((category) => {
    const diffs = diffsByCategory.get(category) ?? [];
    const concerns = diffs.filter((d) => d.status === 'new' || d.status === 'worsened');
    const improvements = diffs.filter((d) => d.status === 'resolved' || d.status === 'improved');
    const unchangedCount = diffs.filter((d) => d.status === 'unchanged').length;
    const previousScore = categoryScoreOf(previousScorecard, category);
    const currentScore = categoryScoreOf(currentScorecard, category);
    return {
      category,
      previousScore,
      currentScore,
      scoreDelta: previousScore !== null && currentScore !== null ? currentScore - previousScore : null,
      concerns,
      improvements,
      unchangedCount,
    };
  });

  const allDiffs = categories.flatMap((c) => [...c.concerns, ...c.improvements]);
  const topConcerns = allDiffs
    .filter((d) => d.status === 'new' || d.status === 'worsened')
    .sort((a, b) => SEVERITY_RANK[(b.current ?? b.previous)!.severity] - SEVERITY_RANK[(a.current ?? a.previous)!.severity])
    .slice(0, 25);
  const topImprovements = allDiffs
    .filter((d) => d.status === 'resolved' || d.status === 'improved')
    .sort((a, b) => SEVERITY_RANK[(b.previous ?? b.current)!.severity] - SEVERITY_RANK[(a.previous ?? a.current)!.severity])
    .slice(0, 25);

  return {
    orgId,
    previousScanId,
    currentScanId,
    previousCompletedAt: previousScan.completedAt ?? null,
    currentCompletedAt: currentScan.completedAt ?? null,
    overallPreviousScore: previousScorecard?.overallScore ?? null,
    overallCurrentScore: currentScorecard?.overallScore ?? null,
    overallScoreDelta: previousScorecard && currentScorecard ? currentScorecard.overallScore - previousScorecard.overallScore : null,
    categories,
    topConcerns,
    topImprovements,
  };
}

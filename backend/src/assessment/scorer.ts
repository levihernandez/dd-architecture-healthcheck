import type {
  Finding, OrgScorecard, CategoryScore, ScoreGrade, FindingCategory
} from '../types/assessment.types';

const CATEGORY_WEIGHTS: Record<FindingCategory, number> = {
  unified_tagging: 30,
  service_architecture: 20,
  monitors_health: 15,
  logs_health: 10,
  dashboards_health: 5,
  synthetics_health: 5,
  integration_hygiene: 8,
  network_cloud: 4,
  governance: 3,
};

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  critical: 25,
  high: 10,
  medium: 5,
  low: 2,
  info: 0,
};

export function computeScorecard(
  orgId: string,
  scanRunId: string,
  findings: Finding[]
): Omit<OrgScorecard, 'id'> {
  const categories = Object.keys(CATEGORY_WEIGHTS) as FindingCategory[];
  const categoryScores: CategoryScore[] = [];

  let weightedTotal = 0;
  let weightSum = 0;

  for (const category of categories) {
    const catFindings = findings.filter((f) => f.category === category);
    const score = computeCategoryScore(category, catFindings);
    categoryScores.push(score);
    weightedTotal += score.percentage * CATEGORY_WEIGHTS[category];
    weightSum += CATEGORY_WEIGHTS[category];
  }

  const overallScore = weightSum > 0 ? Math.round(weightedTotal / weightSum) : 100;
  const overallGrade = getGrade(overallScore);

  const criticalFindings = findings.filter((f) => f.severity === 'critical').length;
  const highFindings = findings.filter((f) => f.severity === 'high').length;

  return {
    orgId,
    scanRunId,
    overallScore,
    overallGrade,
    categoryScores,
    totalFindings: findings.length,
    criticalFindings,
    highFindings,
    computedAt: new Date().toISOString(),
  };
}

function computeCategoryScore(category: FindingCategory, findings: Finding[]): CategoryScore {
  let score = 100;

  for (const finding of findings) {
    score -= SEVERITY_DEDUCTIONS[finding.severity] ?? 0;
  }

  score = Math.max(0, Math.min(100, score));

  const findingCounts = {
    critical: findings.filter((f) => f.severity === 'critical').length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };

  const topFindings = findings
    .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity))
    .slice(0, 5)
    .map((f) => f.title);

  return {
    category,
    score,
    maxScore: 100,
    percentage: score,
    grade: getGrade(score),
    findingCounts,
    topFindings,
  };
}

function severityOrder(s: string): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[s] ?? 5;
}

export function getGrade(score: number): ScoreGrade {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'needs_attention';
  return 'critical';
}

export function gradeLabel(grade: ScoreGrade): string {
  return {
    excellent: 'Excellent',
    good: 'Good',
    needs_attention: 'Needs Attention',
    critical: 'Critical',
  }[grade];
}

export function gradeColor(grade: ScoreGrade): string {
  return {
    excellent: '#10b981',
    good: '#3b82f6',
    needs_attention: '#f59e0b',
    critical: '#ef4444',
  }[grade];
}

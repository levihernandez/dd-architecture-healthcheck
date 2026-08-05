import type { ScoreGrade } from '../types/assessment.types';
import { getGrade } from '../assessment/scorer';

// Reuses the existing scorecard grade — not a parallel scoring system, just a
// maturity-flavored label for the same excellent/good/needs_attention/critical scale.
export const MATURITY_LABELS: Record<ScoreGrade, string> = {
  excellent: 'Mature',
  good: 'Maturing',
  needs_attention: 'Developing',
  critical: 'Early-stage',
};

export function maturityLabel(grade: ScoreGrade): string {
  return MATURITY_LABELS[grade];
}

export function maturityForPercentage(percentage: number): string {
  return maturityLabel(getGrade(percentage));
}

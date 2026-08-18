import { logger } from '../utils/logger';
import type { AIAssessmentRequest, AIAssessmentResponse } from '../types/assessment.types';

export interface ValidationIssue {
  path: string;
  reason: 'unverifiable_ref' | 'unverifiable_number';
  original: string;
}

export interface ValidationResult {
  assessment: AIAssessmentResponse;
  issues: ValidationIssue[];
}

/** Numbers below this are too common (percentages, small counts, priority indices)
 * to usefully verify against — checking them produces mostly noise, not signal. */
const MIN_VERIFIABLE_NUMBER = 3;

/** Builds the set of numbers/identifiers that were actually available to the model
 * when it wrote the assessment — the same request/summary data used to build the
 * prompt (see prompts.ts buildAssessmentPrompt). Anything an evidenceRef claims
 * that isn't traceable to one of these is, by construction, not grounded. */
function buildLookupSet(req: AIAssessmentRequest): { numbers: Set<number>; strings: Set<string> } {
  const numbers = new Set<number>();
  const strings = new Set<string>();

  const addString = (s: string | undefined | null) => {
    if (s && s.trim().length > 0) strings.add(s.trim().toLowerCase());
  };
  const addNumber = (n: number | undefined | null) => {
    if (typeof n === 'number' && Number.isFinite(n)) numbers.add(n);
  };

  const { scorecard, findingSummary, inventorySummary, tagAnalysis } = req;

  // Scorecard
  addNumber(scorecard.overallScore);
  addNumber(scorecard.totalFindings);
  addNumber(scorecard.criticalFindings);
  addNumber(scorecard.highFindings);
  for (const c of scorecard.categoryScores) {
    addNumber(c.percentage);
    addNumber(c.findingCounts.critical);
    addNumber(c.findingCounts.high);
    addString(c.category);
  }

  // Inventory counts
  addNumber(inventorySummary.hostCount);
  addNumber(inventorySummary.serviceCount);
  addNumber(inventorySummary.monitorCount);
  addNumber(inventorySummary.dashboardCount);
  addNumber(inventorySummary.syntheticsCount);
  addNumber(inventorySummary.integrationCount);
  addNumber(inventorySummary.sloCount);
  addNumber(inventorySummary.teamCount);
  addNumber(inventorySummary.logsIndexCount);
  addNumber(inventorySummary.logsPipelineCount);

  // Tag analysis
  addNumber(tagAnalysis.totalTagKeys);
  addNumber(tagAnalysis.envCoverage);
  addNumber(tagAnalysis.serviceCoverage);
  addNumber(tagAnalysis.versionCoverage);
  addNumber(tagAnalysis.teamCoverage);
  tagAnalysis.uniqueTagKeys.forEach(addString);
  tagAnalysis.topTagKeys.forEach((t) => { addString(t.key); addNumber(t.count); addNumber(t.coverage); });
  tagAnalysis.missingStandardTags.forEach(addString);
  tagAnalysis.tagMappingSuggestions.forEach((m) => { addString(m.existingKey); addString(m.suggestedKey); });

  // Findings + capped resource refs (see ai/service.ts buildFindingSummary)
  for (const data of Object.values(findingSummary.byCategory)) {
    for (const f of data.topFindings) {
      addString(f.title);
      addNumber(f.affectedCount);
      addNumber(f.totalCount);
      addNumber(f.percentage);
      for (const r of f.resources) {
        addString(r.id);
        addString(r.name);
      }
    }
  }
  addNumber(findingSummary.totalFindings);
  for (const n of Object.values(findingSummary.bySeverity)) addNumber(n);

  return { numbers, strings };
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+(\.\d+)?/g);
  if (!matches) return [];
  return matches.map(Number).filter((n) => Number.isFinite(n));
}

/** Returns true if `text` contains a known string token (resource id/name, tag key,
 * category, finding title, etc.) as a case-insensitive substring. */
function matchesKnownString(text: string, strings: Set<string>): boolean {
  const lower = text.toLowerCase();
  for (const s of strings) {
    // Skip very short tokens — they'd match almost anything and defeat the check.
    if (s.length >= 3 && lower.includes(s)) return true;
  }
  return false;
}

/** Post-generation grounding check for the one-shot assessment. Does not retry or
 * reject the AI's response — it only annotates unverifiable evidence references
 * in place and reports what it found, per the "flag don't retry" design. */
export function validateAssessment(
  assessment: AIAssessmentResponse,
  req: AIAssessmentRequest
): ValidationResult {
  const { numbers, strings } = buildLookupSet(req);
  const issues: ValidationIssue[] = [];

  const recommendations = assessment.prioritizedRecommendations.map((rec, recIdx) => {
    let verifiedCount = 0;

    const evidenceRefs = rec.evidenceRefs.map((ref, refIdx) => {
      const path = `prioritizedRecommendations[${recIdx}].evidenceRefs[${refIdx}]`;
      const nums = extractNumbers(ref).filter((n) => Math.abs(n) >= MIN_VERIFIABLE_NUMBER);
      const numberMatch = nums.length === 0 || nums.some((n) => numbers.has(n));
      const stringMatch = matchesKnownString(ref, strings);

      if (numberMatch && (stringMatch || nums.length > 0)) {
        verifiedCount++;
        return ref;
      }
      if (stringMatch) {
        verifiedCount++;
        return ref;
      }

      const reason: ValidationIssue['reason'] = nums.length > 0 && !numberMatch ? 'unverifiable_number' : 'unverifiable_ref';
      issues.push({ path, reason, original: ref });
      return `[unverified] ${ref}`;
    });

    return verifiedCount === 0 && rec.evidenceRefs.length > 0
      ? { ...rec, evidenceRefs, confidence: 'low' as const }
      : { ...rec, evidenceRefs };
  });

  if (issues.length > 0) {
    logger.warn(`AI assessment grounding check: ${issues.length} unverifiable evidence reference(s) flagged across ${recommendations.length} recommendation(s)`);
  }

  return {
    assessment: { ...assessment, prioritizedRecommendations: recommendations },
    issues,
  };
}

import type { AIAssessmentRequest, TopFindingSummary } from '../types/assessment.types';
import { gradeLabel } from '../assessment/scorer';
import { getPrompt } from './prompt-store';

/** Renders a top finding with its capped, concrete resource refs so the model has
 * something real to cite as evidence instead of only a category-level percentage. */
function formatTopFinding(f: TopFindingSummary): string {
  const base = `${f.title} (${f.affectedCount}/${f.totalCount}, ${Math.round(f.percentage)}%)`;
  if (f.resources.length === 0) return base;
  const shown = f.resources.map((r) => r.name || r.id).join(', ');
  const remaining = f.totalResourceCount - f.resources.length;
  const type = f.resources[0]?.type ? `${f.resources[0].type}s` : 'resources';
  return `${base} [${type}: ${shown}${remaining > 0 ? `, +${remaining} more` : ''}]`;
}

export function buildAssessmentPrompt(req: AIAssessmentRequest): string {
  const { scorecard, findingSummary, inventorySummary, tagAnalysis } = req;

  const scanData = `## Organization Scorecard

Overall Score: ${scorecard.overallScore}/100 (${gradeLabel(scorecard.overallGrade)})
Total Findings: ${scorecard.totalFindings} (Critical: ${scorecard.criticalFindings}, High: ${scorecard.highFindings})

### Category Scores
${scorecard.categoryScores.map((c) =>
  `- ${formatCategory(c.category)}: ${c.percentage}/100 (${gradeLabel(c.grade)}) — ${c.findingCounts.critical} critical, ${c.findingCounts.high} high findings`
).join('\n')}

## Inventory Summary
- Hosts/Infrastructure: ${inventorySummary.hostCount}
- APM Services: ${inventorySummary.serviceCount}
- Monitors: ${inventorySummary.monitorCount}
- Dashboards: ${inventorySummary.dashboardCount}
- Synthetics Tests: ${inventorySummary.syntheticsCount}
- Integrations: ${inventorySummary.integrationCount}
- SLOs: ${inventorySummary.sloCount}
- Teams: ${inventorySummary.teamCount}
- Log Indexes: ${inventorySummary.logsIndexCount}
- Log Pipelines: ${inventorySummary.logsPipelineCount}

## Tag Analysis
- Total unique tag keys: ${tagAnalysis.totalTagKeys}
- env tag coverage: ${tagAnalysis.envCoverage}%
- service tag coverage: ${tagAnalysis.serviceCoverage}%
- version tag coverage: ${tagAnalysis.versionCoverage}%
- team tag coverage: ${tagAnalysis.teamCoverage}%
- Top tag keys: ${tagAnalysis.topTagKeys.slice(0, 10).map((t) => `${t.key} (${t.coverage}% coverage)`).join(', ')}
- Missing standard tags: ${tagAnalysis.missingStandardTags.join(', ') || 'none'}

### Tag Mapping Suggestions
${tagAnalysis.tagMappingSuggestions.length > 0
  ? tagAnalysis.tagMappingSuggestions.map((m) =>
      `- "${m.existingKey}" → "${m.suggestedKey}" (reason: ${m.reason}, examples: ${m.sampleValues.slice(0, 3).join(', ')})`
    ).join('\n')
  : 'No mapping suggestions — tag keys appear aligned with standards.'}

## Key Findings by Category
${Object.entries(findingSummary.byCategory).map(([cat, data]) =>
  data.count > 0
    ? `### ${formatCategory(cat as keyof typeof findingSummary.byCategory)}\n${data.count} findings\nTop: ${data.topFindings.slice(0, 3).map(formatTopFinding).join('; ')}`
    : null
).filter(Boolean).join('\n\n')}`;

  // Static instructional prose lives in the host-editable `assessment-instructions`
  // prompt file — the scan data computed above, plus the generatedAt/evidenceCount
  // values, are spliced into its {{SCAN_DATA}}/{{GENERATED_AT}}/{{EVIDENCE_COUNT}}
  // markers so the file stays a single source of truth for the wording.
  return getPrompt('assessment-instructions')
    .replace('{{SCAN_DATA}}', () => scanData) // function form: avoids `$`-pattern interpolation in scan data
    .replace('{{GENERATED_AT}}', new Date().toISOString())
    .replace('{{EVIDENCE_COUNT}}', String(scorecard.totalFindings));
}

function formatCategory(category: string): string {
  return category.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

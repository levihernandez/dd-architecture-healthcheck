import type { AIAssessmentRequest } from '../types/assessment.types';
import { gradeLabel } from '../assessment/scorer';

export function buildAssessmentPrompt(req: AIAssessmentRequest): string {
  const { scorecard, findingSummary, inventorySummary, tagAnalysis } = req;

  return `You are a Datadog Solutions Engineer performing a formal Architecture Health Check for a customer. You have access to the following scan data collected via read-only Datadog API calls. You must base all findings and recommendations strictly on this data — do not invent statistics or issues not supported by the evidence.

## Organization Scorecard

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
    ? `### ${formatCategory(cat as keyof typeof findingSummary.byCategory)}\n${data.count} findings\nTop: ${data.topFindings.slice(0, 3).join('; ')}`
    : null
).filter(Boolean).join('\n\n')}

---

Based solely on the above evidence, produce a structured health check assessment in the following JSON format. Every recommendation must reference at least one evidence field from the data above.

Respond with valid JSON matching this schema:
{
  "executiveSummary": "3-5 sentence executive summary suitable for a VP Engineering",
  "keyStrengths": ["strength1", "strength2", "strength3"],
  "topRisks": ["risk1", "risk2", "risk3"],
  "prioritizedRecommendations": [
    {
      "priority": 1,
      "title": "string",
      "description": "string",
      "effort": "low|medium|high",
      "impact": "low|medium|high",
      "category": "unified_tagging|service_architecture|monitors_health|logs_health|dashboards_health|synthetics_health|integration_hygiene|network_cloud|governance",
      "evidenceRefs": ["specific data point from the scan that supports this recommendation"]
    }
  ],
  "taggingStrategyProposal": {
    "requiredTags": [{"key": "env", "description": "...", "examples": ["prod", "staging"], "required": true}],
    "recommendedTags": [{"key": "team", "description": "...", "examples": ["platform", "data"], "required": false}],
    "tagMappings": [{"from": "existing_key", "to": "standard_key", "rationale": "..."}]
  },
  "serviceOwnershipModel": "Paragraph describing recommended service ownership model based on findings",
  "remediationPlan": [
    {
      "phase": 1,
      "title": "Immediate (Week 1-2)",
      "timeframe": "2 weeks",
      "actions": ["action1", "action2"],
      "expectedOutcome": "..."
    }
  ],
  "healthCheckTakeaways": ["takeaway1", "takeaway2", "takeaway3"],
  "generatedAt": "${new Date().toISOString()}",
  "evidenceCount": ${scorecard.totalFindings}
}`;
}

function formatCategory(category: string): string {
  return category.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

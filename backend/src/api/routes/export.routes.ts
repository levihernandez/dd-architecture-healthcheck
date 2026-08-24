import { Router } from 'express';
import { ScanRepository } from '../../db/repositories/scan.repository';
import { ScorecardRepository } from '../../db/repositories/scorecard.repository';
import { FindingRepository } from '../../db/repositories/finding.repository';
import { getStoredAssessment } from '../../ai/service';
import { assertOrgAccess } from '../../auth/org-access';
import { AppError } from '../middleware/error.middleware';
import { gradeLabel, gradeColor } from '../../assessment/scorer';

const router = Router();

// GET /api/export/:scanRunId?format=json|csv|markdown|html
router.get('/:scanRunId', async (req, res, next) => {
  try {
    const { format = 'json' } = req.query;

    const scan = await ScanRepository.findById(req.params.scanRunId);
    if (!scan) throw new AppError('Scan not found', 404);
    await assertOrgAccess(scan.orgId, req.user!.id);
    const orgId = scan.orgId;

    const scorecard = await ScorecardRepository.findByScan(orgId, req.params.scanRunId);
    const findings = await FindingRepository.findByScan(req.params.scanRunId, orgId);
    const aiAssessment = await getStoredAssessment(orgId, req.params.scanRunId);

    switch (format) {
      case 'json':
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=health-check-${req.params.scanRunId}.json`);
        res.json({ scan, scorecard, findings, aiAssessment });
        break;

      case 'csv':
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=findings-${req.params.scanRunId}.csv`);
        res.send(buildCSV(findings));
        break;

      case 'markdown':
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', `attachment; filename=health-check-${req.params.scanRunId}.md`);
        res.send(buildMarkdown(scan, scorecard, findings, aiAssessment));
        break;

      case 'html':
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename=health-check-${req.params.scanRunId}.html`);
        res.send(buildHTML(scan, scorecard, findings, aiAssessment));
        break;

      default:
        throw new AppError('Invalid format. Use json, csv, markdown, or html', 400);
    }
  } catch (err) { next(err); }
});

function buildCSV(findings: Awaited<ReturnType<typeof FindingRepository.findByScan>>): string {
  const header = 'Category,Rule ID,Severity,Title,Affected Count,Total Count,Percentage,Recommendation\n';
  const rows = findings.map((f) =>
    [f.category, f.ruleId, f.severity, `"${f.title.replace(/"/g, '""')}"`,
     f.affectedCount, f.totalCount, f.percentage,
     `"${f.recommendation.replace(/"/g, '""')}"`].join(',')
  ).join('\n');
  return header + rows;
}

function buildMarkdown(
  scan: Awaited<ReturnType<typeof ScanRepository.findById>>,
  scorecard: Awaited<ReturnType<typeof ScorecardRepository.findByScan>>,
  findings: Awaited<ReturnType<typeof FindingRepository.findByScan>>,
  ai: Awaited<ReturnType<typeof getStoredAssessment>>
): string {
  const lines: string[] = [
    '# Datadog Architecture Health Check Report',
    '',
    `**Scan Date:** ${scan?.startedAt}`,
    `**Overall Score:** ${scorecard?.overallScore ?? 'N/A'}/100 (${scorecard ? gradeLabel(scorecard.overallGrade) : 'N/A'})`,
    `**Total Findings:** ${findings.length}`,
    '',
  ];

  if (ai?.executiveSummary) {
    lines.push('## Executive Summary', '', ai.executiveSummary, '');
  }

  if (scorecard) {
    lines.push('## Category Scores', '');
    for (const cat of scorecard.categoryScores) {
      lines.push(`- **${cat.category.replace(/_/g, ' ')}**: ${cat.percentage}/100 (${gradeLabel(cat.grade)})`);
    }
    lines.push('');
  }

  lines.push('## Findings', '');
  for (const sev of ['critical', 'high', 'medium', 'low', 'info'] as const) {
    const sevFindings = findings.filter((f) => f.severity === sev);
    if (sevFindings.length === 0) continue;
    lines.push(`### ${sev.charAt(0).toUpperCase() + sev.slice(1)} (${sevFindings.length})`, '');
    for (const f of sevFindings) {
      lines.push(`#### ${f.title}`, '', f.description, '', `**Recommendation:** ${f.recommendation}`, '');
    }
  }

  if (ai?.prioritizedRecommendations) {
    lines.push('## Prioritized Recommendations', '');
    for (const rec of ai.prioritizedRecommendations.slice(0, 10)) {
      lines.push(`${rec.priority}. **${rec.title}** (${rec.effort} effort, ${rec.impact} impact)`, `   ${rec.description}`, '');
    }
  }

  return lines.join('\n');
}

function buildHTML(
  scan: Awaited<ReturnType<typeof ScanRepository.findById>>,
  scorecard: Awaited<ReturnType<typeof ScorecardRepository.findByScan>>,
  findings: Awaited<ReturnType<typeof FindingRepository.findByScan>>,
  ai: Awaited<ReturnType<typeof getStoredAssessment>>
): string {
  const grade = scorecard?.overallGrade ?? 'needs_attention';
  const color = scorecard ? gradeColor(scorecard.overallGrade) : '#f59e0b';
  const score = scorecard?.overallScore ?? 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Datadog Architecture Health Check</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; color: #111; background: #f8fafc; }
  .header { background: #632ca6; color: white; padding: 24px 32px; border-radius: 8px; margin-bottom: 24px; }
  .score-badge { display: inline-block; font-size: 48px; font-weight: bold; color: ${color}; background: white; border-radius: 50%; width: 80px; height: 80px; line-height: 80px; text-align: center; }
  .card { background: white; border-radius: 8px; padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .severity-critical { color: #ef4444; } .severity-high { color: #f97316; }
  .severity-medium { color: #f59e0b; } .severity-low { color: #3b82f6; }
  .finding { border-left: 4px solid #e5e7eb; padding: 12px 16px; margin-bottom: 12px; }
  .finding.critical { border-color: #ef4444; } .finding.high { border-color: #f97316; }
  .finding.medium { border-color: #f59e0b; } .finding.low { border-color: #3b82f6; }
  table { width: 100%; border-collapse: collapse; } th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
  th { background: #f8fafc; font-weight: 600; }
</style>
</head>
<body>
<div class="header">
  <h1 style="margin:0 0 8px">Datadog Architecture Health Check</h1>
  <p style="margin:0;opacity:0.85">Generated: ${new Date().toISOString().split('T')[0]}</p>
</div>

<div class="card" style="display:flex;align-items:center;gap:24px">
  <div class="score-badge">${score}</div>
  <div>
    <h2 style="margin:0">Overall Score: ${score}/100</h2>
    <p style="margin:4px 0;color:${color};font-weight:bold">${gradeLabel(grade)}</p>
    <p style="margin:0;color:#6b7280">${findings.length} total findings · ${scorecard?.criticalFindings ?? 0} critical · ${scorecard?.highFindings ?? 0} high</p>
  </div>
</div>

${ai?.executiveSummary ? `<div class="card"><h2>Executive Summary</h2><p>${ai.executiveSummary}</p></div>` : ''}

<div class="card">
  <h2>Category Scores</h2>
  <table>
    <tr><th>Category</th><th>Score</th><th>Grade</th><th>Critical</th><th>High</th></tr>
    ${(scorecard?.categoryScores ?? []).map((c) => `
      <tr>
        <td>${c.category.replace(/_/g, ' ')}</td>
        <td>${c.percentage}/100</td>
        <td style="color:${gradeColor(c.grade)}">${gradeLabel(c.grade)}</td>
        <td class="severity-critical">${c.findingCounts.critical}</td>
        <td class="severity-high">${c.findingCounts.high}</td>
      </tr>`).join('')}
  </table>
</div>

<div class="card">
  <h2>Findings</h2>
  ${findings.slice(0, 50).map((f) => `
    <div class="finding ${f.severity}">
      <strong class="severity-${f.severity}">[${f.severity.toUpperCase()}]</strong> ${f.title}
      <p style="margin:4px 0;color:#6b7280">${f.description}</p>
      <p style="margin:4px 0"><strong>Recommendation:</strong> ${f.recommendation}</p>
    </div>`).join('')}
</div>

${ai?.prioritizedRecommendations ? `
<div class="card">
  <h2>Prioritized Recommendations</h2>
  <ol>
    ${ai.prioritizedRecommendations.slice(0, 10).map((r) =>
      `<li><strong>${r.title}</strong> — ${r.description}</li>`
    ).join('')}
  </ol>
</div>` : ''}

</body>
</html>`;
}

export default router;

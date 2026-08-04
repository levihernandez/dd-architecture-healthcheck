import { computeScorecard, getGrade } from '../../src/assessment/scorer';
import type { Finding } from '../../src/types/assessment.types';

describe('Scorer', () => {
  describe('getGrade', () => {
    it('returns excellent for 90-100', () => {
      expect(getGrade(100)).toBe('excellent');
      expect(getGrade(90)).toBe('excellent');
    });
    it('returns good for 75-89', () => {
      expect(getGrade(89)).toBe('good');
      expect(getGrade(75)).toBe('good');
    });
    it('returns needs_attention for 50-74', () => {
      expect(getGrade(74)).toBe('needs_attention');
      expect(getGrade(50)).toBe('needs_attention');
    });
    it('returns critical for below 50', () => {
      expect(getGrade(49)).toBe('critical');
      expect(getGrade(0)).toBe('critical');
    });
  });

  describe('computeScorecard', () => {
    const orgId = 'test-org';
    const scanRunId = 'test-scan';

    it('returns 100 score with no findings', () => {
      const sc = computeScorecard(orgId, scanRunId, []);
      expect(sc.overallScore).toBe(100);
      expect(sc.overallGrade).toBe('excellent');
      expect(sc.totalFindings).toBe(0);
      expect(sc.criticalFindings).toBe(0);
    });

    it('deducts heavily for critical findings', () => {
      const findings: Finding[] = [
        {
          id: 'f1', orgId, scanRunId,
          category: 'unified_tagging',
          ruleId: 'ust-001', ruleName: 'env tag',
          severity: 'critical',
          title: 'Missing env tags',
          description: 'desc', impact: 'impact', recommendation: 'rec',
          affectedCount: 50, totalCount: 100, percentage: 50,
          affectedResources: [], evidence: [],
          createdAt: new Date().toISOString(),
        },
      ];
      const sc = computeScorecard(orgId, scanRunId, findings);
      expect(sc.criticalFindings).toBe(1);
      expect(sc.categoryScores.find((c) => c.category === 'unified_tagging')!.percentage).toBeLessThan(100);
    });

    it('includes all required categories in scorecard', () => {
      const sc = computeScorecard(orgId, scanRunId, []);
      const categories = sc.categoryScores.map((c) => c.category);
      expect(categories).toContain('unified_tagging');
      expect(categories).toContain('service_architecture');
      expect(categories).toContain('monitors_health');
      expect(categories).toContain('logs_health');
      expect(categories).toContain('governance');
    });
  });
});

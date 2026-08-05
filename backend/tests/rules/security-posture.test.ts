import Database from 'better-sqlite3';
import { securityPostureRules } from '../../src/assessment/rules/security-posture.rules';
import { runMigrations } from '../../src/db/schema';
import type { AssessmentContext } from '../../src/types/assessment.types';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedOrg(db: Database.Database, orgId: string) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO orgs (id, name, site, session_only, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orgId, 'Test Org', 'datadoghq.com', 0, now, now);

  db.prepare(`
    INSERT INTO scan_runs (id, org_id, status, started_at, created_at)
    VALUES (?, ?, 'completed', ?, ?)
  `).run('scan-1', orgId, now, now);
}

const rule = (id: string) => securityPostureRules.find((r) => r.id === id)!;

describe('Security Posture Rules', () => {
  const orgId = 'test-org-1';
  const scanRunId = 'scan-1';

  describe('sec-001: unresolved critical/high security findings', () => {
    function seedFinding(db: Database.Database, id: string, severity: string, status: string | null) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO security_findings (id, org_id, scan_run_id, finding_id, category, severity, status, resource_name, rule_name, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`row-${id}`, orgId, scanRunId, id, 'cspm', severity, status, `resource-${id}`, `rule-${id}`, now, now);
    }

    it('passes when there are no findings', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('sec-001').run(ctx);

      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    it('flags unresolved critical/high findings', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedFinding(db, 'f1', 'critical', 'open');
      seedFinding(db, 'f2', 'high', null);
      seedFinding(db, 'f3', 'low', 'open');

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('sec-001').run(ctx);

      expect(result.passed).toBe(false);
      expect(result.findings[0].affectedCount).toBe(2);
      expect(result.findings[0].category).toBe('security_posture');
    });

    it('does not flag resolved or muted findings', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedFinding(db, 'f1', 'critical', 'resolved');
      seedFinding(db, 'f2', 'high', 'muted');

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('sec-001').run(ctx);

      expect(result.passed).toBe(true);
    });
  });

  describe('sec-002: incidents open longer than a week', () => {
    function seedIncident(db: Database.Database, id: string, state: string | null, createdDaysAgo: number) {
      const now = new Date().toISOString();
      const created = new Date(Date.now() - createdDaysAgo * 86400_000).toISOString();
      db.prepare(`
        INSERT INTO incidents (id, org_id, scan_run_id, incident_id, title, state, created_at_dd, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`row-${id}`, orgId, scanRunId, id, `Incident ${id}`, state, created, now, now);
    }

    it('passes when there are no open incidents', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('sec-002').run(ctx);

      expect(result.passed).toBe(true);
    });

    it('flags incidents open longer than 7 days', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedIncident(db, 'i1', 'active', 10);
      seedIncident(db, 'i2', 'active', 2);
      seedIncident(db, 'i3', 'resolved', 30);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('sec-002').run(ctx);

      expect(result.passed).toBe(false);
      expect(result.findings[0].affectedCount).toBe(1);
      expect(result.findings[0].affectedResources[0].name).toBe('Incident i1');
    });

    it('passes when all stale incidents are resolved', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedIncident(db, 'i1', 'resolved', 10);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('sec-002').run(ctx);

      expect(result.passed).toBe(true);
    });
  });
});

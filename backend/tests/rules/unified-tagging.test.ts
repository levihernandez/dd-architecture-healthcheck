import Database from 'better-sqlite3';
import { unifiedTaggingRules } from '../../src/assessment/rules/unified-tagging.rules';
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

function seedHosts(
  db: Database.Database,
  orgId: string,
  scanRunId: string,
  hosts: Array<{ name: string; hasEnv: boolean; hasService: boolean; hasVersion: boolean; hasTeam: boolean }>
) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO hosts
      (id, org_id, scan_run_id, host_name, has_env_tag, has_service_tag, has_version_tag, has_team_tag, tag_count, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const h of hosts) {
    stmt.run(
      `id-${h.name}`, orgId, scanRunId, h.name,
      h.hasEnv ? 1 : 0, h.hasService ? 1 : 0, h.hasVersion ? 1 : 0, h.hasTeam ? 1 : 0,
      (h.hasEnv ? 1 : 0) + (h.hasService ? 1 : 0),
      now, now
    );
  }
}

describe('Unified Tagging Rules', () => {
  const orgId = 'test-org-1';
  const scanRunId = 'scan-1';

  describe('ust-001: env tag coverage', () => {
    it('passes when all hosts have env tag', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedHosts(db, orgId, scanRunId, [
        { name: 'host-1', hasEnv: true, hasService: true, hasVersion: true, hasTeam: true },
        { name: 'host-2', hasEnv: true, hasService: true, hasVersion: false, hasTeam: false },
      ]);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const rule = unifiedTaggingRules.find((r) => r.id === 'ust-001')!;
      const result = await rule.run(ctx);

      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
      expect(result.score).toBe(100);
    });

    it('generates critical finding when env coverage is below 50%', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedHosts(db, orgId, scanRunId, [
        { name: 'host-1', hasEnv: false, hasService: false, hasVersion: false, hasTeam: false },
        { name: 'host-2', hasEnv: false, hasService: false, hasVersion: false, hasTeam: false },
        { name: 'host-3', hasEnv: false, hasService: true, hasVersion: false, hasTeam: false },
        { name: 'host-4', hasEnv: true, hasService: true, hasVersion: true, hasTeam: true },
      ]);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const rule = unifiedTaggingRules.find((r) => r.id === 'ust-001')!;
      const result = await rule.run(ctx);

      expect(result.passed).toBe(false);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe('critical');
      expect(result.findings[0].affectedCount).toBe(3);
      expect(result.findings[0].totalCount).toBe(4);
      expect(result.findings[0].percentage).toBe(25);
    });

    it('generates medium finding when env coverage is 80%', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedHosts(db, orgId, scanRunId, [
        { name: 'host-1', hasEnv: true, hasService: true, hasVersion: false, hasTeam: false },
        { name: 'host-2', hasEnv: true, hasService: true, hasVersion: false, hasTeam: false },
        { name: 'host-3', hasEnv: true, hasService: false, hasVersion: false, hasTeam: false },
        { name: 'host-4', hasEnv: true, hasService: false, hasVersion: false, hasTeam: false },
        { name: 'host-5', hasEnv: false, hasService: false, hasVersion: false, hasTeam: false },
      ]);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const rule = unifiedTaggingRules.find((r) => r.id === 'ust-001')!;
      const result = await rule.run(ctx);

      expect(result.passed).toBe(false);
      expect(result.findings[0].severity).toBe('medium');
      expect(result.findings[0].percentage).toBe(80);
    });

    it('returns 100% score with no findings when no hosts', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const rule = unifiedTaggingRules.find((r) => r.id === 'ust-001')!;
      const result = await rule.run(ctx);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
    });
  });

  describe('ust-003: version tag coverage', () => {
    it('passes when 70%+ of services have version', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        INSERT INTO services
          (id, org_id, scan_run_id, service_name, has_version_tag, has_service_catalog, has_monitor, has_slo, has_owner, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run('s1', orgId, scanRunId, 'service-a', 1, 0, 0, 0, 0, now, now);
      stmt.run('s2', orgId, scanRunId, 'service-b', 1, 0, 0, 0, 0, now, now);
      stmt.run('s3', orgId, scanRunId, 'service-c', 1, 0, 0, 0, 0, now, now);
      stmt.run('s4', orgId, scanRunId, 'service-d', 0, 0, 0, 0, 0, now, now);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const rule = unifiedTaggingRules.find((r) => r.id === 'ust-003')!;
      const result = await rule.run(ctx);

      expect(result.passed).toBe(true);
    });
  });

  describe('ust-004: monitor env/service tags', () => {
    it('generates finding when monitors lack env/service tags', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        INSERT INTO monitors
          (id, org_id, scan_run_id, monitor_id, has_env_tag, has_service_tag, has_team_tag, has_notification, is_muted, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run('m1', orgId, scanRunId, 1001, 1, 1, 1, 1, 0, now, now);
      stmt.run('m2', orgId, scanRunId, 1002, 0, 0, 0, 0, 0, now, now);
      stmt.run('m3', orgId, scanRunId, 1003, 0, 1, 0, 1, 0, now, now);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const rule = unifiedTaggingRules.find((r) => r.id === 'ust-004')!;
      const result = await rule.run(ctx);

      expect(result.passed).toBe(false);
      expect(result.findings[0].affectedCount).toBe(2);
    });
  });
});

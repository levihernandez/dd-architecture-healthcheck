import Database from 'better-sqlite3';
import { costOptimizationRules } from '../../src/assessment/rules/cost-optimization.rules';
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

function seedUsageSummary(db: Database.Database, orgId: string, scanRunId: string, usage: Record<string, unknown>, charges: Array<{ charge_type: string; product_name: string; cost: number }> = []) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO usage_summary (id, org_id, scan_run_id, report_month, usage_json, cost_json, collected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'usage-1', orgId, scanRunId, '2026-08',
    JSON.stringify({ usage: [usage] }),
    JSON.stringify({ data: [{ attributes: { charges } }] }),
    now
  );
}

const rule = (id: string) => costOptimizationRules.find((r) => r.id === id)!;

describe('Cost Optimization Rules', () => {
  const orgId = 'test-org-1';
  const scanRunId = 'scan-1';

  describe('cost-001: custom metrics + high cardinality tags', () => {
    it('passes when custom metrics usage is zero', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedUsageSummary(db, orgId, scanRunId, { custom_ts_avg: 0 });

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-001').run(ctx);

      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    it('flags high-cardinality tags when custom metrics are in use', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedUsageSummary(db, orgId, scanRunId, { custom_ts_avg: 5000 });
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO tag_analysis (id, org_id, scan_run_id, tag_key, unique_value_count, host_occurrence_count, service_occurrence_count, monitor_occurrence_count, top_values, is_standard_key, suggested_mapping, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('t1', orgId, scanRunId, 'pod_name', 850, 100, 0, 0, '[]', 0, null, now);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-001').run(ctx);

      expect(result.passed).toBe(false);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].category).toBe('cost_optimization');
      expect(result.findings[0].affectedResources[0].name).toBe('pod_name');
    });

    it('does not flag standard-key tags even with high cardinality', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedUsageSummary(db, orgId, scanRunId, { custom_ts_avg: 5000 });
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO tag_analysis (id, org_id, scan_run_id, tag_key, unique_value_count, host_occurrence_count, service_occurrence_count, monitor_occurrence_count, top_values, is_standard_key, suggested_mapping, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('t1', orgId, scanRunId, 'env', 500, 100, 0, 0, '[]', 1, null, now);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-001').run(ctx);

      expect(result.passed).toBe(true);
    });
  });

  describe('cost-002: log ingestion + catch-all indexes', () => {
    it('flags indexes with no exclusion filters when logs are being ingested', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedUsageSummary(db, orgId, scanRunId, { logs_ingested_bytes_sum: 5_000_000_000 });
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO logs_indexes (id, org_id, scan_run_id, index_name, filter_query, retention_days, daily_limit, exclusion_filter_count, is_rate_limited, raw_json, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('idx1', orgId, scanRunId, 'main', '*', 15, null, 0, 0, null, now, now);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-002').run(ctx);

      expect(result.passed).toBe(false);
      expect(result.findings[0].affectedResources[0].name).toBe('main');
    });

    it('passes when indexes have exclusion filters', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedUsageSummary(db, orgId, scanRunId, { logs_ingested_bytes_sum: 5_000_000_000 });
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO logs_indexes (id, org_id, scan_run_id, index_name, filter_query, retention_days, daily_limit, exclusion_filter_count, is_rate_limited, raw_json, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('idx1', orgId, scanRunId, 'main', '*', 15, null, 3, 0, null, now, now);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-002').run(ctx);

      expect(result.passed).toBe(true);
    });
  });

  describe('cost-003: on-demand overage + host tag coverage', () => {
    function seedHosts(db: Database.Database, orgId: string, scanRunId: string, hosts: Array<{ name: string; tagged: boolean }>) {
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        INSERT INTO hosts (id, org_id, scan_run_id, host_name, has_env_tag, has_service_tag, tag_count, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const h of hosts) {
        stmt.run(`id-${h.name}`, orgId, scanRunId, h.name, h.tagged ? 1 : 0, h.tagged ? 1 : 0, h.tagged ? 2 : 0, now, now);
      }
    }

    it('flags low tag coverage when host on-demand charges exist', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedUsageSummary(db, orgId, scanRunId, {}, [{ charge_type: 'on_demand', product_name: 'Infrastructure', cost: 500 }]);
      seedHosts(db, orgId, scanRunId, [
        { name: 'h1', tagged: false }, { name: 'h2', tagged: false }, { name: 'h3', tagged: true }, { name: 'h4', tagged: false },
      ]);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-003').run(ctx);

      expect(result.passed).toBe(false);
      expect(result.findings[0].percentage).toBe(25);
    });

    it('passes when no host on-demand charges exist', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedUsageSummary(db, orgId, scanRunId, {}, [{ charge_type: 'committed', product_name: 'Infrastructure', cost: 500 }]);
      seedHosts(db, orgId, scanRunId, [{ name: 'h1', tagged: false }]);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-003').run(ctx);

      expect(result.passed).toBe(true);
    });

    it('passes when tag coverage is healthy despite on-demand charges', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedUsageSummary(db, orgId, scanRunId, {}, [{ charge_type: 'on_demand', product_name: 'Infrastructure', cost: 500 }]);
      seedHosts(db, orgId, scanRunId, [
        { name: 'h1', tagged: true }, { name: 'h2', tagged: true }, { name: 'h3', tagged: false },
      ]);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-003').run(ctx);

      expect(result.passed).toBe(true);
    });
  });

  describe('cost-004: cloud checks without configured integration', () => {
    it('flags a cloud check with no matching configured integration', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO product_usage_signals (id, org_id, scan_run_id, product, signal, value, detected, evidence, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('sig1', orgId, scanRunId, 'fleet', 'installed_checks', JSON.stringify({ aws: 12, nginx: 3 }), 1, null, now);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-004').run(ctx);

      expect(result.passed).toBe(false);
      expect(result.findings[0].affectedResources[0].name).toBe('aws');
    });

    it('passes when the cloud integration is configured', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO product_usage_signals (id, org_id, scan_run_id, product, signal, value, detected, evidence, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('sig1', orgId, scanRunId, 'fleet', 'installed_checks', JSON.stringify({ aws: 12 }), 1, null, now);
      db.prepare(`
        INSERT INTO cloud_accounts (id, org_id, scan_run_id, provider, account_id, status, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('ca1', orgId, scanRunId, 'aws', '12345', 'configured', now, now);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-004').run(ctx);

      expect(result.passed).toBe(true);
    });

    it('passes when no fleet signal exists', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-004').run(ctx);

      expect(result.passed).toBe(true);
    });
  });

  describe('cost-005: cloud accounts without Cloud Cost Management configured', () => {
    function seedCloudAccount(db: Database.Database, provider: string) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO cloud_accounts (id, org_id, scan_run_id, provider, account_id, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(`ca-${provider}`, orgId, scanRunId, provider, '12345', now, now);
    }

    function seedCcmConfig(db: Database.Database, provider: string, configured: boolean) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO cost_management_config (id, org_id, scan_run_id, provider, configured, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(`cmc-${provider}`, orgId, scanRunId, provider, configured ? 1 : 0, now, now);
    }

    it('passes when there are no cloud accounts configured', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-005').run(ctx);

      expect(result.passed).toBe(true);
    });

    it('flags a cloud account with no matching Cloud Cost Management config', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedCloudAccount(db, 'aws');

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-005').run(ctx);

      expect(result.passed).toBe(false);
      expect(result.findings[0].affectedResources[0].name).toBe('aws');
    });

    it('passes when Cloud Cost Management is configured for the same provider', async () => {
      const db = createTestDb();
      seedOrg(db, orgId);
      seedCloudAccount(db, 'aws');
      seedCcmConfig(db, 'aws', true);

      const ctx: AssessmentContext = { orgId, scanRunId, db };
      const result = await rule('cost-005').run(ctx);

      expect(result.passed).toBe(true);
    });
  });
});

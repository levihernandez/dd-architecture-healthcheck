import { v4 as uuidv4 } from 'uuid';
import { closeDatabase, getDatabase } from '../../src/db/database';
import { buildMaturityAssessmentPrompt } from '../../src/tagging/maturity-assessment';

const orgId = 'test-org-1';

function seedOrg() {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO orgs (id, name, site, session_only, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orgId, 'Test Org', 'datadoghq.com', 0, now, now);
}

function seedCompletedScan(scanRunId: string) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO scan_runs (id, org_id, status, started_at, completed_at, created_at)
    VALUES (?, ?, 'completed', ?, ?, ?)
  `).run(scanRunId, orgId, now, now, now);
}

function seedHost(scanRunId: string, hostName: string) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO hosts
      (id, org_id, scan_run_id, host_name, has_env_tag, has_service_tag, has_version_tag, has_team_tag, tag_count, first_seen, last_seen)
    VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)
  `).run(`id-${hostName}`, orgId, scanRunId, hostName, now, now);
}

function selectTemplate(templateId: string) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO org_tag_template (id, org_id, template_id, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(uuidv4(), orgId, templateId, now);
}

describe('buildMaturityAssessmentPrompt', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    closeDatabase();
    seedOrg();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.DB_PATH;
  });

  it('falls back to the generic template and reports no scan data when nothing has been collected', () => {
    const result = buildMaturityAssessmentPrompt({ orgId });

    expect(result.templateId).toBe('generic');
    expect(result.hasScanData).toBe(false);
    expect(result.promptText).toContain('No completed Architecture Health Check scan is available');
    expect(result.promptText).toContain('visibility gap');
    expect(result.promptText).toContain(result.industry);
  });

  it('uses the org\'s explicitly selected template and its suggested tags', () => {
    selectTemplate('technology');

    const result = buildMaturityAssessmentPrompt({ orgId });

    expect(result.templateId).toBe('technology');
    expect(result.suggestedTagKeys.length).toBeGreaterThan(0);
    expect(result.promptText).toContain(result.suggestedTagKeys[0]);
  });

  it('reports scan data and resource counts when a completed scan exists', () => {
    const scanRunId = 'scan-1';
    seedCompletedScan(scanRunId);
    seedHost(scanRunId, 'host-1');
    seedHost(scanRunId, 'host-2');

    const result = buildMaturityAssessmentPrompt({ orgId, scanRunId });

    expect(result.hasScanData).toBe(true);
    expect(result.promptText).toContain('2 hosts');
    expect(result.promptText).not.toContain('No completed Architecture Health Check scan is available');
  });

  it('does not treat an org with a completed-but-empty scan as having scan data', () => {
    const scanRunId = 'scan-empty';
    seedCompletedScan(scanRunId);

    const result = buildMaturityAssessmentPrompt({ orgId, scanRunId });

    expect(result.hasScanData).toBe(false);
    expect(result.promptText).toContain('No completed Architecture Health Check scan is available');
  });
});

import { closeDatabase, getDatabase } from '../../src/db/database';
import { FindingRepository } from '../../src/db/repositories/finding.repository';
import { buildImplementationGuide } from '../../src/tagging/implementation-guide';
import type { Finding } from '../../src/types/assessment.types';

const orgId = 'test-org-1';
const scanRunId = 'scan-1';

function seedOrg() {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO orgs (id, name, site, session_only, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orgId, 'Test Org', 'datadoghq.com', 0, now, now);

  db.prepare(`
    INSERT INTO scan_runs (id, org_id, status, started_at, created_at)
    VALUES (?, ?, 'completed', ?, ?)
  `).run(scanRunId, orgId, now, now);
}

function seedHost(hostName: string, rawJson: unknown) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO hosts
      (id, org_id, scan_run_id, host_name, has_env_tag, has_service_tag, has_version_tag, has_team_tag, tag_count, raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)
  `).run(`id-${hostName}`, orgId, scanRunId, hostName, JSON.stringify(rawJson), now, now);
}

function seedEnvFinding(affectedHosts: string[]): Omit<Finding, 'id' | 'createdAt'> {
  return {
    orgId,
    scanRunId,
    category: 'unified_tagging',
    ruleId: 'ust-001',
    ruleName: 'Host env tag coverage',
    severity: 'critical',
    title: `${affectedHosts.length} host(s) missing env tag`,
    description: 'desc',
    impact: 'impact',
    recommendation: 'Add env:<environment> tags via agent configuration or automation.',
    affectedCount: affectedHosts.length,
    totalCount: affectedHosts.length,
    percentage: 0,
    affectedResources: affectedHosts.map((h) => ({ type: 'host', id: h, name: h })),
    evidence: [],
    tags: [],
    tagKey: 'env',
  };
}

describe('buildImplementationGuide', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    closeDatabase();
    seedOrg();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.DB_PATH;
  });

  it('produces a gap summary with cloud-provider-enriched resources', () => {
    seedHost('aws-host-1', { tags_by_source: { 'Amazon Web Services': ['region:us-east-1'] } });
    FindingRepository.insertMany([seedEnvFinding(['aws-host-1'])]);

    const result = buildImplementationGuide({ orgId, scanRunId, mode: 'hard', mechanism: 'terraform' });

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].tagKey).toBe('env');
    expect(result.gaps[0].sampleResources[0]).toMatchObject({ type: 'host', name: 'aws-host-1', cloudProvider: 'aws' });
    expect(result.promptText).toContain('Terraform');
    expect(result.promptText).toContain('aws-host-1');
  });

  it('does not warn when the chosen mechanism fits the resources found', () => {
    seedHost('aws-host-1', { tags_by_source: { 'Amazon Web Services': ['region:us-east-1'] } });
    FindingRepository.insertMany([seedEnvFinding(['aws-host-1'])]);

    const result = buildImplementationGuide({ orgId, scanRunId, mode: 'hard', mechanism: 'terraform' });

    expect(result.mechanismWarning).toBeNull();
  });

  it('warns when the chosen mechanism does not fit the affected resources', () => {
    seedHost('aws-host-1', { tags_by_source: { 'Amazon Web Services': ['region:us-east-1'] } });
    FindingRepository.insertMany([seedEnvFinding(['aws-host-1'])]);

    const result = buildImplementationGuide({ orgId, scanRunId, mode: 'hard', mechanism: 'scom' });

    expect(result.mechanismWarning).toContain('aws');
  });

  it('produces a soft-tagging prompt with no mechanism warning', () => {
    seedHost('onprem-host-1', {});
    FindingRepository.insertMany([seedEnvFinding(['onprem-host-1'])]);

    const result = buildImplementationGuide({ orgId, scanRunId, mode: 'soft' });

    expect(result.mechanismWarning).toBeNull();
    expect(result.promptText).toContain('soft tagging');
    expect(result.staticReference.every((l) => l.catchesAt === 'runtime')).toBe(true);
  });

  it('reports no gaps when there are no tagging findings', () => {
    const result = buildImplementationGuide({ orgId, scanRunId, mode: 'hard', mechanism: 'terraform' });

    expect(result.gaps).toHaveLength(0);
    expect(result.promptText).toContain('No tagging gaps found');
  });
});

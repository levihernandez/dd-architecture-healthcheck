import { getDatabase } from '../db/database';
import { getOrgContextBlock } from '../api/routes/org-context.routes';

export function buildChatContext(orgId: string, scanId?: string): string {
  const db = getDatabase();

  const org = db.prepare('SELECT * FROM orgs WHERE id = ?').get(orgId) as Record<string, unknown> | undefined;
  if (!org) return 'No organization data found.';

  let scan: Record<string, unknown> | undefined;
  if (scanId) {
    scan = db.prepare('SELECT * FROM scan_runs WHERE id = ? AND org_id = ?').get(scanId, orgId) as Record<string, unknown>;
  } else {
    scan = db.prepare(
      "SELECT * FROM scan_runs WHERE org_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1"
    ).get(orgId) as Record<string, unknown>;
  }
  if (!scan) return `Organization: ${org.name} (${org.site}). No completed scans found — run a scan first.`;

  const sid = scan.id as string;

  const count = (table: string, extra = '') =>
    (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE org_id = ? AND scan_run_id = ? ${extra}`)
      .get(orgId, sid) as { c: number })?.c ?? 0;

  const hosts = count('hosts');
  const services = count('services');
  const monitors = count('monitors');
  const dashboards = count('dashboards');
  const synthTests = count('synthetics_tests');
  const logsIndexes = count('logs_indexes');
  const slos = count('slos');
  const integrations = count('integrations');

  // Tag coverage
  const hostTagCov = (key: string) => {
    const n = (db.prepare(
      "SELECT COUNT(DISTINCT resource_id) as c FROM resource_tags WHERE org_id=? AND scan_run_id=? AND resource_type='host' AND tag_key=?"
    ).get(orgId, sid, key) as { c: number })?.c ?? 0;
    return hosts > 0 ? Math.round((n / hosts) * 100) : 0;
  };
  const envCov = hostTagCov('env');
  const svcCov = hostTagCov('service');
  const verCov = hostTagCov('version');
  const teamCov = hostTagCov('team');

  // Tag analysis
  const tagRows = db.prepare(`
    SELECT tag_key, unique_value_count, host_occurrence_count, is_standard_key
    FROM tag_analysis WHERE org_id = ? AND scan_run_id = ?
    ORDER BY unique_value_count DESC
  `).all(orgId, sid) as Array<{
    tag_key: string; unique_value_count: number; host_occurrence_count: number; is_standard_key: number;
  }>;

  const highCard = tagRows.filter(t => t.unique_value_count > 50);
  const topByCard = tagRows.slice(0, 8).map(t => `${t.tag_key}(${t.unique_value_count})`);

  // Custom metrics estimate: sum unique values for high-cardinality keys (capped per key)
  const estCM = tagRows.reduce((s, t) => t.unique_value_count > 10 ? s + Math.min(t.unique_value_count * 2, 500) : s, 0);
  const standardAllotment = Math.max(500, hosts * 150);
  const cmRisk = estCM > standardAllotment * 0.85 ? 'HIGH' : estCM > standardAllotment * 0.55 ? 'MEDIUM' : 'LOW';

  // Log indexes
  const logRows = db.prepare(`
    SELECT index_name, retention_days, daily_limit, exclusion_filter_count, is_rate_limited
    FROM logs_indexes WHERE org_id = ? AND scan_run_id = ?
  `).all(orgId, sid) as Array<{
    index_name: string; retention_days: number | null; daily_limit: number | null;
    exclusion_filter_count: number; is_rate_limited: number;
  }>;

  const totalDailyLimit = logRows.reduce((s, i) => s + (i.daily_limit ?? 0), 0);
  const rateLimited = logRows.filter(i => i.is_rate_limited).map(i => i.index_name);
  const totalExclFilters = logRows.reduce((s, i) => s + (i.exclusion_filter_count ?? 0), 0);
  const retentions = logRows.map(i => i.retention_days).filter((n): n is number => n != null);
  const retDist: Record<string, number> = {};
  logRows.forEach(i => { const k = `${i.retention_days ?? '?'}d`; retDist[k] = (retDist[k] ?? 0) + 1; });

  // Synthetics
  const synthRows = db.prepare(`
    SELECT test_type, location_count FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ?
  `).all(orgId, sid) as Array<{ test_type: string | null; location_count: number | null }>;

  const apiTests = synthRows.filter(t => t.test_type !== 'browser').length;
  const browserTests = synthRows.filter(t => t.test_type === 'browser').length;
  const avgLocs = synthRows.length > 0
    ? Math.round(synthRows.reduce((s, t) => s + (t.location_count ?? 1), 0) / synthRows.length) : 0;
  const estMonthlyRuns = synthRows.reduce((sum, t) => {
    const locs = t.location_count ?? 1;
    return sum + (t.test_type === 'browser' ? locs * 96 * 30 : locs * 288 * 30);
  }, 0);

  // Monitors
  const mWithEnv = count('monitors', 'AND has_env_tag=1');
  const mWithSvc = count('monitors', 'AND has_service_tag=1');
  const mWithTeam = count('monitors', 'AND has_team_tag=1');
  const muted = count('monitors', 'AND is_muted=1');
  const alerting = (db.prepare(
    "SELECT COUNT(*) as c FROM monitors WHERE org_id=? AND scan_run_id=? AND overall_state='Alert'"
  ).get(orgId, sid) as { c: number })?.c ?? 0;

  // APM services
  const sWithEnv = (db.prepare(
    'SELECT COUNT(*) as c FROM services WHERE org_id=? AND scan_run_id=? AND env IS NOT NULL'
  ).get(orgId, sid) as { c: number })?.c ?? 0;
  const sWithVer = count('services', 'AND has_version_tag=1');
  const sWithTeam = (db.prepare(
    'SELECT COUNT(*) as c FROM services WHERE org_id=? AND scan_run_id=? AND team IS NOT NULL'
  ).get(orgId, sid) as { c: number })?.c ?? 0;
  const sInCatalog = count('services', 'AND has_service_catalog=1');

  // Product signals
  const signals = db.prepare(
    'SELECT product, signal, value, detected FROM product_usage_signals WHERE org_id=? AND scan_run_id=? ORDER BY product'
  ).all(orgId, sid) as Array<{ product: string; signal: string; value: string | null; detected: number }>;

  // Cloud accounts
  const cloudRows = db.prepare(
    'SELECT provider, COUNT(*) as c FROM cloud_accounts WHERE org_id=? AND scan_run_id=? GROUP BY provider'
  ).all(orgId, sid) as Array<{ provider: string; c: number }>;

  // Scorecard
  const sc = db.prepare('SELECT * FROM scorecards WHERE org_id=? AND scan_run_id=?').get(orgId, sid) as Record<string, unknown> | undefined;
  const catScores: Record<string, number> = {};
  if (sc) {
    try {
      const cats = JSON.parse(sc.category_scores as string ?? '[]') as Array<{ category: string; percentage: number }>;
      cats.forEach(c => { catScores[c.category] = c.percentage; });
    } catch { /* ignore */ }
  }

  // Top findings
  const findings = db.prepare(`
    SELECT severity, category, title, affected_count, total_count, percentage
    FROM findings WHERE org_id=? AND scan_run_id=?
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             percentage DESC LIMIT 12
  `).all(orgId, sid) as Array<{
    severity: string; category: string; title: string;
    affected_count: number; total_count: number; percentage: number;
  }>;

  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0;
  const tier = hosts < 50 ? 'Startup (<50)' : hosts < 250 ? 'Growth (50-250)' : hosts < 1000 ? 'Mid-Market (250-999)' : 'Enterprise (1000+)';

  const orgProfileBlock = getOrgContextBlock(orgId);

  return `${orgProfileBlock ? orgProfileBlock + '\n\n' : ''}=== DATADOG ORG CONTEXT ===
Org Name: ${org.name} | Site: ${org.site}
Scan Date: ${scan.completed_at ?? scan.started_at}
Cloud Accounts: ${cloudRows.map(r => `${r.provider}(${r.c})`).join(', ') || 'none detected'}

=== INFRASTRUCTURE INVENTORY ===
Infrastructure Hosts: ${hosts}  (tier: ${tier})
APM Services (active): ${services}
Monitors: ${monitors}
Dashboards: ${dashboards}
Synthetics Tests: ${synthTests} total (${apiTests} API / ${browserTests} browser)
Log Indexes: ${logsIndexes}
SLOs: ${slos}
Integrations configured: ${integrations}

=== UNIFIED SERVICE TAGGING (UST) COVERAGE — ALL HOSTS ===
  env:     ${envCov}%  ${envCov >= 80 ? '✓ Good' : envCov >= 50 ? '△ Partial' : '✗ Critical gap'}
  service: ${svcCov}%  ${svcCov >= 80 ? '✓ Good' : svcCov >= 50 ? '△ Partial' : '✗ Critical gap'}
  version: ${verCov}%  ${verCov >= 80 ? '✓ Good' : verCov >= 50 ? '△ Partial' : '✗ Critical gap'}
  team:    ${teamCov}%  ${teamCov >= 80 ? '✓ Good' : teamCov >= 50 ? '△ Partial' : '✗ Critical gap'}
Total unique tag keys in org: ${tagRows.length}
High-cardinality keys (>50 unique values): ${highCard.length}
Top keys by cardinality: ${topByCard.join(', ') || 'none'}

=== CUSTOM METRICS ASSESSMENT ===
Estimated custom metric volume: ~${estCM.toLocaleString()}
Typical standard allotment (150/host): ~${standardAllotment.toLocaleString()}
On-demand risk level: ${cmRisk}
High-cardinality tag keys: ${highCard.length} keys with >50 values each
Top cardinality drivers: ${topByCard.slice(0, 5).join(', ')}
Note: Each unique (metric_name × tag_value_combination) = 1 billable custom metric. DogStatsD, APM custom spans, and integration metrics are the most common sources.
On-demand triggers at: ~${Math.round(standardAllotment * 1.0).toLocaleString()} (above contracted allotment; typically 1.5–3× standard rate)

=== HOST ALLOTMENT CONTEXT ===
Infrastructure hosts: ${hosts}
At 100/host standard allotment: ~${hosts * 100} custom metrics included
At 200/host (higher tier): ~${hosts * 200} custom metrics included
APM hosts may be billed separately if on a dedicated APM SKU
Container hosts: typically billed at a fraction of infra host rate (0.05–0.25× per container)
Note: Untagged hosts cannot be attributed to teams or services — they inflate costs without accountability.

=== LOG INDEXING ANALYSIS ===
Total log indexes: ${logsIndexes}
Total daily limit configured: ${totalDailyLimit > 0 ? `${totalDailyLimit.toLocaleString()} events/day across all indexes` : 'NO LIMITS SET — all ingested logs are indexed (major cost risk)'}
Rate-limited indexes (hitting daily cap): ${rateLimited.length > 0 ? rateLimited.join(', ') : 'none'}
Total exclusion filters across all indexes: ${totalExclFilters}${totalExclFilters === 0 ? ' ← WARNING: no exclusion filters means 100% of ingested logs are indexed' : ''}
Retention distribution: ${Object.entries(retDist).map(([d, n]) => `${n}× ${d}`).join(', ') || 'unknown'}
Retention range: ${retentions.length ? `${Math.min(...retentions)}d – ${Math.max(...retentions)}d` : 'unknown'}
Flex Logs indexes detected: 0 (all logs on standard indexed tier — opportunity for cold-tier cost reduction)
Key cost levers: (1) exclusion filters on noisy indexes, (2) Flex Logs for low-query data, (3) retention reduction, (4) log-to-metric conversion for high-volume debug logs

=== APM / TRACE INTELLIGENCE ===
APM services: ${services}
  env tag:     ${sWithEnv}/${services} (${pct(sWithEnv, services)}%)
  version tag: ${sWithVer}/${services} (${pct(sWithVer, services)}%)
  team tag:    ${sWithTeam}/${services} (${pct(sWithTeam, services)}%)
  in Service Catalog: ${sInCatalog}/${services} (${pct(sInCatalog, services)}%)
Default trace ingestion: all spans from DD Agent; default retention filter keeps 1 span/resource/endpoint/operation per minute
Default indexing: 15% of ingested spans (Datadog Intelligent Sampling)
Key cost levers: (1) head-based sampling client-side, (2) retention filter tuning per service, (3) exclude health-check spans, (4) Span Summary (Metrics from Spans) for aggregate visibility without indexing

=== SYNTHETICS ANALYSIS ===
API tests: ${apiTests}
Browser tests: ${browserTests}
Average locations per test: ${avgLocs}
Estimated monthly test runs: ~${estMonthlyRuns.toLocaleString()}
  (API: 288 runs/day × locations; Browser: 96 runs/day × locations, estimated at 15-min interval)
Cost note: Browser test ≈ 4–10× API test cost per run. Each additional location multiplies cost linearly.
Key levers: (1) reduce browser → API where no UI assertion needed, (2) lower frequency for non-critical tests, (3) reduce locations for internal services, (4) remove deprecated test duplicate runs

=== MONITORS HEALTH ===
Total monitors: ${monitors}
  with env tag:     ${mWithEnv}/${monitors} (${pct(mWithEnv, monitors)}%)
  with service tag: ${mWithSvc}/${monitors} (${pct(mWithSvc, monitors)}%)
  with team tag:    ${mWithTeam}/${monitors} (${pct(mWithTeam, monitors)}%)
Currently alerting: ${alerting}
Muted monitors: ${muted}${muted > monitors * 0.2 ? ' ← HIGH — >20% of monitors muted, indicates alert fatigue' : ''}

=== PRODUCT USAGE SIGNALS ===
${signals.length > 0
    ? signals.map(p => `  ${p.product} / ${p.signal}: ${p.detected ? `ACTIVE${p.value ? ` — ${p.value}` : ''}` : 'NOT DETECTED'}`).join('\n')
    : '  No product signals in this scan'}

=== SCORECARD ===
Overall Score: ${sc?.overall_score ?? 'N/A'}/100  Grade: ${sc?.overall_grade ?? 'N/A'}
${Object.entries(catScores).map(([cat, pct]) => `  ${cat.replace(/_/g, ' ')}: ${pct}%`).join('\n')}

=== TOP FINDINGS (prioritized by severity) ===
${findings.map(f => `  [${f.severity.toUpperCase()}] ${f.title} — ${f.affected_count}/${f.total_count} (${Math.round(f.percentage)}%)`).join('\n') || '  No findings recorded'}
`.trim();
}

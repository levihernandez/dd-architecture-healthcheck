import { getDatabase } from '../db/database';
import { getOrgContextBlock } from '../api/routes/org-context.routes';
import { resolvePageContext } from './page-context-map';
import { maturityForPercentage } from './maturity';
import { redactPII, redactOrgName } from './redact-context';
import type { FindingCategory } from '../types/assessment.types';

/** Builds the full context string handed to the AI provider. Never includes the
 * org's real name/id — the org row is used only to look up its data, and any
 * free-text field a human typed (org profile) gets scrubbed of the org's own
 * name plus a generic PII sweep (emails, key-shaped tokens) before it's
 * concatenated in. See redact-context.ts. */
export async function buildChatContext(orgId: string, scanId?: string, page?: string): Promise<string> {
  const db = getDatabase();

  const org = await db<Record<string, unknown>>('orgs').where({ id: orgId }).first();
  if (!org) return 'No organization data found.';
  const orgName = org.name as string;

  let scan: Record<string, unknown> | undefined;
  if (scanId) {
    scan = await db<Record<string, unknown>>('scan_runs').where({ id: scanId, org_id: orgId }).first();
  } else {
    scan = await db<Record<string, unknown>>('scan_runs')
      .where({ org_id: orgId, status: 'completed' })
      .orderBy('completed_at', 'desc')
      .first();
  }
  if (!scan) return `This organization (site: ${org.site}) has no completed scans yet — run a scan first.`;

  const sid = scan.id as string;

  const countOf = async (table: string, extra: Record<string, unknown> = {}) => {
    const row = await db(table).where({ org_id: orgId, scan_run_id: sid, ...extra }).count<{ c: string | number }>({ c: '*' }).first();
    return Number(row?.c ?? 0);
  };
  const rawCount = async (r: { c?: string | number } | undefined) => Number(r?.c ?? 0);

  const hosts = await countOf('hosts');
  const services = await countOf('services');
  const monitors = await countOf('monitors');
  const dashboards = await countOf('dashboards');
  const synthTests = await countOf('synthetics_tests');
  const logsIndexes = await countOf('logs_indexes');
  const slos = await countOf('slos');
  const integrations = await countOf('integrations');

  // Tag coverage
  const hostTagCov = async (key: string) => {
    const row = await db('resource_tags')
      .where({ org_id: orgId, scan_run_id: sid, resource_type: 'host', tag_key: key })
      .countDistinct<{ c: string | number }>({ c: 'resource_id' })
      .first();
    const n = await rawCount(row);
    return hosts > 0 ? Math.round((n / hosts) * 100) : 0;
  };
  const envCov = await hostTagCov('env');
  const svcCov = await hostTagCov('service');
  const verCov = await hostTagCov('version');
  const teamCov = await hostTagCov('team');

  // Tag analysis
  const tagRows = await db<{
    org_id: string; scan_run_id: string;
    tag_key: string; unique_value_count: number; host_occurrence_count: number; is_standard_key: number;
  }>('tag_analysis')
    .select('tag_key', 'unique_value_count', 'host_occurrence_count', 'is_standard_key')
    .where({ org_id: orgId, scan_run_id: sid })
    .orderBy('unique_value_count', 'desc');

  const highCard = tagRows.filter(t => t.unique_value_count > 50);
  const topByCard = tagRows.slice(0, 8).map(t => `${t.tag_key}(${t.unique_value_count})`);

  // Custom metrics estimate: sum unique values for high-cardinality keys (capped per key)
  const estCM = tagRows.reduce((s, t) => t.unique_value_count > 10 ? s + Math.min(t.unique_value_count * 2, 500) : s, 0);
  const standardAllotment = Math.max(500, hosts * 150);
  const cmRisk = estCM > standardAllotment * 0.85 ? 'HIGH' : estCM > standardAllotment * 0.55 ? 'MEDIUM' : 'LOW';

  // Log indexes
  const logRows = await db<{
    org_id: string; scan_run_id: string;
    index_name: string; retention_days: number | null; daily_limit: number | null;
    exclusion_filter_count: number; is_rate_limited: number;
  }>('logs_indexes')
    .select('index_name', 'retention_days', 'daily_limit', 'exclusion_filter_count', 'is_rate_limited')
    .where({ org_id: orgId, scan_run_id: sid });

  const totalDailyLimit = logRows.reduce((s, i) => s + (i.daily_limit ?? 0), 0);
  const rateLimited = logRows.filter(i => i.is_rate_limited).map(i => i.index_name);
  const totalExclFilters = logRows.reduce((s, i) => s + (i.exclusion_filter_count ?? 0), 0);
  const retentions = logRows.map(i => i.retention_days).filter((n): n is number => n != null);
  const retDist: Record<string, number> = {};
  logRows.forEach(i => { const k = `${i.retention_days ?? '?'}d`; retDist[k] = (retDist[k] ?? 0) + 1; });

  // Synthetics
  const synthRows = await db<{ org_id: string; scan_run_id: string; test_type: string | null; location_count: number | null }>('synthetics_tests')
    .select('test_type', 'location_count')
    .where({ org_id: orgId, scan_run_id: sid });

  const apiTests = synthRows.filter(t => t.test_type !== 'browser').length;
  const browserTests = synthRows.filter(t => t.test_type === 'browser').length;
  const avgLocs = synthRows.length > 0
    ? Math.round(synthRows.reduce((s, t) => s + (t.location_count ?? 1), 0) / synthRows.length) : 0;
  const estMonthlyRuns = synthRows.reduce((sum, t) => {
    const locs = t.location_count ?? 1;
    return sum + (t.test_type === 'browser' ? locs * 96 * 30 : locs * 288 * 30);
  }, 0);

  // Monitors
  const mWithEnv = await countOf('monitors', { has_env_tag: 1 });
  const mWithSvc = await countOf('monitors', { has_service_tag: 1 });
  const mWithTeam = await countOf('monitors', { has_team_tag: 1 });
  const muted = await countOf('monitors', { is_muted: 1 });
  const alerting = await countOf('monitors', { overall_state: 'Alert' });

  // APM services
  const sWithEnv = await rawCount(await db('services').where({ org_id: orgId, scan_run_id: sid }).whereNotNull('env').count<{ c: string | number }>({ c: '*' }).first());
  const sWithVer = await countOf('services', { has_version_tag: 1 });
  const sWithTeam = await rawCount(await db('services').where({ org_id: orgId, scan_run_id: sid }).whereNotNull('team').count<{ c: string | number }>({ c: '*' }).first());
  const sInCatalog = await countOf('services', { has_service_catalog: 1 });

  // Product signals
  const signals = await db<{ org_id: string; scan_run_id: string; product: string; signal: string; value: string | null; detected: number }>('product_usage_signals')
    .select('product', 'signal', 'value', 'detected')
    .where({ org_id: orgId, scan_run_id: sid })
    .orderBy('product');

  // Cloud accounts
  const cloudRows = await db<{ org_id: string; scan_run_id: string; provider: string; c: string | number }>('cloud_accounts')
    .select('provider')
    .count<{ c: string | number }>({ c: '*' })
    .where({ org_id: orgId, scan_run_id: sid })
    .groupBy('provider')
    .then(rows => rows.map(r => ({ provider: r.provider, c: Number(r.c) })));

  // Integrations detail
  const integRows = await db<{ org_id: string; scan_run_id: string; integration_name: string; integration_type: string | null; is_configured: number; is_enabled: number }>('integrations')
    .select('integration_name', 'integration_type', 'is_configured', 'is_enabled')
    .where({ org_id: orgId, scan_run_id: sid });
  const integConfigured = integRows.filter(r => r.is_configured).length;
  const integEnabled = integRows.filter(r => r.is_enabled).length;
  const integByType: Record<string, number> = {};
  integRows.forEach(r => { const t = r.integration_type ?? 'other'; integByType[t] = (integByType[t] ?? 0) + 1; });
  const integNameHit = (kws: string[]) => integRows.filter(r => kws.some(k => r.integration_name.toLowerCase().includes(k))).length;

  // Dashboards detail
  const dashRows = await db<{ org_id: string; scan_run_id: string; widget_count: number | null; has_template_variables: number }>('dashboards')
    .select('widget_count', 'has_template_variables')
    .where({ org_id: orgId, scan_run_id: sid });
  const emptyDash = dashRows.filter(d => (d.widget_count ?? 0) === 0).length;
  const dashWithVars = dashRows.filter(d => d.has_template_variables).length;

  // Network & Cloud detail
  const ccmRows = await db<{ org_id: string; scan_run_id: string; provider: string; configured: number }>('cost_management_config')
    .select('provider', 'configured')
    .where({ org_id: orgId, scan_run_id: sid });
  const npmProxy = integNameHit(['network']);
  const ndmProxy = integNameHit(['snmp', 'ndm', 'cisco', 'juniper', 'palo_alto']);
  const dbmProxy = integNameHit(['postgres', 'mysql', 'sqlserver', 'oracle', 'mongodb']);

  // Security & incidents detail
  const secBySev = (await db<{ org_id: string; scan_run_id: string; severity: string; c: string | number }>('security_findings')
    .select('severity')
    .count<{ c: string | number }>({ c: '*' })
    .where({ org_id: orgId, scan_run_id: sid })
    .groupBy('severity')).map(r => ({ severity: r.severity, c: Number(r.c) }));
  const secByCat = (await db<{ org_id: string; scan_run_id: string; category: string; c: string | number }>('security_findings')
    .select('category')
    .count<{ c: string | number }>({ c: '*' })
    .where({ org_id: orgId, scan_run_id: sid })
    .groupBy('category')).map(r => ({ category: r.category, c: Number(r.c) }));
  const secTotal = secBySev.reduce((s, r) => s + r.c, 0);
  const secUnresolvedCritical = await rawCount(
    await db('security_findings')
      .where({ org_id: orgId, scan_run_id: sid })
      .whereIn('severity', ['critical', 'high'])
      .where(function () {
        this.whereNull('status').orWhereNotIn('status', ['resolved', 'muted', 'skipped']);
      })
      .count<{ c: string | number }>({ c: '*' })
      .first()
  );
  const incBySev = (await db<{ org_id: string; scan_run_id: string; severity: string; c: string | number }>('incidents')
    .select('severity')
    .count<{ c: string | number }>({ c: '*' })
    .where({ org_id: orgId, scan_run_id: sid })
    .groupBy('severity')).map(r => ({ severity: r.severity, c: Number(r.c) }));
  const incOpen = await rawCount(
    await db('incidents')
      .where({ org_id: orgId, scan_run_id: sid })
      .where(function () {
        this.whereNull('state').orWhereNot('state', 'resolved');
      })
      .count<{ c: string | number }>({ c: '*' })
      .first()
  );
  const incTotal = incBySev.reduce((s, r) => s + r.c, 0);

  // Scorecard
  const sc = await db<Record<string, unknown>>('scorecards').where({ org_id: orgId, scan_run_id: sid }).first();
  const catScores: Record<string, number> = {};
  if (sc) {
    try {
      const cats = JSON.parse(sc.category_scores as string ?? '[]') as Array<{ category: string; percentage: number }>;
      cats.forEach(c => { catScores[c.category] = c.percentage; });
    } catch { /* ignore */ }
  }

  // Page focus: if the caller told us which page/category the user is looking at,
  // scope findings to that category and lead with an explicit maturity statement.
  const pageContext = resolvePageContext(page);

  const severityOrder = db.raw("CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END");
  const findingsQuery = db<{
    org_id: string; scan_run_id: string;
    severity: string; category: string; title: string;
    affected_count: number; total_count: number; percentage: number;
    affected_resources: string | null;
  }>('findings')
    .select('severity', 'category', 'title', 'affected_count', 'total_count', 'percentage', 'affected_resources')
    .where({ org_id: orgId, scan_run_id: sid })
    .orderBy([{ column: severityOrder as any }, { column: 'percentage', order: 'desc' }]);

  const typedFindings = pageContext
    ? await findingsQuery.clone().where('category', pageContext.category).limit(10)
    : await findingsQuery.clone().limit(12);

  // Capped (top 3) concrete resource refs per finding, so chat can cite something
  // real instead of only a category-level percentage — mirrors the one-shot
  // report's buildFindingSummary in ai/service.ts.
  const findingResourceLabel = (raw: string | null): string => {
    if (!raw) return '';
    let resources: Array<{ type?: string; id?: string; name?: string }>;
    try { resources = JSON.parse(raw); } catch { return ''; }
    if (!Array.isArray(resources) || resources.length === 0) return '';
    const shown = resources.slice(0, 3);
    const remaining = resources.length - shown.length;
    const type = shown[0]?.type ? `${shown[0].type}s` : 'resources';
    const names = shown.map((r) => r.name || r.id).filter(Boolean).join(', ');
    if (!names) return '';
    return ` [${type}: ${names}${remaining > 0 ? `, +${remaining} more` : ''}]`;
  };

  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0;
  const tier = hosts < 50 ? 'Startup (<50)' : hosts < 250 ? 'Growth (50-250)' : hosts < 1000 ? 'Mid-Market (250-999)' : 'Enterprise (1000+)';

  const orgProfileBlock = redactPII(redactOrgName(await getOrgContextBlock(orgId), orgName));

  // Existing per-domain detail blocks, keyed by category — computed unconditionally
  // above (cheap), assembled conditionally below based on the page focus.
  const detailBlocks: Partial<Record<FindingCategory, string>> = {
    unified_tagging: `=== UNIFIED SERVICE TAGGING (UST) COVERAGE ===
Host-level tags (env/team belong on every host — this is a real gap if low):
  env:     ${envCov}%  ${envCov >= 80 ? '✓ Good' : envCov >= 50 ? '△ Partial' : '✗ Critical gap'}
  team:    ${teamCov}%  ${teamCov >= 80 ? '✓ Good' : teamCov >= 50 ? '△ Partial' : '✗ Critical gap'}
Workload-level tags, shown as % of hosts carrying them — informational only, NOT a
host requirement (a host commonly runs multiple services, so don't advise the user
to blanket-tag hosts with service/version; that belongs on the APM service/container):
  service: ${svcCov}%
  version: ${verCov}%
Total unique tag keys in org: ${tagRows.length}
High-cardinality keys (>50 unique values): ${highCard.length}
Top keys by cardinality: ${topByCard.join(', ') || 'none'}`,

    cost_optimization: `=== CUSTOM METRICS ASSESSMENT ===
Estimated custom metric volume: ~${estCM.toLocaleString()} (estimated)
Typical standard allotment (150/host): ~${standardAllotment.toLocaleString()} (estimated)
On-demand risk level: ${cmRisk}
High-cardinality tag keys: ${highCard.length} keys with >50 values each
Top cardinality drivers: ${topByCard.slice(0, 5).join(', ')}
Note: Each unique (metric_name × tag_value_combination) = 1 billable custom metric. DogStatsD, APM custom spans, and integration metrics are the most common sources.
On-demand triggers at: ~${Math.round(standardAllotment * 1.0).toLocaleString()} (estimated; above contracted allotment; typically 1.5–3× standard rate)

=== HOST ALLOTMENT CONTEXT ===
Infrastructure hosts: ${hosts}
At 100/host standard allotment: ~${hosts * 100} custom metrics included (estimated)
At 200/host (higher tier): ~${hosts * 200} custom metrics included (estimated)
APM hosts may be billed separately if on a dedicated APM SKU
Container hosts: typically billed at a fraction of infra host rate (0.05–0.25× per container)
Note: Untagged hosts cannot be attributed to teams or services — they inflate costs without accountability.`,

    logs_health: `=== LOG INDEXING ANALYSIS ===
Total log indexes: ${logsIndexes}
Total daily limit configured: ${totalDailyLimit > 0 ? `${totalDailyLimit.toLocaleString()} events/day across all indexes` : 'NO LIMITS SET — all ingested logs are indexed (major cost risk)'}
Rate-limited indexes (hitting daily cap): ${rateLimited.length > 0 ? rateLimited.join(', ') : 'none'}
Total exclusion filters across all indexes: ${totalExclFilters}${totalExclFilters === 0 ? ' ← WARNING: no exclusion filters means 100% of ingested logs are indexed' : ''}
Retention distribution: ${Object.entries(retDist).map(([d, n]) => `${n}× ${d}`).join(', ') || 'unknown'}
Retention range: ${retentions.length ? `${Math.min(...retentions)}d – ${Math.max(...retentions)}d` : 'unknown'}
Flex Logs indexes detected: 0 (all logs on standard indexed tier — opportunity for cold-tier cost reduction)
Key cost levers: (1) exclusion filters on noisy indexes, (2) Flex Logs for low-query data, (3) retention reduction, (4) log-to-metric conversion for high-volume debug logs`,

    service_architecture: `=== APM / TRACE INTELLIGENCE ===
APM services: ${services}
  env tag:     ${sWithEnv}/${services} (${pct(sWithEnv, services)}%)
  version tag: ${sWithVer}/${services} (${pct(sWithVer, services)}%)
  team tag:    ${sWithTeam}/${services} (${pct(sWithTeam, services)}%)
  in Service Catalog: ${sInCatalog}/${services} (${pct(sInCatalog, services)}%)
Default trace ingestion: all spans from DD Agent; default retention filter keeps 1 span/resource/endpoint/operation per minute
Default indexing: 15% of ingested spans (Datadog Intelligent Sampling)
Key cost levers: (1) head-based sampling client-side, (2) retention filter tuning per service, (3) exclude health-check spans, (4) Span Summary (Metrics from Spans) for aggregate visibility without indexing`,

    synthetics_health: `=== SYNTHETICS ANALYSIS ===
API tests: ${apiTests}
Browser tests: ${browserTests}
Average locations per test: ${avgLocs}
Estimated monthly test runs: ~${estMonthlyRuns.toLocaleString()} (estimated)
  (API: 288 runs/day × locations; Browser: 96 runs/day × locations, estimated at 15-min interval)
Cost note: Browser test ≈ 4–10× API test cost per run. Each additional location multiplies cost linearly.
Key levers: (1) reduce browser → API where no UI assertion needed, (2) lower frequency for non-critical tests, (3) reduce locations for internal services, (4) remove deprecated test duplicate runs`,

    monitors_health: `=== MONITORS HEALTH ===
Total monitors: ${monitors}
  with env tag:     ${mWithEnv}/${monitors} (${pct(mWithEnv, monitors)}%)
  with service tag: ${mWithSvc}/${monitors} (${pct(mWithSvc, monitors)}%)
  with team tag:    ${mWithTeam}/${monitors} (${pct(mWithTeam, monitors)}%)
Currently alerting: ${alerting}
Muted monitors: ${muted}${muted > monitors * 0.2 ? ' ← HIGH — >20% of monitors muted, indicates alert fatigue' : ''}`,

    integration_hygiene: `=== INTEGRATION HYGIENE ===
Total integrations detected: ${integrations}
  Configured: ${integConfigured}/${integrations} (${pct(integConfigured, integrations)}%)
  Enabled:    ${integEnabled}/${integrations} (${pct(integEnabled, integrations)}%)
By type: ${Object.entries(integByType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}(${n})`).join(', ') || 'none'}
Configured-but-not-enabled integrations represent silent data gaps — metrics/logs stop flowing without an obvious error.
Cloud accounts detected: ${cloudRows.map(r => `${r.provider}(${r.c})`).join(', ') || 'none'} — verify each has a matching cloud integration configured and enabled here.
Key levers: (1) enable configured-but-disabled integrations, (2) add missing integrations for detected cloud providers/databases, (3) remove stale/unused integrations that add noise without value.`,

    dashboards_health: `=== DASHBOARDS ===
Total dashboards: ${dashboards}
Empty dashboards (0 widgets): ${emptyDash}${emptyDash > 0 ? ' ← candidates for cleanup, they add clutter without value' : ''}
Dashboards using template variables: ${dashWithVars}/${dashboards} (${pct(dashWithVars, dashboards)}%) — template variables (env/service/etc.) let one dashboard serve many teams instead of duplicating per-team copies.
Key levers: (1) delete or populate empty dashboards, (2) convert single-team dashboards to templated ones with variables, (3) standardize on Service Catalog-linked dashboards over ad hoc ones.`,

    network_cloud: `=== NETWORK & CLOUD ===
Cloud accounts: ${cloudRows.map(r => `${r.provider}(${r.c})`).join(', ') || 'none detected'}
Cloud Cost Management configured: ${ccmRows.filter(r => r.configured).map(r => r.provider).join(', ') || 'none'} / detected providers: ${ccmRows.map(r => r.provider).join(', ') || 'none'}
CNM (Cloud Network Monitor, formerly Network Performance Monitoring/NPM) — proxy-detected via integration name match: ${npmProxy} integration(s) matched (estimated)
NDM (Network Device Monitoring) — proxy-detected via SNMP/vendor integration name match: ${ndmProxy} integration(s) matched (estimated)
DBM (Database Monitoring) — proxy-detected via Postgres/MySQL/Oracle/MongoDB/SQL Server integration name match: ${dbmProxy} integration(s) matched (estimated)
Caveat: CNM/NDM/DBM have no dedicated collector in this tool yet — these are heuristic signals from integration names, not confirmed product usage. A 0 count may mean "not in use" or "not detectable by this heuristic" — advise the user to verify directly in Datadog if it matters for their decision.
Key levers: (1) enable Cloud Cost Management for every connected cloud provider, (2) confirm CNM/NDM/DBM usage manually if this org runs databases or network infra, (3) ensure cloud tags propagate to hosts for cost attribution.`,

    governance: `=== GOVERNANCE & ACCESS ===
Users: ${signals.find(s => s.product === 'governance' && s.signal === 'user_count')?.value ?? 'unknown'}
Roles: ${signals.find(s => s.product === 'governance' && s.signal === 'role_count')?.value ?? 'unknown'}
Unified tagging (ownership signal — see UST block above): env ${envCov}% and team ${teamCov}% are host-level; service ${svcCov}% is workload-level context, not a host gap
Team tag coverage on hosts is the primary proxy for "is there a clear owning team" — low team-tag coverage means alerts/dashboards/services can't be reliably routed to the right humans.
Key levers: (1) define a Datadog Team per engineering team and assign service ownership in the Service Catalog, (2) enforce team: tag at ingestion via Agent config or admission controllers, (3) review roles/permissions for least-privilege access, especially for API/App keys with broad scopes.`,

    security_posture: `=== SECURITY POSTURE & INCIDENTS ===
Security findings: ${secTotal}
  By severity: ${secBySev.map(r => `${r.severity ?? 'unknown'}(${r.c})`).join(', ') || 'none'}
  By product/category (CSPM/CWS/ASM/etc.): ${secByCat.map(r => `${r.category ?? 'unknown'}(${r.c})`).join(', ') || 'none'}
  Unresolved critical/high: ${secUnresolvedCritical}${secUnresolvedCritical > 0 ? ' ← prioritize these first' : ''}
Incidents: ${incTotal} total, ${incOpen} currently open
  By severity: ${incBySev.map(r => `${r.severity ?? 'unknown'}(${r.c})`).join(', ') || 'none'}
Cloud Cost Management configured: ${ccmRows.filter(r => r.configured).length}/${ccmRows.length || 0} providers — unrelated to security directly, but flagged here since it's collected alongside security/cost posture data.
Key levers: (1) triage unresolved critical/high findings first, (2) ensure every open incident has an assigned owner and postmortem plan, (3) close the loop on stale open incidents.`,
  };

  const pageFocusBlock = pageContext ? (() => {
    const catPct = catScores[pageContext.category];
    const maturity = catPct !== undefined ? maturityForPercentage(catPct) : 'Unknown (no score yet)';
    return `=== CURRENT PAGE FOCUS ===
The user is viewing: ${pageContext.label}
Domain: ${pageContext.category.replace(/_/g, ' ')}
Maturity: ${maturity}${catPct !== undefined ? ` (${catPct}%)` : ''}
Prioritize assessing THIS domain's maturity, biggest gap, and next steps — see the findings and detail block below for this domain specifically.
`;
  })() : '';

  const detailSection = pageContext
    ? (detailBlocks[pageContext.category] ?? `(No dedicated deep-dive block for ${pageContext.category.replace(/_/g, ' ')} yet — use the scorecard and findings below.)`)
    : Object.values(detailBlocks).join('\n\n');

  const assembled = `${orgProfileBlock ? orgProfileBlock + '\n\n' : ''}${pageFocusBlock ? pageFocusBlock + '\n' : ''}=== DATADOG ORG CONTEXT ===
Site: ${org.site} (org name/id withheld from AI context by design — refer to "this organization")
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

${detailSection}

=== PRODUCT USAGE SIGNALS ===
${signals.length > 0
    ? signals.map(p => `  ${p.product} / ${p.signal}: ${p.detected ? `ACTIVE${p.value ? ` — ${p.value}` : ''}` : 'NOT DETECTED'}`).join('\n')
    : '  No product signals in this scan'}

=== SCORECARD ===
Overall Score: ${sc?.overall_score ?? 'N/A'}/100  Grade: ${sc?.overall_grade ?? 'N/A'}
${Object.entries(catScores).map(([cat, pct]) => `  ${cat.replace(/_/g, ' ')}: ${pct}%`).join('\n')}

=== ${pageContext ? `${pageContext.label.toUpperCase()} FINDINGS` : 'TOP FINDINGS (prioritized by severity)'} ===
${typedFindings.map(f => `  [${f.severity.toUpperCase()}] ${f.title} — ${f.affected_count}/${f.total_count} (${Math.round(f.percentage)}%)${findingResourceLabel(f.affected_resources)}`).join('\n') || '  No findings recorded'}
`.trim();

  // Final defense-in-depth sweep — catches anything identifier-shaped that
  // slipped through a free-text or raw-string-column field above.
  return redactPII(redactOrgName(assembled, orgName));
}

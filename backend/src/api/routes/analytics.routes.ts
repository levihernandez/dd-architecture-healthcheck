import { Router } from 'express';
import { getDatabase } from '../../db/database';
import { AppError } from '../middleware/error.middleware';
import { parseUsageSummary, parseCostJson, buildProductBreakdown } from '../../assessment/cost-data';
import {
  domainCost, PRICING_ESTIMATES,
  infrastructureRecommendations, customMetricsRecommendations, logsRecommendations,
  syntheticsRecommendations, apmRecommendations, integrationsRecommendations,
  monitorsRecommendations, sloRecommendations, governanceRecommendations,
  rumRecommendations, fleetRecommendations, securityRecommendations, proxyRecommendations,
} from '../../assessment/analytics-insights';

const router = Router();

// GET /api/analytics?orgId=&scanRunId=
router.get('/', (req, res, next) => {
  try {
    const orgId = req.query.orgId as string | undefined;
    const scanRunId = req.query.scanRunId as string | undefined;
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const c = (table: string, where = '') =>
      (db.prepare(`SELECT COUNT(*) as n FROM ${table} WHERE org_id=? AND scan_run_id=? ${where}`)
        .get(orgId, scanRunId) as { n: number }).n;

    // Real billing data, when this scan collected it — used to prefer actual cost
    // over list-price estimates per domain below (falls back to null if absent).
    const usageRow = db.prepare(
      'SELECT usage_json, cost_json FROM usage_summary WHERE org_id=? AND scan_run_id=?'
    ).get(orgId, scanRunId) as { usage_json: string; cost_json: string | null } | undefined;
    const { latestUsage } = usageRow ? parseUsageSummary(usageRow.usage_json) : { latestUsage: {} };
    const costCharges = usageRow ? parseCostJson(usageRow.cost_json) : [];
    const products = buildProductBreakdown(latestUsage, costCharges);

    // ── Infrastructure ─────────────────────────────────────────────────────────
    const totalHosts = c('hosts');
    const hostsWithEnv = c('hosts', 'AND has_env_tag=1');
    const hostsWithService = c('hosts', 'AND has_service_tag=1');
    const hostsWithVersion = c('hosts', 'AND has_version_tag=1');
    const hostsWithTeam = c('hosts', 'AND has_team_tag=1');

    // Custom metrics estimate from tag cardinality
    const tagRows = db.prepare(
      'SELECT tag_key, unique_value_count FROM tag_analysis WHERE org_id=? AND scan_run_id=? ORDER BY unique_value_count DESC'
    ).all(orgId, scanRunId) as Array<{ tag_key: string; unique_value_count: number }>;

    const estCM = tagRows.reduce((s, t) => t.unique_value_count > 10 ? s + Math.min(t.unique_value_count * 2, 500) : s, 0);
    const allotment100 = Math.max(500, totalHosts * 100);
    const allotment200 = Math.max(1000, totalHosts * 200);
    const cmPct100 = allotment100 > 0 ? Math.round((estCM / allotment100) * 100) : 0;
    const cmRisk = cmPct100 > 90 ? 'high' : cmPct100 > 60 ? 'medium' : 'low';

    // Cloud accounts
    const cloudRows = db.prepare(
      'SELECT provider, COUNT(*) as n FROM cloud_accounts WHERE org_id=? AND scan_run_id=? GROUP BY provider'
    ).all(orgId, scanRunId) as Array<{ provider: string; n: number }>;

    // Container estimate from product signals
    const containerSignal = db.prepare(
      "SELECT value FROM product_usage_signals WHERE org_id=? AND scan_run_id=? AND product='containers' AND signal='total_containers'"
    ).get(orgId, scanRunId) as { value: string } | undefined;

    const hostTier = totalHosts === 0 ? 'None'
      : totalHosts < 50 ? 'Startup (<50)'
      : totalHosts < 250 ? 'Growth (50–249)'
      : totalHosts < 1000 ? 'Mid-Market (250–999)'
      : 'Enterprise (1000+)';

    // ── Logs ───────────────────────────────────────────────────────────────────
    const logRows = db.prepare(`
      SELECT index_name, retention_days, daily_limit, exclusion_filter_count,
             is_rate_limited, filter_query, raw_json
      FROM logs_indexes WHERE org_id=? AND scan_run_id=?
      ORDER BY retention_days DESC NULLS LAST
    `).all(orgId, scanRunId) as Array<{
      index_name: string; retention_days: number | null; daily_limit: number | null;
      exclusion_filter_count: number; is_rate_limited: number;
      filter_query: string | null; raw_json: string | null;
    }>;

    const retentionDist: Record<string, number> = {};
    let totalDailyLimit = 0;
    let totalExclusionFilters = 0;
    let rateLimitedCount = 0;
    const indexDetails = logRows.map(r => {
      const rd = `${r.retention_days ?? '?'}d`;
      retentionDist[rd] = (retentionDist[rd] ?? 0) + 1;
      totalDailyLimit += r.daily_limit ?? 0;
      totalExclusionFilters += r.exclusion_filter_count ?? 0;
      if (r.is_rate_limited) rateLimitedCount++;

      // Try to detect flex/archive from raw_json
      let isFlex = false;
      let isOnline = true;
      try {
        const rj = r.raw_json ? JSON.parse(r.raw_json) : null;
        isFlex = rj?.type === 'flex' || rj?.rehydration_max_scan_size_in_gb != null;
        isOnline = rj?.type !== 'flex';
      } catch { /* ignore */ }

      return {
        name: r.index_name,
        retentionDays: r.retention_days,
        dailyLimitEvents: r.daily_limit,
        exclusionFilters: r.exclusion_filter_count,
        isRateLimited: Boolean(r.is_rate_limited),
        filterQuery: r.filter_query,
        isFlex,
        isOnline,
      };
    });

    const pipelines = c('logs_pipelines');
    const enabledPipelines = c('logs_pipelines', 'AND is_enabled=1');

    // Archives: check raw_json of log indexes for archive-type fields
    // (Datadog doesn't expose archives in the same endpoint, but note it for future)
    const archiveSuggestions = indexDetails.filter(i => i.isFlex).length;

    // ── Integrations ────────────────────────────────────────────────────────────
    // integration_type='agent_check' rows (postgres, nginx, trace, etc.) come from
    // infrastructure.collector.ts matching Agent-reported host checks against the
    // full Datadog Integrations catalog (app.datadoghq.com/integrations) — raw_json
    // carries the host_count, which is the actual evidence a check is receiving
    // data rather than just configured. Account/notification integrations (aws,
    // slack, pagerduty, etc.) have no per-host signal, so hostCount is null there.
    const integRows = db.prepare(`
      SELECT integration_name, integration_type, status, is_configured, is_enabled, raw_json
      FROM integrations WHERE org_id=? AND scan_run_id=?
      ORDER BY is_enabled DESC, is_configured DESC, integration_name
    `).all(orgId, scanRunId) as Array<{
      integration_name: string; integration_type: string | null;
      status: string | null; is_configured: number; is_enabled: number; raw_json: string | null;
    }>;

    const integHostCount = (raw: string | null): number | null => {
      if (!raw) return null;
      try { return (JSON.parse(raw) as { host_count?: number }).host_count ?? null; } catch { return null; }
    };

    const integByType: Record<string, number> = {};
    for (const r of integRows) {
      const t = r.integration_type ?? 'other';
      integByType[t] = (integByType[t] ?? 0) + 1;
    }

    // Four mutually-exclusive status buckets (sum to integRows.length):
    // installed = actively enabled/receiving data; broken = the probe itself hit
    // an error or permission problem; idle = configured but not enabled, with no
    // error — a silent gap rather than a technical failure; notInstalled = nothing
    // configured at all. "status" here is this app's own probe outcome string
    // (see integrations.collector.ts), not a field Datadog's API returns directly.
    const ERROR_STATUSES = new Set(['error', 'permission_denied']);
    const integInstalled = integRows.filter(r => r.is_enabled).length;
    const integBroken = integRows.filter(r => !r.is_enabled && ERROR_STATUSES.has(r.status ?? '')).length;
    const integIdle = integRows.filter(r => !r.is_enabled && r.is_configured && !ERROR_STATUSES.has(r.status ?? '')).length;
    const integNotInstalled = integRows.length - integInstalled - integBroken - integIdle;

    // ── Synthetics ─────────────────────────────────────────────────────────────
    const synthRows = db.prepare(`
      SELECT test_name, test_type, status, location_count, tags
      FROM synthetics_tests WHERE org_id=? AND scan_run_id=?
    `).all(orgId, scanRunId) as Array<{
      test_name: string | null; test_type: string | null;
      status: string | null; location_count: number | null; tags: string | null;
    }>;

    const apiTests = synthRows.filter(t => t.test_type !== 'browser').length;
    const browserTests = synthRows.filter(t => t.test_type === 'browser').length;
    const estimatedMonthlyRuns = synthRows.reduce((sum, t) => {
      const locs = t.location_count ?? 1;
      return sum + (t.test_type === 'browser' ? locs * 96 * 30 : locs * 288 * 30);
    }, 0);

    const synthDetails = synthRows.map(t => ({
      name: t.test_name ?? 'unnamed',
      type: t.test_type ?? 'api',
      status: t.status ?? 'unknown',
      locations: t.location_count ?? 0,
      estimatedMonthlyRuns: (t.location_count ?? 1) * (t.test_type === 'browser' ? 96 * 30 : 288 * 30),
    }));

    // ── APM ─────────────────────────────────────────────────────────────────────
    const totalServices = c('services');
    const svcInCatalog = c('services', 'AND has_service_catalog=1');
    const svcWithMonitor = c('services', 'AND has_monitor=1');
    const svcWithSLO = c('services', 'AND has_slo=1');
    const slos = c('slos');
    const monitors = c('monitors');
    const dashboards = c('dashboards');
    const dashboardsOotb = c('dashboards', 'AND is_read_only=1');
    const dashboardsByAuthor = db.prepare(`
      SELECT COALESCE(author_handle, 'Unknown') as author, COUNT(*) as n
      FROM dashboards WHERE org_id=? AND scan_run_id=? AND is_read_only=0
      GROUP BY author ORDER BY n DESC
    `).all(orgId, scanRunId) as Array<{ author: string; n: number }>;

    // ── RUM ─────────────────────────────────────────────────────────────────────
    const rumApps = db.prepare(`
      SELECT app_id, app_name, app_type, framework, client_token_hint, created_at_dd
      FROM rum_applications WHERE org_id=? AND scan_run_id=?
      ORDER BY created_at_dd ASC
    `).all(orgId, scanRunId) as Array<{
      app_id: string; app_name: string | null; app_type: string | null;
      framework: string | null; client_token_hint: string | null; created_at_dd: string | null;
    }>;

    const rumByType: Record<string, number> = {};
    for (const app of rumApps) {
      const t = app.app_type ?? 'unknown';
      rumByType[t] = (rumByType[t] ?? 0) + 1;
    }

    // ── Fleet ────────────────────────────────────────────────────────────────────
    const fleetSig = (signal: string): Record<string, number> => {
      const row = db.prepare(
        `SELECT value FROM product_usage_signals WHERE org_id=? AND scan_run_id=? AND product='fleet' AND signal=?`
      ).get(orgId, scanRunId, signal) as { value: string } | undefined;
      if (!row?.value) return {};
      try { return JSON.parse(row.value) as Record<string, number>; } catch { return {}; }
    };

    const agentVersions = fleetSig('agent_versions');
    const platforms = fleetSig('platforms');
    const installedChecks = fleetSig('installed_checks');

    const versionBuckets: Record<string, number> = {};
    for (const [ver, cnt] of Object.entries(agentVersions)) {
      const major = ver.split('.')[0] ?? 'unknown';
      const bucket = `${major}.x`;
      versionBuckets[bucket] = (versionBuckets[bucket] ?? 0) + (cnt as number);
    }

    // ── Security findings ───────────────────────────────────────────────────────
    const totalSecurityFindings = c('security_findings');
    const securityBySeverity = db.prepare(
      "SELECT severity, COUNT(*) as n FROM security_findings WHERE org_id=? AND scan_run_id=? GROUP BY severity"
    ).all(orgId, scanRunId) as Array<{ severity: string; n: number }>;
    const securityByCategory = db.prepare(
      "SELECT category, COUNT(*) as n FROM security_findings WHERE org_id=? AND scan_run_id=? GROUP BY category"
    ).all(orgId, scanRunId) as Array<{ category: string; n: number }>;
    const unresolvedCritical = (db.prepare(
      "SELECT COUNT(*) as n FROM security_findings WHERE org_id=? AND scan_run_id=? AND severity IN ('critical','high') AND (status IS NULL OR status NOT IN ('resolved','muted','skipped'))"
    ).get(orgId, scanRunId) as { n: number }).n;

    // ── Product proxy detection (DBM/NPM/NDM have no dedicated collector yet —
    // infer presence from matching integration names, same heuristic as Product Usage) ──
    const integNameHit = (keywords: string[]) =>
      integRows.filter(r => keywords.some(k => r.integration_name.toLowerCase().includes(k))).length;
    const productProxies = {
      npm: integNameHit(['network']),
      ndm: integNameHit(['snmp', 'ndm', 'cisco', 'juniper', 'palo_alto']),
      dbm: integNameHit(['postgres', 'mysql', 'sqlserver', 'oracle', 'mongodb']),
    };

    // ── Incidents ────────────────────────────────────────────────────────────────
    const totalIncidents = c('incidents');
    const openIncidentsCount = c('incidents', "AND (state IS NULL OR state != 'resolved')");
    const incidentsBySeverity = db.prepare(
      "SELECT severity, COUNT(*) as n FROM incidents WHERE org_id=? AND scan_run_id=? GROUP BY severity"
    ).all(orgId, scanRunId) as Array<{ severity: string; n: number }>;

    // ── Cloud Cost Management ───────────────────────────────────────────────────
    const ccmConfig = db.prepare(
      'SELECT provider, configured FROM cost_management_config WHERE org_id=? AND scan_run_id=?'
    ).all(orgId, scanRunId) as Array<{ provider: string; configured: number }>;

    res.json({
      scannedAt: (db.prepare('SELECT completed_at FROM scan_runs WHERE id=?').get(scanRunId) as { completed_at: string | null } | undefined)?.completed_at,
      infrastructure: {
        totalHosts,
        hostTier,
        tagCoverage: {
          env: totalHosts > 0 ? Math.round(hostsWithEnv / totalHosts * 100) : 0,
          service: totalHosts > 0 ? Math.round(hostsWithService / totalHosts * 100) : 0,
          version: totalHosts > 0 ? Math.round(hostsWithVersion / totalHosts * 100) : 0,
          team: totalHosts > 0 ? Math.round(hostsWithTeam / totalHosts * 100) : 0,
        },
        cloudAccounts: cloudRows,
        containers: containerSignal?.value ? parseInt(containerSignal.value) : null,
        cost: domainCost(products, ['agent_host', 'infra_host'], {
          volume: totalHosts, unitPrice: PRICING_ESTIMATES.infraHostMonthly, unit: 'hosts',
        }),
        recommendations: infrastructureRecommendations({
          totalHosts,
          tagCoverage: {
            env: totalHosts > 0 ? Math.round(hostsWithEnv / totalHosts * 100) : 0,
            service: totalHosts > 0 ? Math.round(hostsWithService / totalHosts * 100) : 0,
            version: totalHosts > 0 ? Math.round(hostsWithVersion / totalHosts * 100) : 0,
            team: totalHosts > 0 ? Math.round(hostsWithTeam / totalHosts * 100) : 0,
          },
        }),
      },
      customMetrics: {
        estimated: estCM,
        allotmentAt100PerHost: allotment100,
        allotmentAt200PerHost: allotment200,
        utilizationPct: cmPct100,
        risk: cmRisk,
        topDrivers: tagRows.filter(t => t.unique_value_count > 10).slice(0, 10).map(t => ({
          key: t.tag_key,
          uniqueValues: t.unique_value_count,
          estimatedMetrics: Math.min(t.unique_value_count * 2, 500),
        })),
        cost: domainCost(products, ['custom_ts', 'custom_metric'], {
          volume: Math.ceil(estCM / 100), unitPrice: PRICING_ESTIMATES.customMetricsPer100Monthly, unit: '×100 custom metrics',
        }),
        recommendations: customMetricsRecommendations({
          risk: cmRisk as 'low' | 'medium' | 'high', utilizationPct: cmPct100,
          topDrivers: tagRows.filter(t => t.unique_value_count > 10).slice(0, 10).map(t => ({ key: t.tag_key, uniqueValues: t.unique_value_count })),
        }),
      },
      logs: {
        totalIndexes: logRows.length,
        pipelines,
        enabledPipelines,
        totalDailyLimitEvents: totalDailyLimit,
        totalExclusionFilters,
        rateLimitedCount,
        retentionDistribution: retentionDist,
        flexIndexCount: archiveSuggestions,
        indexDetails,
        cost: domainCost(products, ['logs_ingested', 'indexed_events', 'logs_']),
        recommendations: logsRecommendations({
          totalIndexes: logRows.length, totalExclusionFilters, rateLimitedCount,
          flexIndexCount: archiveSuggestions, totalDailyLimitEvents: totalDailyLimit,
        }),
      },
      integrations: {
        total: integRows.length,
        configured: integRows.filter(r => r.is_configured).length,
        enabled: integRows.filter(r => r.is_enabled).length,
        installed: integInstalled,
        broken: integBroken,
        idle: integIdle,
        notInstalled: integNotInstalled,
        // Confirmed via host-level check evidence (host_count > 0) — the strongest
        // signal this app has for "actually receiving data" vs. merely enabled.
        // Account/notification integrations have no per-host signal, so they fall
        // back to isEnabled (no way here to confirm live data flow for those).
        receivingData: integRows.filter(r => {
          const hostCount = integHostCount(r.raw_json);
          return hostCount != null ? hostCount > 0 : Boolean(r.is_enabled);
        }).length,
        byType: Object.entries(integByType).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
        list: integRows.map(r => {
          const hostCount = integHostCount(r.raw_json);
          return {
            name: r.integration_name,
            type: r.integration_type,
            status: r.status,
            isConfigured: Boolean(r.is_configured),
            isEnabled: Boolean(r.is_enabled),
            hostCount,
            receivingData: hostCount != null ? hostCount > 0 : Boolean(r.is_enabled),
          };
        }),
        recommendations: integrationsRecommendations({
          total: integRows.length, configured: integRows.filter(r => r.is_configured).length, enabled: integRows.filter(r => r.is_enabled).length,
        }),
      },
      synthetics: {
        apiTests,
        browserTests,
        estimatedMonthlyRuns,
        details: synthDetails,
        cost: domainCost(products, ['synthetics_'], {
          amount: (apiTests * 288 * 30 / 10000) * PRICING_ESTIMATES.syntheticsApiPer10k
            + (browserTests * 96 * 30 / 1000) * PRICING_ESTIMATES.syntheticsBrowserPer1k,
          note: `${apiTests} API + ${browserTests} browser tests at default run frequency, list price`,
        }),
        recommendations: syntheticsRecommendations({ apiTests, browserTests, details: synthDetails }),
      },
      apm: {
        totalServices,
        svcInCatalog,
        svcWithMonitor,
        svcWithSLO,
        slos,
        cost: domainCost(products, ['apm_host'], {
          volume: totalServices > 0 ? Math.max(1, Math.round(totalHosts * 0.3)) : 0, unitPrice: PRICING_ESTIMATES.apmHostMonthly, unit: 'APM hosts (est.)',
        }),
        recommendations: apmRecommendations({ totalServices, svcInCatalog, svcWithMonitor, svcWithSLO }),
      },
      observability: {
        monitors,
        dashboards,
        dashboardBreakdown: {
          ootb: dashboardsOotb,
          byAuthor: dashboardsByAuthor.map((r) => ({ author: r.author, count: r.n })),
        },
      },
      rum: {
        total: rumApps.length,
        byType: rumByType,
        apps: rumApps.map(a => ({
          id: a.app_id,
          name: a.app_name,
          type: a.app_type,
          framework: a.framework,
          createdAt: a.created_at_dd,
        })),
        cost: domainCost(products, ['rum_']),
        recommendations: rumRecommendations({ total: rumApps.length, byType: rumByType }),
      },
      fleet: {
        agentVersions: versionBuckets,
        platforms,
        installedChecks: Object.entries(installedChecks)
          .slice(0, 20)
          .map(([name, count]) => ({ name, count: count as number })),
        recommendations: fleetRecommendations({ agentVersions: versionBuckets }),
      },
      security: {
        total: totalSecurityFindings,
        unresolvedCritical,
        bySeverity: Object.fromEntries(securityBySeverity.map((r) => [r.severity ?? 'unknown', r.n])),
        byCategory: Object.fromEntries(securityByCategory.map((r) => [r.category ?? 'unknown', r.n])),
        cost: domainCost(products, ['cspm', 'cws', 'appsec'], {
          volume: totalHosts, unitPrice: PRICING_ESTIMATES.cspmHostMonthly, unit: 'hosts (CSPM est.)',
        }),
        recommendations: securityRecommendations({
          total: totalSecurityFindings, unresolvedCritical, openIncidents: openIncidentsCount, totalIncidents,
        }),
      },
      productProxies: {
        ...productProxies,
        cost: domainCost(products, ['npm_', 'ndm_', 'dbm_']),
        recommendations: proxyRecommendations(productProxies),
      },
      incidents: {
        total: totalIncidents,
        open: openIncidentsCount,
        bySeverity: Object.fromEntries(incidentsBySeverity.map((r) => [r.severity ?? 'unknown', r.n])),
      },
      costManagement: {
        providers: ccmConfig.map((r) => ({ provider: r.provider, configured: Boolean(r.configured) })),
      },

      // ── Monitor breakdown ──────────────────────────────────────────────────
      monitorBreakdown: (() => {
        const rows = db.prepare(`
          SELECT monitor_type, overall_state, is_muted, has_notification,
                 has_env_tag, has_service_tag, has_team_tag
          FROM monitors WHERE org_id=? AND scan_run_id=?
        `).all(orgId, scanRunId) as Array<{
          monitor_type: string | null; overall_state: string | null;
          is_muted: number; has_notification: number;
          has_env_tag: number; has_service_tag: number; has_team_tag: number;
        }>;

        const byState: Record<string, number> = {};
        const byType: Record<string, number> = {};
        let mutedCount = 0, withoutNotification = 0;
        let withoutEnvTag = 0, withoutServiceTag = 0, withoutTeamTag = 0;

        for (const r of rows) {
          const state = r.overall_state ?? 'Unknown';
          byState[state] = (byState[state] ?? 0) + 1;
          const type = r.monitor_type ?? 'other';
          byType[type] = (byType[type] ?? 0) + 1;
          if (r.is_muted) mutedCount++;
          if (!r.has_notification) withoutNotification++;
          if (!r.has_env_tag) withoutEnvTag++;
          if (!r.has_service_tag) withoutServiceTag++;
          if (!r.has_team_tag) withoutTeamTag++;
        }

        return {
          total: rows.length, byState, byType, mutedCount, withoutNotification, withoutEnvTag, withoutServiceTag, withoutTeamTag,
          recommendations: monitorsRecommendations({ total: rows.length, mutedCount, withoutNotification, withoutEnvTag, withoutServiceTag, withoutTeamTag }),
        };
      })(),

      // ── SLO breakdown ──────────────────────────────────────────────────────
      sloBreakdown: (() => {
        const rows = db.prepare(`
          SELECT slo_type, has_env_tag, has_service_tag FROM slos WHERE org_id=? AND scan_run_id=?
        `).all(orgId, scanRunId) as Array<{ slo_type: string | null; has_env_tag: number; has_service_tag: number }>;

        const byType: Record<string, number> = {};
        let withEnvTag = 0, withServiceTag = 0;
        for (const r of rows) {
          const t = r.slo_type ?? 'unknown';
          byType[t] = (byType[t] ?? 0) + 1;
          if (r.has_env_tag) withEnvTag++;
          if (r.has_service_tag) withServiceTag++;
        }

        return {
          total: rows.length, byType, withEnvTag, withServiceTag,
          recommendations: sloRecommendations({ total: rows.length, svcWithSLO, totalServices }),
        };
      })(),

      // ── Governance ─────────────────────────────────────────────────────────
      governance: (() => {
        const sig = (product: string, signal: string): string | null =>
          (db.prepare('SELECT value FROM product_usage_signals WHERE org_id=? AND scan_run_id=? AND product=? AND signal=?')
            .get(orgId, scanRunId, product, signal) as { value: string } | undefined)?.value ?? null;

        const userCount = sig('governance', 'user_count');
        const roleCount = sig('governance', 'role_count');

        const findingRows = db.prepare(`
          SELECT rule_name, severity, title, description, affected_count, total_count, recommendation
          FROM findings WHERE org_id=? AND scan_run_id=? AND category IN ('governance','unified_tagging')
          ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
        `).all(orgId, scanRunId) as Array<{
          rule_name: string; severity: string; title: string; description: string;
          affected_count: number; total_count: number; recommendation: string | null;
        }>;

        const teamTagCoveragePct = totalHosts > 0 ? Math.round(hostsWithTeam / totalHosts * 100) : 0;
        return {
          userCount: userCount ? parseInt(userCount) : null,
          roleCount: roleCount ? parseInt(roleCount) : null,
          findings: findingRows.map(r => ({
            ruleName: r.rule_name, severity: r.severity, title: r.title,
            description: r.description, affectedCount: r.affected_count,
            totalCount: r.total_count, recommendation: r.recommendation,
          })),
          recommendations: governanceRecommendations({
            userCount: userCount ? parseInt(userCount) : null,
            roleCount: roleCount ? parseInt(roleCount) : null,
            findingsCount: findingRows.length,
            teamTagCoveragePct,
          }),
        };
      })(),

      // ── Health scorecard ────────────────────────────────────────────────────
      scorecard: (() => {
        const row = db.prepare(
          'SELECT overall_score, overall_grade, category_scores FROM scorecards WHERE org_id=? AND scan_run_id=?'
        ).get(orgId, scanRunId) as { overall_score: number; overall_grade: string; category_scores: string } | undefined;

        if (!row) return null;

        let categories: unknown[] = [];
        try { categories = JSON.parse(row.category_scores); } catch { /* ignore */ }

        const allFindings = db.prepare(`
          SELECT rule_name, severity, title, description, affected_count, recommendation, category
          FROM findings WHERE org_id=? AND scan_run_id=?
          ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
          LIMIT 20
        `).all(orgId, scanRunId) as Array<{
          rule_name: string; severity: string; title: string; description: string;
          affected_count: number; recommendation: string | null; category: string;
        }>;

        return {
          overallScore: row.overall_score,
          overallGrade: row.overall_grade,
          categories,
          topFindings: allFindings.map(f => ({
            ruleName: f.rule_name, severity: f.severity, title: f.title,
            description: f.description, affectedCount: f.affected_count,
            recommendation: f.recommendation, category: f.category,
          })),
        };
      })(),
    });
  } catch (err) { next(err); }
});

export default router;

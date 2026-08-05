import { Router } from 'express';
import { getDatabase } from '../../db/database';
import { AppError } from '../middleware/error.middleware';
import { analyzeHostGaps } from '../../assessment/host-gaps';
import { parseHostRawJson, recommendProductsForHost } from '../../assessment/host-enrichment';

const router = Router();

function parseQuery(req: { query: Record<string, unknown> }) {
  const orgId = req.query.orgId as string | undefined;
  const scanRunId = req.query.scanRunId as string | undefined;
  const page = parseInt(req.query.page as string ?? '1');
  const pageSize = Math.min(parseInt(req.query.pageSize as string ?? '50'), 200);
  const search = req.query.search as string | undefined;
  return { orgId, scanRunId, page, pageSize, search };
}

// GET /api/inventory/hosts
router.get('/hosts', (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize, search } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;
    const searchClause = search ? 'AND host_name LIKE ?' : '';
    const params: unknown[] = [orgId, scanRunId, ...(search ? [`%${search}%`] : [])];

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ? ${searchClause}`
    ).get(...params) as { c: number })?.c ?? 0;

    const hosts = db.prepare(
      `SELECT * FROM hosts WHERE org_id = ? AND scan_run_id = ? ${searchClause}
       ORDER BY has_env_tag ASC, host_name LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset) as Array<Record<string, unknown>>;

    // (env, service) → service_name, for cross-referencing APM presence per host
    // the same way the Instrumentation Gaps analysis does.
    const serviceRows = db.prepare(
      `SELECT service_name, env FROM services WHERE org_id = ? AND scan_run_id = ?`
    ).all(orgId, scanRunId) as Array<{ service_name: string; env: string | null }>;
    const serviceByEnvService = new Set(
      serviceRows.map((s) => `${(s.env ?? '').toLowerCase()}|${s.service_name.toLowerCase()}`)
    );

    const enriched = hosts.map((h) => {
      const { raw_json, ...rest } = h;
      const meta = parseHostRawJson(raw_json as string | null);
      const matched = meta.envTag && meta.serviceTag
        && serviceByEnvService.has(`${meta.envTag.toLowerCase()}|${meta.serviceTag.toLowerCase()}`);
      const hasApm = Boolean(matched) || meta.installedChecks.includes('trace');
      const isBlindSpot = !hasApm && !h.has_env_tag && !h.has_service_tag;
      return {
        ...rest,
        cloud_provider: meta.cloudProvider,
        region: meta.region,
        availability_zone: meta.availabilityZone,
        instance_type: meta.instanceType,
        installed_checks: meta.installedChecks,
        has_apm: hasApm,
        recommended_products: recommendProductsForHost(hasApm, isBlindSpot),
      };
    });

    res.json({ data: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/services
router.get('/services', (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize, search } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;
    const searchClause = search ? 'AND service_name LIKE ?' : '';
    const params: unknown[] = [orgId, scanRunId, ...(search ? [`%${search}%`] : [])];

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM services WHERE org_id = ? AND scan_run_id = ? ${searchClause}`
    ).get(...params) as { c: number })?.c ?? 0;

    const services = db.prepare(
      `SELECT * FROM services WHERE org_id = ? AND scan_run_id = ? ${searchClause}
       ORDER BY has_monitor ASC, service_name LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);

    res.json({ data: services, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/monitors
router.get('/monitors', (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;
    const total = (db.prepare(
      'SELECT COUNT(*) as c FROM monitors WHERE org_id = ? AND scan_run_id = ?'
    ).get(orgId, scanRunId) as { c: number })?.c ?? 0;

    const monitors = db.prepare(
      `SELECT id, org_id, scan_run_id, monitor_id, monitor_name, monitor_type, overall_state,
              priority, has_notification, has_env_tag, has_service_tag, has_team_tag, is_muted, tags
       FROM monitors WHERE org_id = ? AND scan_run_id = ?
       ORDER BY is_muted DESC, monitor_name LIMIT ? OFFSET ?`
    ).all(orgId, scanRunId, pageSize, offset);

    res.json({ data: monitors, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/dashboards
router.get('/dashboards', (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize, search } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;
    const searchClause = search ? 'AND title LIKE ?' : '';
    const params: unknown[] = [orgId, scanRunId, ...(search ? [`%${search}%`] : [])];

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM dashboards WHERE org_id = ? AND scan_run_id = ? ${searchClause}`
    ).get(...params) as { c: number })?.c ?? 0;

    const dashboards = db.prepare(
      `SELECT * FROM dashboards WHERE org_id = ? AND scan_run_id = ? ${searchClause}
       ORDER BY widget_count DESC, title LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);

    res.json({ data: dashboards, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/synthetics
router.get('/synthetics', (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize, search } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;
    const searchClause = search ? 'AND test_name LIKE ?' : '';
    const params: unknown[] = [orgId, scanRunId, ...(search ? [`%${search}%`] : [])];

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ? ${searchClause}`
    ).get(...params) as { c: number })?.c ?? 0;

    const tests = db.prepare(
      `SELECT * FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ? ${searchClause}
       ORDER BY has_notification ASC, test_name LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);

    res.json({ data: tests, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/slos
router.get('/slos', (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize, search } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;
    const searchClause = search ? 'AND slo_name LIKE ?' : '';
    const params: unknown[] = [orgId, scanRunId, ...(search ? [`%${search}%`] : [])];

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM slos WHERE org_id = ? AND scan_run_id = ? ${searchClause}`
    ).get(...params) as { c: number })?.c ?? 0;

    const slos = db.prepare(
      `SELECT * FROM slos WHERE org_id = ? AND scan_run_id = ? ${searchClause}
       ORDER BY slo_name LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);

    res.json({ data: slos, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/tags
router.get('/tags', (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const tagAnalysis = db.prepare(
      `SELECT * FROM tag_analysis WHERE org_id = ? AND scan_run_id = ?
       ORDER BY (host_occurrence_count + service_occurrence_count) DESC`
    ).all(orgId, scanRunId);

    res.json(tagAnalysis);
  } catch (err) { next(err); }
});

// GET /api/inventory/product-signals
router.get('/product-signals', (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const signals = db.prepare(
      'SELECT * FROM product_usage_signals WHERE org_id = ? AND scan_run_id = ? ORDER BY product, signal'
    ).all(orgId, scanRunId);

    res.json(signals);
  } catch (err) { next(err); }
});

// GET /api/inventory/summary
router.get('/summary', (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE org_id = ? AND scan_run_id = ?`)
        .get(orgId, scanRunId) as { c: number })?.c ?? 0;

    const hostEnvCoverage = (db.prepare(
      'SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ? AND has_env_tag = 1'
    ).get(orgId, scanRunId) as { c: number })?.c ?? 0;
    const totalHosts = count('hosts');
    const openIncidents = (db.prepare(
      "SELECT COUNT(*) as c FROM incidents WHERE org_id = ? AND scan_run_id = ? AND (state IS NULL OR state != 'resolved')"
    ).get(orgId, scanRunId) as { c: number })?.c ?? 0;

    res.json({
      hosts: totalHosts,
      services: count('services'),
      monitors: count('monitors'),
      dashboards: count('dashboards'),
      syntheticsTests: count('synthetics_tests'),
      logsIndexes: count('logs_indexes'),
      logsPipelines: count('logs_pipelines'),
      integrations: count('integrations'),
      cloudAccounts: count('cloud_accounts'),
      slos: count('slos'),
      tagKeys: count('tag_analysis'),
      envTagCoverage: totalHosts > 0 ? Math.round((hostEnvCoverage / totalHosts) * 100) : 0,
      securityFindings: count('security_findings'),
      openIncidents,
    });
  } catch (err) { next(err); }
});

// GET /api/inventory/tag-coverage
// Returns per-product-layer tag coverage for the hierarchical tree view
router.get('/tag-coverage', (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();
    const pct = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : null);

    const hosts = db.prepare(
      `SELECT COUNT(*) as total, SUM(has_env_tag) as env, SUM(has_service_tag) as service,
              SUM(has_version_tag) as version, SUM(has_team_tag) as team
       FROM hosts WHERE org_id = ? AND scan_run_id = ?`
    ).get(orgId, scanRunId) as { total: number; env: number; service: number; version: number; team: number };

    const services = db.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN env IS NOT NULL AND env != '' THEN 1 ELSE 0 END) as env,
              SUM(has_version_tag) as version, SUM(CASE WHEN team IS NOT NULL AND team != '' THEN 1 ELSE 0 END) as team
       FROM services WHERE org_id = ? AND scan_run_id = ?`
    ).get(orgId, scanRunId) as { total: number; env: number; version: number; team: number };

    const monitors = db.prepare(
      `SELECT COUNT(*) as total, SUM(has_env_tag) as env, SUM(has_service_tag) as service,
              SUM(has_team_tag) as team
       FROM monitors WHERE org_id = ? AND scan_run_id = ?`
    ).get(orgId, scanRunId) as { total: number; env: number; service: number; team: number };

    const synthetics = db.prepare(
      `SELECT COUNT(*) as total, SUM(has_env_tag) as env, SUM(has_service_tag) as service
       FROM synthetics_tests WHERE org_id = ? AND scan_run_id = ?`
    ).get(orgId, scanRunId) as { total: number; env: number; service: number };

    // Detect sector tags from the tag_analysis table
    const detectedKeys = new Set(
      (db.prepare('SELECT tag_key FROM tag_analysis WHERE org_id = ? AND scan_run_id = ?')
        .all(orgId, scanRunId) as { tag_key: string }[]).map((r) => r.tag_key)
    );

    res.json({
      layers: {
        hosts: {
          total: hosts.total,
          env: pct(hosts.env, hosts.total),
          service: pct(hosts.service, hosts.total),
          version: pct(hosts.version, hosts.total),
          team: pct(hosts.team, hosts.total),
        },
        services: {
          total: services.total,
          // All APM services have a service name by definition
          service: services.total > 0 ? 100 : null,
          env: pct(services.env, services.total),
          version: pct(services.version, services.total),
          team: pct(services.team, services.total),
        },
        monitors: {
          total: monitors.total,
          env: pct(monitors.env, monitors.total),
          service: pct(monitors.service, monitors.total),
          team: pct(monitors.team, monitors.total),
        },
        synthetics: {
          total: synthetics.total,
          env: pct(synthetics.env, synthetics.total),
          service: pct(synthetics.service, synthetics.total),
        },
      },
      detectedTagKeys: [...detectedKeys],
    });
  } catch (err) { next(err); }
});

// GET /api/inventory/tag-detail  — per-tag value breakdown + collision detection
router.get('/tag-detail', (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    const tagKey = req.query.tagKey as string | undefined;
    if (!orgId || !scanRunId || !tagKey) throw new AppError('orgId, scanRunId, and tagKey required', 400);

    const db = getDatabase();

    // All values for this key across all resource types
    const valueRows = db.prepare(`
      SELECT resource_type, tag_value, COUNT(DISTINCT resource_id) as cnt
      FROM resource_tags
      WHERE org_id = ? AND scan_run_id = ? AND tag_key = ?
      GROUP BY resource_type, tag_value
      ORDER BY cnt DESC
    `).all(orgId, scanRunId, tagKey) as Array<{ resource_type: string; tag_value: string; cnt: number }>;

    // Total resources per type (to compute coverage %)
    const typeTotals: Record<string, number> = {
      host: (db.prepare('SELECT COUNT(*) as c FROM hosts WHERE org_id=? AND scan_run_id=?').get(orgId, scanRunId) as { c: number }).c,
      service: (db.prepare('SELECT COUNT(*) as c FROM services WHERE org_id=? AND scan_run_id=?').get(orgId, scanRunId) as { c: number }).c,
      monitor: (db.prepare('SELECT COUNT(*) as c FROM monitors WHERE org_id=? AND scan_run_id=?').get(orgId, scanRunId) as { c: number }).c,
      synthetics_test: (db.prepare('SELECT COUNT(*) as c FROM synthetics_tests WHERE org_id=? AND scan_run_id=?').get(orgId, scanRunId) as { c: number }).c,
    };

    // Aggregate: per resource-type breakdown
    const byType: Record<string, { tagged: number; total: number }> = {};
    const valueAgg: Record<string, { count: number; types: Set<string> }> = {};

    for (const row of valueRows) {
      const t = row.resource_type;
      if (!byType[t]) byType[t] = { tagged: 0, total: typeTotals[t] ?? 0 };
      byType[t].tagged += row.cnt;

      if (!valueAgg[row.tag_value]) valueAgg[row.tag_value] = { count: 0, types: new Set() };
      valueAgg[row.tag_value].count += row.cnt;
      valueAgg[row.tag_value].types.add(row.resource_type);
    }

    const resourceBreakdown = Object.entries(byType).map(([type, { tagged, total }]) => ({
      resourceType: type,
      tagged,
      total,
      pct: total > 0 ? Math.round((tagged / total) * 100) : 0,
    })).sort((a, b) => b.tagged - a.tagged);

    const values = Object.entries(valueAgg)
      .map(([value, { count, types }]) => ({ value, count, resourceTypes: [...types] }))
      .sort((a, b) => b.count - a.count);

    // Collision detection
    const ENV_SYNONYMS: Record<string, string[]> = {
      production: ['prod', 'production', 'live', 'prd', 'prd-01', 'prod-01', 'master'],
      staging:    ['staging', 'stg', 'stage', 'preprod', 'pre-prod', 'pre_prod', 'stag', 'stge'],
      development:['dev', 'development', 'develop', 'local', 'sandbox', 'devel'],
      testing:    ['test', 'testing', 'tst', 'qa', 'quality', 'uat', 'sit', 'qas'],
    };

    // Build reverse lookup
    const synonymMap: Record<string, string> = {};
    for (const [canonical, variants] of Object.entries(ENV_SYNONYMS)) {
      for (const v of variants) synonymMap[v] = canonical;
    }

    // Group 1: known synonym collisions
    const synonymCollisions: Record<string, string[]> = {};
    for (const { value } of values) {
      const norm = value.toLowerCase().trim();
      const canonical = synonymMap[norm];
      if (canonical) {
        if (!synonymCollisions[canonical]) synonymCollisions[canonical] = [];
        if (!synonymCollisions[canonical].includes(value)) synonymCollisions[canonical].push(value);
      }
    }

    // Group 2: case/separator normalization collisions
    const normMap: Record<string, string[]> = {};
    for (const { value } of values) {
      const key = value.toLowerCase().trim().replace(/[-_\s]/g, '');
      if (!normMap[key]) normMap[key] = [];
      if (!normMap[key].includes(value)) normMap[key].push(value);
    }

    const collisions: Array<{ canonical: string; variants: string[]; kind: 'synonym' | 'casing' }> = [];
    for (const [canonical, variants] of Object.entries(synonymCollisions)) {
      if (variants.length > 1) collisions.push({ canonical, variants, kind: 'synonym' });
    }
    for (const [, variants] of Object.entries(normMap)) {
      if (variants.length > 1 && !collisions.some(c => c.variants.sort().join() === variants.sort().join())) {
        collisions.push({ canonical: variants[0].toLowerCase(), variants, kind: 'casing' });
      }
    }

    res.json({ tagKey, resourceBreakdown, values, collisions, totalValues: values.length });
  } catch (err) { next(err); }
});

// GET /api/inventory/cloud  — cloud accounts + cloud-sourced tag inventory
router.get('/cloud', (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);

    const db = getDatabase();

    // Cloud accounts
    const accounts = db.prepare(`
      SELECT provider, account_id, account_name, status,
             metrics_enabled, resource_collection_enabled, has_errors, raw_json
      FROM cloud_accounts WHERE org_id = ? AND scan_run_id = ?
      ORDER BY provider, account_name
    `).all(orgId, scanRunId) as Array<{
      provider: string; account_id: string | null; account_name: string | null;
      status: string; metrics_enabled: number; resource_collection_enabled: number;
      has_errors: number; raw_json: string | null;
    }>;

    // Cloud-sourced tags from resource_tags (populated correctly after collector fix)
    const CLOUD_SOURCES = ['aws', 'gcp', 'azure', 'kubernetes', 'docker'];
    const cloudTagRows = db.prepare(`
      SELECT tag_source, tag_key, tag_value, COUNT(DISTINCT resource_id) as host_count
      FROM resource_tags
      WHERE org_id = ? AND scan_run_id = ?
        AND tag_source IN ('aws','gcp','azure','kubernetes','docker')
      GROUP BY tag_source, tag_key, tag_value
      ORDER BY tag_source, host_count DESC, tag_key
    `).all(orgId, scanRunId) as Array<{
      tag_source: string; tag_key: string; tag_value: string; host_count: number;
    }>;

    // Fallback: parse tags_by_source from host raw_json for scans without cloud source tracking
    let cloudTagsFromRaw: typeof cloudTagRows = [];
    if (cloudTagRows.length === 0) {
      const hostRaws = db.prepare(`
        SELECT host_name, raw_json FROM hosts WHERE org_id = ? AND scan_run_id = ? AND raw_json IS NOT NULL
      `).all(orgId, scanRunId) as Array<{ host_name: string; raw_json: string }>;

      const CLOUD_SOURCE_MAP: Record<string, string> = {
        'amazon web services': 'aws', 'amazon ec2': 'aws', 'aws': 'aws',
        'google cloud platform': 'gcp', 'google compute engine': 'gcp', 'gcp': 'gcp',
        'azure': 'azure', 'microsoft azure': 'azure',
        'kubernetes': 'kubernetes', 'kubernetes-labels': 'kubernetes',
        'docker': 'docker',
      };

      // Aggregate: { source → { tagKey → { value → hostSet } } }
      const agg: Record<string, Record<string, Record<string, Set<string>>>> = {};

      for (const { host_name, raw_json } of hostRaws) {
        try {
          const host = JSON.parse(raw_json) as { tags_by_source?: Record<string, string[]> };
          for (const [sourceName, tagList] of Object.entries(host.tags_by_source ?? {})) {
            const src = CLOUD_SOURCE_MAP[sourceName.toLowerCase()];
            if (!src) continue;
            if (!agg[src]) agg[src] = {};
            for (const tag of tagList) {
              const ci = tag.indexOf(':');
              if (ci === -1) continue;
              const k = tag.slice(0, ci).toLowerCase().trim();
              const v = tag.slice(ci + 1).trim();
              if (!agg[src][k]) agg[src][k] = {};
              if (!agg[src][k][v]) agg[src][k][v] = new Set();
              agg[src][k][v].add(host_name);
            }
          }
        } catch { /* skip malformed */ }
      }

      for (const [source, keyMap] of Object.entries(agg)) {
        for (const [key, valMap] of Object.entries(keyMap)) {
          for (const [value, hosts] of Object.entries(valMap)) {
            cloudTagsFromRaw.push({ tag_source: source, tag_key: key, tag_value: value, host_count: hosts.size });
          }
        }
      }
      cloudTagsFromRaw.sort((a, b) => b.host_count - a.host_count);
    }

    const effectiveCloudTags = cloudTagRows.length > 0 ? cloudTagRows : cloudTagsFromRaw;

    // Group by source
    const bySource: Record<string, Array<{ key: string; value: string; hostCount: number }>> = {};
    for (const row of effectiveCloudTags) {
      if (!bySource[row.tag_source]) bySource[row.tag_source] = [];
      bySource[row.tag_source].push({ key: row.tag_key, value: row.tag_value, hostCount: row.host_count });
    }

    // Unique keys per source
    const keysBySource: Record<string, string[]> = {};
    for (const [src, rows] of Object.entries(bySource)) {
      keysBySource[src] = [...new Set(rows.map(r => r.key))];
    }

    // Hosts with cloud tags vs total
    const totalHosts = (db.prepare('SELECT COUNT(*) as c FROM hosts WHERE org_id=? AND scan_run_id=?')
      .get(orgId, scanRunId) as { c: number }).c;
    const hostsWithCloudTags = cloudTagRows.length > 0
      ? (db.prepare(`SELECT COUNT(DISTINCT resource_id) as c FROM resource_tags
           WHERE org_id=? AND scan_run_id=? AND tag_source IN ('aws','gcp','azure')`)
          .get(orgId, scanRunId) as { c: number }).c
      : effectiveCloudTags.reduce((s, r) => s + r.host_count, 0); // rough for fallback

    // Detected providers
    const detectedProviders = [...new Set(effectiveCloudTags.map(r => r.tag_source))];

    // DD standard key coverage: are cloud tag keys mapped to DD keys?
    const DD_STANDARD_CLOUD_MAPPINGS: Record<string, string[]> = {
      env:      ['environment', 'env', 'Env', 'Environment', 'stage'],
      service:  ['application', 'Application', 'App', 'app', 'service'],
      team:     ['Owner', 'owner', 'Team', 'team'],
      region:   ['region', 'aws:region', 'Location'],
      version:  ['version', 'Version', 'Release', 'release'],
    };
    const allCloudKeys = new Set(effectiveCloudTags.map(r => r.tag_key));
    const mappingGaps: Array<{ ddKey: string; cloudVariants: string[]; found: boolean }> = [];
    for (const [ddKey, variants] of Object.entries(DD_STANDARD_CLOUD_MAPPINGS)) {
      const found = variants.some(v => allCloudKeys.has(v.toLowerCase()));
      mappingGaps.push({ ddKey, cloudVariants: variants, found });
    }

    // Cloud Cost Management config per provider
    const costManagementRows = db.prepare(`
      SELECT provider, configured, account_count FROM cost_management_config
      WHERE org_id = ? AND scan_run_id = ?
    `).all(orgId, scanRunId) as Array<{ provider: string; configured: number; account_count: number }>;
    const costManagement = costManagementRows.map(r => ({
      provider: r.provider,
      configured: Boolean(r.configured),
      accountCount: r.account_count,
    }));

    res.json({
      accounts: accounts.map(a => ({
        provider: a.provider,
        accountId: a.account_id,
        accountName: a.account_name,
        status: a.status,
        metricsEnabled: Boolean(a.metrics_enabled),
        resourceCollectionEnabled: Boolean(a.resource_collection_enabled),
        hasErrors: Boolean(a.has_errors),
      })),
      detectedProviders,
      totalHosts,
      hostsWithCloudTags,
      keysBySource,
      tagsBySource: bySource,
      mappingGaps,
      usingFallback: cloudTagRows.length === 0 && effectiveCloudTags.length > 0,
      costManagement,
    });
  } catch (err) { next(err); }
});

// GET /api/inventory/host-gaps — per-host instrumentation blind-spot analysis:
// cloud placement, tag compliance, APM/CSPM/CWS/NPM coverage gaps with
// why/what/how/cost/impact, service catalog maturity, and host-vs-serverless
// app breakdown. See backend/src/assessment/host-gaps.ts.
router.get('/host-gaps', (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    res.json(analyzeHostGaps(orgId, scanRunId));
  } catch (err) { next(err); }
});

export default router;

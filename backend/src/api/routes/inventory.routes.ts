import { Router } from 'express';
import { getDatabase } from '../../db/database';
import { assertOrgAccess } from '../../auth/org-access';
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
router.get('/hosts', async (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize, search } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;

    const baseQuery = () => {
      let q = db('hosts').where({ org_id: orgId, scan_run_id: scanRunId });
      if (search) q = q.andWhereLike('host_name', `%${search}%`);
      return q;
    };

    const totalRow = await baseQuery().clone().count<{ c: string | number }[]>({ c: '*' }).first();
    const total = Number(totalRow?.c ?? 0);

    const hosts = await baseQuery()
      .select('*')
      .orderBy([{ column: 'has_env_tag', order: 'asc' }, { column: 'host_name', order: 'asc' }])
      .limit(pageSize)
      .offset(offset) as Array<Record<string, unknown>>;

    // (env, service) → service_name, for cross-referencing APM presence per host
    // the same way the Instrumentation Gaps analysis does.
    const serviceRows = await db('services')
      .select('service_name', 'env')
      .where({ org_id: orgId, scan_run_id: scanRunId }) as Array<{ service_name: string; env: string | null }>;
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
router.get('/services', async (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize, search } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;

    const baseQuery = () => {
      let q = db('services').where({ org_id: orgId, scan_run_id: scanRunId });
      if (search) q = q.andWhereLike('service_name', `%${search}%`);
      return q;
    };

    const totalRow = await baseQuery().clone().count<{ c: string | number }[]>({ c: '*' }).first();
    const total = Number(totalRow?.c ?? 0);

    const services = await baseQuery()
      .select('*')
      .orderBy([{ column: 'has_monitor', order: 'asc' }, { column: 'service_name', order: 'asc' }])
      .limit(pageSize)
      .offset(offset);

    res.json({ data: services, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/monitors
router.get('/monitors', async (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;

    const totalRow = await db('monitors')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .count<{ c: string | number }[]>({ c: '*' }).first();
    const total = Number(totalRow?.c ?? 0);

    const monitors = await db('monitors')
      .select(
        'id', 'org_id', 'scan_run_id', 'monitor_id', 'monitor_name', 'monitor_type', 'overall_state',
        'priority', 'has_notification', 'has_env_tag', 'has_service_tag', 'has_team_tag', 'is_muted', 'tags'
      )
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .orderBy([{ column: 'is_muted', order: 'desc' }, { column: 'monitor_name', order: 'asc' }])
      .limit(pageSize)
      .offset(offset);

    res.json({ data: monitors, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/dashboards
router.get('/dashboards', async (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize, search } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;

    const baseQuery = () => {
      let q = db('dashboards').where({ org_id: orgId, scan_run_id: scanRunId });
      if (search) q = q.andWhereLike('title', `%${search}%`);
      return q;
    };

    const totalRow = await baseQuery().clone().count<{ c: string | number }[]>({ c: '*' }).first();
    const total = Number(totalRow?.c ?? 0);

    const dashboards = await baseQuery()
      .select('*')
      .orderBy([{ column: 'widget_count', order: 'desc' }, { column: 'title', order: 'asc' }])
      .limit(pageSize)
      .offset(offset);

    res.json({ data: dashboards, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/synthetics
router.get('/synthetics', async (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize, search } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;

    const baseQuery = () => {
      let q = db('synthetics_tests').where({ org_id: orgId, scan_run_id: scanRunId });
      if (search) q = q.andWhereLike('test_name', `%${search}%`);
      return q;
    };

    const totalRow = await baseQuery().clone().count<{ c: string | number }[]>({ c: '*' }).first();
    const total = Number(totalRow?.c ?? 0);

    const tests = await baseQuery()
      .select('*')
      .orderBy([{ column: 'has_notification', order: 'asc' }, { column: 'test_name', order: 'asc' }])
      .limit(pageSize)
      .offset(offset);

    res.json({ data: tests, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/slos
router.get('/slos', async (req, res, next) => {
  try {
    const { orgId, scanRunId, page, pageSize, search } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const offset = (page - 1) * pageSize;

    const baseQuery = () => {
      let q = db('slos').where({ org_id: orgId, scan_run_id: scanRunId });
      if (search) q = q.andWhereLike('slo_name', `%${search}%`);
      return q;
    };

    const totalRow = await baseQuery().clone().count<{ c: string | number }[]>({ c: '*' }).first();
    const total = Number(totalRow?.c ?? 0);

    const slos = await baseQuery()
      .select('*')
      .orderBy('slo_name', 'asc')
      .limit(pageSize)
      .offset(offset);

    res.json({ data: slos, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/inventory/tags
router.get('/tags', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const tagAnalysis = await db('tag_analysis')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .orderBy(db.raw('(host_occurrence_count + service_occurrence_count)'), 'desc');

    res.json(tagAnalysis);
  } catch (err) { next(err); }
});

// GET /api/inventory/product-signals
router.get('/product-signals', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const signals = await db('product_usage_signals')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .orderBy([{ column: 'product', order: 'asc' }, { column: 'signal', order: 'asc' }]);

    res.json(signals);
  } catch (err) { next(err); }
});

// GET /api/inventory/summary
router.get('/summary', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const count = async (table: string) => {
      const row = await db(table).where({ org_id: orgId, scan_run_id: scanRunId })
        .count<{ c: string | number }[]>({ c: '*' }).first();
      return Number(row?.c ?? 0);
    };

    const hostEnvCoverageRow = await db('hosts')
      .where({ org_id: orgId, scan_run_id: scanRunId, has_env_tag: 1 })
      .count<{ c: string | number }[]>({ c: '*' }).first();
    const hostEnvCoverage = Number(hostEnvCoverageRow?.c ?? 0);

    const totalHosts = await count('hosts');

    const openIncidentsRow = await db('incidents')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .andWhere((qb) => qb.whereNull('state').orWhereNot('state', 'resolved'))
      .count<{ c: string | number }[]>({ c: '*' }).first();
    const openIncidents = Number(openIncidentsRow?.c ?? 0);

    res.json({
      hosts: totalHosts,
      services: await count('services'),
      monitors: await count('monitors'),
      dashboards: await count('dashboards'),
      syntheticsTests: await count('synthetics_tests'),
      logsIndexes: await count('logs_indexes'),
      logsPipelines: await count('logs_pipelines'),
      integrations: await count('integrations'),
      cloudAccounts: await count('cloud_accounts'),
      slos: await count('slos'),
      tagKeys: await count('tag_analysis'),
      envTagCoverage: totalHosts > 0 ? Math.round((hostEnvCoverage / totalHosts) * 100) : 0,
      securityFindings: await count('security_findings'),
      openIncidents,
    });
  } catch (err) { next(err); }
});

// GET /api/inventory/tag-coverage
// Returns per-product-layer tag coverage for the hierarchical tree view
router.get('/tag-coverage', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();
    const pct = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : null);

    const hosts = await db('hosts')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .count<{ total: string | number }>({ total: '*' })
      .sum<{ env: string | number }>({ env: 'has_env_tag' })
      .sum<{ service: string | number }>({ service: 'has_service_tag' })
      .sum<{ version: string | number }>({ version: 'has_version_tag' })
      .sum<{ team: string | number }>({ team: 'has_team_tag' })
      .first() as unknown as { total: number; env: number; service: number; version: number; team: number };

    const services = await db('services')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .count<{ total: string | number }>({ total: '*' })
      .sum<{ env: string | number }>(
        db.raw("CASE WHEN env IS NOT NULL AND env != '' THEN 1 ELSE 0 END") as unknown as string
      )
      .sum<{ version: string | number }>({ version: 'has_version_tag' })
      .sum<{ team: string | number }>(
        db.raw("CASE WHEN team IS NOT NULL AND team != '' THEN 1 ELSE 0 END") as unknown as string
      )
      .first() as unknown as { total: number; env: number; version: number; team: number };

    const monitors = await db('monitors')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .count<{ total: string | number }>({ total: '*' })
      .sum<{ env: string | number }>({ env: 'has_env_tag' })
      .sum<{ service: string | number }>({ service: 'has_service_tag' })
      .sum<{ team: string | number }>({ team: 'has_team_tag' })
      .first() as unknown as { total: number; env: number; service: number; team: number };

    const synthetics = await db('synthetics_tests')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .count<{ total: string | number }>({ total: '*' })
      .sum<{ env: string | number }>({ env: 'has_env_tag' })
      .sum<{ service: string | number }>({ service: 'has_service_tag' })
      .first() as unknown as { total: number; env: number; service: number };

    // Detect sector tags from the tag_analysis table
    const detectedKeys = new Set(
      (await db('tag_analysis').select('tag_key').where({ org_id: orgId, scan_run_id: scanRunId }) as { tag_key: string }[])
        .map((r) => r.tag_key)
    );

    res.json({
      layers: {
        hosts: {
          total: Number(hosts.total),
          env: pct(Number(hosts.env), Number(hosts.total)),
          service: pct(Number(hosts.service), Number(hosts.total)),
          version: pct(Number(hosts.version), Number(hosts.total)),
          team: pct(Number(hosts.team), Number(hosts.total)),
        },
        services: {
          total: Number(services.total),
          // All APM services have a service name by definition
          service: Number(services.total) > 0 ? 100 : null,
          env: pct(Number(services.env), Number(services.total)),
          version: pct(Number(services.version), Number(services.total)),
          team: pct(Number(services.team), Number(services.total)),
        },
        monitors: {
          total: Number(monitors.total),
          env: pct(Number(monitors.env), Number(monitors.total)),
          service: pct(Number(monitors.service), Number(monitors.total)),
          team: pct(Number(monitors.team), Number(monitors.total)),
        },
        synthetics: {
          total: Number(synthetics.total),
          env: pct(Number(synthetics.env), Number(synthetics.total)),
          service: pct(Number(synthetics.service), Number(synthetics.total)),
        },
      },
      detectedTagKeys: [...detectedKeys],
    });
  } catch (err) { next(err); }
});

// GET /api/inventory/tag-detail  — per-tag value breakdown + collision detection
router.get('/tag-detail', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    const tagKey = req.query.tagKey as string | undefined;
    if (!orgId || !scanRunId || !tagKey) throw new AppError('orgId, scanRunId, and tagKey required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();

    // All values for this key across all resource types
    const valueRows = await db('resource_tags')
      .select('resource_type', 'tag_value')
      .count({ cnt: 'resource_id', distinct: true })
      .where({ org_id: orgId, scan_run_id: scanRunId, tag_key: tagKey })
      .groupBy('resource_type', 'tag_value')
      .orderBy('cnt', 'desc') as unknown as Array<{ resource_type: string; tag_value: string; cnt: number }>;

    // Total resources per type (to compute coverage %)
    const countTable = async (table: string) => {
      const row = await db(table).where({ org_id: orgId, scan_run_id: scanRunId })
        .count<{ c: string | number }[]>({ c: '*' }).first();
      return Number(row?.c ?? 0);
    };
    const typeTotals: Record<string, number> = {
      host: await countTable('hosts'),
      service: await countTable('services'),
      monitor: await countTable('monitors'),
      synthetics_test: await countTable('synthetics_tests'),
    };

    // Aggregate: per resource-type breakdown
    const byType: Record<string, { tagged: number; total: number }> = {};
    const valueAgg: Record<string, { count: number; types: Set<string> }> = {};

    for (const row of valueRows) {
      const t = row.resource_type;
      const cnt = Number(row.cnt);
      if (!byType[t]) byType[t] = { tagged: 0, total: typeTotals[t] ?? 0 };
      byType[t].tagged += cnt;

      if (!valueAgg[row.tag_value]) valueAgg[row.tag_value] = { count: 0, types: new Set() };
      valueAgg[row.tag_value].count += cnt;
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
router.get('/cloud', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);

    const db = getDatabase();

    // Cloud accounts
    const accounts = await db('cloud_accounts')
      .select(
        'provider', 'account_id', 'account_name', 'status',
        'metrics_enabled', 'resource_collection_enabled', 'has_errors', 'raw_json'
      )
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .orderBy([{ column: 'provider', order: 'asc' }, { column: 'account_name', order: 'asc' }]) as Array<{
      provider: string; account_id: string | null; account_name: string | null;
      status: string; metrics_enabled: number; resource_collection_enabled: number;
      has_errors: number; raw_json: string | null;
    }>;

    // Cloud-sourced tags from resource_tags (populated correctly after collector fix)
    const cloudTagRows = await db('resource_tags')
      .select('tag_source', 'tag_key', 'tag_value')
      .count({ host_count: 'resource_id', distinct: true })
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .whereIn('tag_source', ['aws', 'gcp', 'azure', 'kubernetes', 'docker'])
      .groupBy('tag_source', 'tag_key', 'tag_value')
      .orderBy([{ column: 'tag_source', order: 'asc' }, { column: 'host_count', order: 'desc' }, { column: 'tag_key', order: 'asc' }]) as unknown as Array<{
      tag_source: string; tag_key: string; tag_value: string; host_count: number;
    }>;

    // Fallback: parse tags_by_source from host raw_json for scans without cloud source tracking
    let cloudTagsFromRaw: typeof cloudTagRows = [];
    if (cloudTagRows.length === 0) {
      const hostRaws = await db('hosts')
        .select('host_name', 'raw_json')
        .where({ org_id: orgId, scan_run_id: scanRunId })
        .whereNotNull('raw_json') as Array<{ host_name: string; raw_json: string }>;

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
      bySource[row.tag_source].push({ key: row.tag_key, value: row.tag_value, hostCount: Number(row.host_count) });
    }

    // Unique keys per source
    const keysBySource: Record<string, string[]> = {};
    for (const [src, rows] of Object.entries(bySource)) {
      keysBySource[src] = [...new Set(rows.map(r => r.key))];
    }

    // Hosts with cloud tags vs total
    const totalHostsRow = await db('hosts')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .count<{ c: string | number }[]>({ c: '*' }).first();
    const totalHosts = Number(totalHostsRow?.c ?? 0);

    let hostsWithCloudTags: number;
    if (cloudTagRows.length > 0) {
      const hostsWithCloudTagsRow = await db('resource_tags')
        .where({ org_id: orgId, scan_run_id: scanRunId })
        .whereIn('tag_source', ['aws', 'gcp', 'azure'])
        .countDistinct<{ c: string | number }[]>({ c: 'resource_id' }).first();
      hostsWithCloudTags = Number(hostsWithCloudTagsRow?.c ?? 0);
    } else {
      hostsWithCloudTags = effectiveCloudTags.reduce((s, r) => s + Number(r.host_count), 0); // rough for fallback
    }

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
    const costManagementRows = await db('cost_management_config')
      .select('provider', 'configured', 'account_count')
      .where({ org_id: orgId, scan_run_id: scanRunId }) as Array<{ provider: string; configured: number; account_count: number }>;
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
router.get('/host-gaps', async (req, res, next) => {
  try {
    const { orgId, scanRunId } = parseQuery(req as Parameters<typeof parseQuery>[0]);
    if (!orgId) throw new AppError('orgId required', 400);
    if (!scanRunId) throw new AppError('scanRunId required', 400);
    await assertOrgAccess(orgId, req.user!.id);
    res.json(await analyzeHostGaps(orgId, scanRunId));
  } catch (err) { next(err); }
});

export default router;

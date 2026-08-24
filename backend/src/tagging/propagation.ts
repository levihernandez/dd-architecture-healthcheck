import { getDatabase } from '../db/database';

const UST_TAGS = ['env', 'service', 'version'];
const IMPORTANT_TAGS = ['team', 'owner', 'cost_center'];

export interface PropagationLayer {
  present: boolean;
  coverage: number | null; // % of resources in this layer that have the tag
}

export interface ServicePropagation {
  serviceName: string;
  tags: Record<string, {
    infra: PropagationLayer;
    apm: PropagationLayer;
    monitors: PropagationLayer;
    synthetics: PropagationLayer;
    propagationScore: number; // 0–4 layers present
    gapLayers: string[];
    isUst: boolean;
  }>;
  overallScore: number; // 0–100
}

export interface PropagationResult {
  services: ServicePropagation[];
  summary: {
    fullPropagation: number;     // services where all UST tags flow through all layers
    partialPropagation: number;
    brokenPropagation: number;
    avgPropagationScore: number;
  };
  fixRecommendations: Array<{
    layer: string;
    tag: string;
    affectedServices: string[];
    fix: string;
  }>;
}

export async function analyzeTagPropagation(orgId: string, scanRunId: string): Promise<PropagationResult> {
  const db = getDatabase();

  // Get all APM services
  const apmServices = await db<{
    org_id: string;
    scan_run_id: string;
    service_name: string;
    env: string | null;
    has_version_tag: number;
    team: string | null;
  }>('services')
    .select('service_name', 'env', 'has_version_tag', 'team')
    .where({ org_id: orgId, scan_run_id: scanRunId });

  const totalHostsRow = await db('hosts')
    .count({ c: '*' })
    .where({ org_id: orgId, scan_run_id: scanRunId })
    .first() as { c: number | string } | undefined;
  const totalHosts = Number(totalHostsRow?.c ?? 0);

  // Hosts that have each tag
  async function hostCoverage(tagKey: string): Promise<number> {
    const row = await db('resource_tags')
      .countDistinct({ c: 'resource_id' })
      .where({ org_id: orgId, scan_run_id: scanRunId, resource_type: 'host', tag_key: tagKey })
      .first() as { c: number | string } | undefined;
    const count = Number(row?.c ?? 0);
    return totalHosts > 0 ? Math.round((count / totalHosts) * 100) : 0;
  }

  // Hosts with a specific service tag value
  async function hostsWithService(serviceName: string): Promise<number> {
    const row = await db('resource_tags')
      .countDistinct({ c: 'resource_id' })
      .where({ org_id: orgId, scan_run_id: scanRunId, resource_type: 'host', tag_key: 'service', tag_value: serviceName })
      .first() as { c: number | string } | undefined;
    return Number(row?.c ?? 0);
  }

  async function hostsWithServiceAndTag(serviceName: string, tagKey: string): Promise<number> {
    const row = await db('resource_tags as rt1')
      .join('resource_tags as rt2', function () {
        this.on('rt1.org_id', '=', 'rt2.org_id')
          .andOn('rt1.scan_run_id', '=', 'rt2.scan_run_id')
          .andOn('rt1.resource_id', '=', 'rt2.resource_id')
          .andOn('rt1.resource_type', '=', 'rt2.resource_type');
      })
      .where({
        'rt1.org_id': orgId,
        'rt1.scan_run_id': scanRunId,
        'rt1.resource_type': 'host',
        'rt1.tag_key': 'service',
        'rt1.tag_value': serviceName,
        'rt2.tag_key': tagKey,
      })
      .countDistinct({ c: 'rt1.resource_id' })
      .first() as { c: number | string } | undefined;
    return Number(row?.c ?? 0);
  }

  const totalMonitorsRow = await db('monitors')
    .count({ c: '*' })
    .where({ org_id: orgId, scan_run_id: scanRunId })
    .first() as { c: number | string } | undefined;
  const totalMonitors = Number(totalMonitorsRow?.c ?? 0);

  async function monitorCoverageForService(serviceName: string, colName: string): Promise<number> {
    // Monitors tagged with this service that also have the tag
    const withServiceRow = await db('monitors as m')
      .join('resource_tags as rt', function () {
        this.on('rt.org_id', '=', 'm.org_id')
          .andOn('rt.scan_run_id', '=', 'm.scan_run_id')
          .andOnVal('rt.resource_type', 'monitor')
          .andOn('rt.resource_id', '=', db.raw('CAST(m.monitor_id AS TEXT)'))
          .andOnVal('rt.tag_key', 'service')
          .andOnVal('rt.tag_value', serviceName);
      })
      .where({ 'm.org_id': orgId, 'm.scan_run_id': scanRunId })
      .count({ c: '*' })
      .first() as { c: number | string } | undefined;
    const withService = Number(withServiceRow?.c ?? 0);

    if (withService === 0) {
      if (totalMonitors === 0) return 0;
      const avgRow = await db('monitors')
        .avg({ pct: colName })
        .where({ org_id: orgId, scan_run_id: scanRunId })
        .first() as { pct: number | string | null } | undefined;
      return Math.round(Number(avgRow?.pct ?? 0) * 100);
    }

    const taggedMonitorIds = db('resource_tags')
      .select(db.raw('CAST(resource_id AS INTEGER) as resource_id'))
      .where({ org_id: orgId, scan_run_id: scanRunId, resource_type: 'monitor', tag_key: 'service', tag_value: serviceName });

    const withServiceAndTagRow = await db('monitors')
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .andWhere(colName, 1)
      .whereIn('monitor_id', taggedMonitorIds)
      .count({ c: '*' })
      .first() as { c: number | string } | undefined;
    const withServiceAndTag = Number(withServiceAndTagRow?.c ?? 0);

    return withService > 0 ? Math.round((withServiceAndTag / withService) * 100) : 0;
  }

  const totalSyntheticsRow = await db('synthetics_tests')
    .count({ c: '*' })
    .where({ org_id: orgId, scan_run_id: scanRunId })
    .first() as { c: number | string } | undefined;
  const totalSynthetics = Number(totalSyntheticsRow?.c ?? 0);

  async function syntheticsCoverage(colName: string): Promise<number> {
    if (totalSynthetics === 0) return 0;
    const row = await db('synthetics_tests')
      .sum({ c: colName })
      .where({ org_id: orgId, scan_run_id: scanRunId })
      .first() as { c: number | string | null } | undefined;
    const count = Number(row?.c ?? 0);
    return Math.round((count / totalSynthetics) * 100);
  }

  const services: ServicePropagation[] = [];
  const breakdownByLayer: Record<string, Record<string, string[]>> = {
    infra: { env: [], service: [], version: [], team: [] },
    monitors: { env: [], service: [], team: [] },
    synthetics: { env: [], service: [] },
  };

  for (const svc of apmServices.slice(0, 50)) { // cap at 50 for perf
    const serviceName = svc.service_name;
    const hostsWithThisService = await hostsWithService(serviceName);
    const tagResults: ServicePropagation['tags'] = {};

    const tagsToCheck = [...UST_TAGS, ...IMPORTANT_TAGS];

    for (const tag of tagsToCheck) {
      const isUst = UST_TAGS.includes(tag);
      const layers: ServicePropagation['tags'][string] = {
        infra: { present: false, coverage: null },
        apm: { present: false, coverage: null },
        monitors: { present: false, coverage: null },
        synthetics: { present: false, coverage: null },
        propagationScore: 0,
        gapLayers: [],
        isUst,
      };

      // Infrastructure layer
      if (hostsWithThisService > 0) {
        const hostsWithTag = await hostsWithServiceAndTag(serviceName, tag);
        const infraCov = Math.round((hostsWithTag / hostsWithThisService) * 100);
        layers.infra = { present: infraCov > 0, coverage: infraCov };
        if (infraCov === 0) breakdownByLayer.infra[tag]?.push(serviceName);
      } else {
        // No hosts with this service — use global host coverage
        const globalCov = await hostCoverage(tag);
        layers.infra = { present: globalCov > 0, coverage: globalCov };
      }

      // APM layer
      if (tag === 'env') {
        layers.apm = { present: Boolean(svc.env), coverage: svc.env ? 100 : 0 };
      } else if (tag === 'service') {
        layers.apm = { present: true, coverage: 100 }; // APM services always have service
      } else if (tag === 'version') {
        layers.apm = { present: Boolean(svc.has_version_tag), coverage: svc.has_version_tag ? 100 : 0 };
      } else if (tag === 'team') {
        layers.apm = { present: Boolean(svc.team), coverage: svc.team ? 100 : 0 };
      } else {
        layers.apm = { present: false, coverage: null }; // not tracked at APM level
      }

      // Monitors layer (only for env, service, team)
      if (['env', 'service', 'team'].includes(tag)) {
        const colMap: Record<string, string> = { env: 'has_env_tag', service: 'has_service_tag', team: 'has_team_tag' };
        const col = colMap[tag];
        if (col) {
          const cov = await monitorCoverageForService(serviceName, col);
          layers.monitors = { present: cov > 0, coverage: cov };
          if (cov === 0) breakdownByLayer.monitors[tag]?.push(serviceName);
        }
      }

      // Synthetics layer (only for env, service)
      if (['env', 'service'].includes(tag)) {
        const colMap: Record<string, string> = { env: 'has_env_tag', service: 'has_service_tag' };
        const col = colMap[tag];
        if (col) {
          const cov = await syntheticsCoverage(col);
          layers.synthetics = { present: cov > 0, coverage: cov };
          if (cov === 0 && isUst) breakdownByLayer.synthetics[tag]?.push(serviceName);
        }
      }

      // Compute propagation score
      const layersApplicable = [
        layers.infra.coverage !== null,
        layers.apm.coverage !== null,
        layers.monitors.coverage !== null,
        layers.synthetics.coverage !== null,
      ];
      const layersPresent = [
        layers.infra.present,
        layers.apm.present,
        layers.monitors.present,
        layers.synthetics.present,
      ];
      const applicable = layersApplicable.filter(Boolean).length;
      const present = layersPresent.filter((p, i) => layersApplicable[i] && p).length;
      layers.propagationScore = present;

      const gapLayers = [];
      if (layers.infra.coverage !== null && !layers.infra.present) gapLayers.push('Infrastructure');
      if (layers.apm.coverage !== null && !layers.apm.present) gapLayers.push('APM');
      if (layers.monitors.coverage !== null && !layers.monitors.present) gapLayers.push('Monitors');
      if (layers.synthetics.coverage !== null && !layers.synthetics.present) gapLayers.push('Synthetics');
      layers.gapLayers = gapLayers;

      if (applicable > 0) tagResults[tag] = layers;
    }

    const ustScores = UST_TAGS.map((t) => tagResults[t]?.propagationScore ?? 0);
    const maxScore = UST_TAGS.length * 4;
    const overallScore = maxScore > 0
      ? Math.round((ustScores.reduce((a, b) => a + b, 0) / maxScore) * 100)
      : 0;

    services.push({ serviceName, tags: tagResults, overallScore });
  }

  // Summary
  const fullPropagation = services.filter((s) => s.overallScore >= 90).length;
  const partialPropagation = services.filter((s) => s.overallScore >= 40 && s.overallScore < 90).length;
  const brokenPropagation = services.filter((s) => s.overallScore < 40).length;
  const avgPropagationScore = services.length > 0
    ? Math.round(services.reduce((a, s) => a + s.overallScore, 0) / services.length)
    : 0;

  // Fix recommendations
  const fixRecommendations: PropagationResult['fixRecommendations'] = [];
  const FIX_MAP: Record<string, Record<string, string>> = {
    infra: {
      env: 'Set DD_ENV in Agent config or add env:<value> to extra_tags in datadog.yaml',
      service: 'Add service:<name> to extra_tags per host, or use Autodiscovery annotations',
      version: 'Set DD_VERSION in app deployment or extra_tags in Agent config',
      team: 'Add team:<name> to host-level extra_tags or cloud provider tags and sync via integration',
    },
    monitors: {
      env: 'Add env:<value> to monitor tags array — use template variables like $env for alerting context',
      service: 'Tag monitors with service:<name> to enable service-level SLO and notification routing',
      team: 'Tag monitors with team:<name> to route alerts to owning team via notification handles',
    },
    synthetics: {
      env: 'Add env:<value> tag to Synthetics tests — required for environment-specific SLO tracking',
      service: 'Tag Synthetics tests with service:<name> to correlate with APM error rates',
    },
  };

  for (const [layer, tagMap] of Object.entries(breakdownByLayer)) {
    for (const [tag, affectedServices] of Object.entries(tagMap)) {
      const uniqueServices = [...new Set(affectedServices)];
      if (uniqueServices.length > 0) {
        fixRecommendations.push({
          layer,
          tag,
          affectedServices: uniqueServices.slice(0, 10),
          fix: FIX_MAP[layer]?.[tag] ?? `Add "${tag}" tag to ${layer}`,
        });
      }
    }
  }

  return {
    services: services.sort((a, b) => a.overallScore - b.overallScore),
    summary: { fullPropagation, partialPropagation, brokenPropagation, avgPropagationScore },
    fixRecommendations,
  };
}

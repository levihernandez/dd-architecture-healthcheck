import { getDatabase } from '../db/database';
import { SYNONYM_GROUPS } from './normalization';
import { recommendationForTagKey, type BestPracticeRecommendation } from './recommendation';

const AFFECTED_HOST_CAP = 50;

// Known cloud provider source names as returned by Datadog tags_by_source
const CLOUD_SOURCE_MAP: Record<string, string> = {
  'Amazon Web Services': 'aws',
  'Amazon EC2': 'aws',
  'AWS': 'aws',
  'Google Cloud Platform': 'gcp',
  'Google Compute Engine': 'gcp',
  'GCP': 'gcp',
  'Azure': 'azure',
  'Microsoft Azure': 'azure',
};

// Canonical mapping: cloud provider tag key → Datadog canonical key
const CLOUD_TO_DD_MAPPING: Record<string, string> = {
  // AWS common tags
  'Name': 'host',
  'Owner': 'team',
  'Environment': 'env',
  'Env': 'env',
  'Application': 'service',
  'App': 'service',
  'Service': 'service',
  'Team': 'team',
  'Squad': 'team',
  'CostCenter': 'cost_center',
  'Cost_Center': 'cost_center',
  'cost-center': 'cost_center',
  'BU': 'business_unit',
  'BusinessUnit': 'business_unit',
  'Business_Unit': 'business_unit',
  'Region': 'region',
  'Version': 'version',
  'Release': 'version',
  // GCP labels follow snake_case
  'environment': 'env',
  'application': 'service',
  'team': 'team',
  'owner': 'owner',
  'cost_center': 'cost_center',
  'business_unit': 'business_unit',
};

function caseFold(s: string) {
  return s.toLowerCase().replace(/[-.\s]/g, '_');
}

export interface CloudAlignmentRow {
  cloudProvider: string;
  cloudTagKey: string;
  cloudTagValues: string[];
  ddTagKey: string | null;
  ddTagValues: string[];
  alignmentStatus: 'aligned' | 'missing_in_dd' | 'key_drift' | 'value_drift' | 'dd_only';
  mappingSuggestion: string | null;
  hostCount: number;
  affectedHosts: Array<{ id: string; name: string }>;
  affectedHostCount: number;
  bestPractice: BestPracticeRecommendation;
}

export interface CloudAlignmentResult {
  rows: CloudAlignmentRow[];
  cloudOnlyCount: number;
  alignedCount: number;
  keyDriftCount: number;
  valueDriftCount: number;
  alignmentScore: number;
  detectedProviders: string[];
  propagationGaps: Array<{
    cloudKey: string;
    ddKey: string;
    presentOnCloudResources: number;
    missingInDd: number;
    fixRecommendation: string;
  }>;
}

export function analyzeCloudAlignment(orgId: string, scanRunId: string): CloudAlignmentResult {
  const db = getDatabase();

  // Load host raw_json to extract tags_by_source
  const hostRows = db.prepare(
    `SELECT host_name, raw_json FROM hosts
     WHERE org_id = ? AND scan_run_id = ? AND raw_json IS NOT NULL LIMIT 500`
  ).all(orgId, scanRunId) as { host_name: string; raw_json: string }[];

  // Load all Datadog tags for hosts (from resource_tags)
  const ddTagRows = db.prepare(
    `SELECT resource_id, tag_key, tag_value FROM resource_tags
     WHERE org_id = ? AND scan_run_id = ? AND resource_type = 'host'`
  ).all(orgId, scanRunId) as { resource_id: string; tag_key: string; tag_value: string }[];

  const ddTagsByHost = new Map<string, Map<string, Set<string>>>();
  for (const row of ddTagRows) {
    if (!ddTagsByHost.has(row.resource_id)) ddTagsByHost.set(row.resource_id, new Map());
    const hostMap = ddTagsByHost.get(row.resource_id)!;
    if (!hostMap.has(row.tag_key)) hostMap.set(row.tag_key, new Set());
    hostMap.get(row.tag_key)!.add(row.tag_value);
  }

  // Aggregate cloud tags across all hosts
  // { provider → { cloudTagKey → { values: Set, hostCount: number } } }
  const cloudAgg: Record<string, Record<string, { values: Set<string>; hosts: Set<string> }>> = {};

  // Also gather "all DD tag keys" for dd_only detection
  const allDdKeys = new Set<string>();
  for (const hostMap of ddTagsByHost.values()) {
    for (const key of hostMap.keys()) allDdKeys.add(key);
  }

  const detectedProviders = new Set<string>();

  for (const host of hostRows) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(host.raw_json); } catch { continue; }

    const tagsBySource = (parsed.tags_by_source ?? {}) as Record<string, string[]>;
    for (const [sourceName, tags] of Object.entries(tagsBySource)) {
      const provider = CLOUD_SOURCE_MAP[sourceName];
      if (!provider) continue;
      detectedProviders.add(provider);

      if (!cloudAgg[provider]) cloudAgg[provider] = {};
      for (const tag of tags) {
        const colonIdx = tag.indexOf(':');
        if (colonIdx === -1) continue;
        const key = tag.substring(0, colonIdx);
        const value = tag.substring(colonIdx + 1);
        // Skip auto-generated numeric/UUID-like tag keys
        if (/^\d/.test(key) || key.length < 2) continue;

        if (!cloudAgg[provider][key]) cloudAgg[provider][key] = { values: new Set(), hosts: new Set() };
        cloudAgg[provider][key].values.add(value);
        cloudAgg[provider][key].hosts.add(host.host_name);
      }
    }
  }

  // Build alignment rows
  const rows: CloudAlignmentRow[] = [];
  const propagationGapMap: Record<string, { cloudKey: string; ddKey: string; cloudCount: number; missingCount: number }> = {};

  for (const [provider, tagAgg] of Object.entries(cloudAgg)) {
    for (const [cloudKey, agg] of Object.entries(tagAgg)) {
      // Look up the canonical DD key for this cloud tag
      const mappedDdKey = CLOUD_TO_DD_MAPPING[cloudKey]
        ?? SYNONYM_GROUPS.find((g) => g.variants.some((v) => caseFold(v) === caseFold(cloudKey)))?.canonical
        ?? null;

      const cloudValues = [...agg.values];
      const hostCount = agg.hosts.size;
      const affectedHosts = [...agg.hosts].slice(0, AFFECTED_HOST_CAP).map((h) => ({ id: h, name: h }));
      const bestPractice = recommendationForTagKey(mappedDdKey ?? cloudKey);

      if (!mappedDdKey) {
        // No known DD equivalent — check if similar key exists in DD
        const similarDdKey = [...allDdKeys].find((k) => caseFold(k) === caseFold(cloudKey));
        if (similarDdKey) {
          // Key exists in DD with slightly different casing
          const ddVals = [...ddTagsByHost.values()]
            .flatMap((m) => [...(m.get(similarDdKey) ?? new Set())]);
          rows.push({
            cloudProvider: provider,
            cloudTagKey: cloudKey,
            cloudTagValues: cloudValues,
            ddTagKey: similarDdKey,
            ddTagValues: [...new Set(ddVals)],
            alignmentStatus: 'key_drift',
            mappingSuggestion: `Normalize "${cloudKey}" → "${similarDdKey}" in Datadog`,
            hostCount,
            affectedHosts,
            affectedHostCount: hostCount,
            bestPractice,
          });
        } else {
          rows.push({
            cloudProvider: provider,
            cloudTagKey: cloudKey,
            cloudTagValues: cloudValues,
            ddTagKey: null,
            ddTagValues: [],
            alignmentStatus: 'missing_in_dd',
            mappingSuggestion: `Add this ${provider.toUpperCase()} tag to Datadog Agent config or Auto Discovery annotations`,
            hostCount,
            affectedHosts,
            affectedHostCount: hostCount,
            bestPractice,
          });
        }
        continue;
      }

      // Found a canonical DD key — check if it's actually in DD for those hosts
      const ddValsAcrossHosts = [...agg.hosts].flatMap((h) => {
        const hostMap = ddTagsByHost.get(h);
        return [...(hostMap?.get(mappedDdKey) ?? new Set())];
      });
      const ddValues = [...new Set(ddValsAcrossHosts)];
      const hostsWithDdKey = [...agg.hosts].filter((h) => {
        const hostMap = ddTagsByHost.get(h);
        return hostMap?.has(mappedDdKey) ?? false;
      });

      if (ddValues.length === 0) {
        rows.push({
          cloudProvider: provider,
          cloudTagKey: cloudKey,
          cloudTagValues: cloudValues,
          ddTagKey: mappedDdKey,
          ddTagValues: [],
          alignmentStatus: 'missing_in_dd',
          mappingSuggestion: `Propagate ${provider.toUpperCase()} tag "${cloudKey}" as "${mappedDdKey}" via Agent extra_tags or integration config`,
          hostCount,
          affectedHosts,
          affectedHostCount: hostCount,
          bestPractice,
        });
        // Track propagation gap
        const gapKey = `${cloudKey}→${mappedDdKey}`;
        if (!propagationGapMap[gapKey]) {
          propagationGapMap[gapKey] = { cloudKey, ddKey: mappedDdKey, cloudCount: 0, missingCount: 0 };
        }
        propagationGapMap[gapKey].cloudCount += hostCount;
        propagationGapMap[gapKey].missingCount += hostCount - hostsWithDdKey.length;
      } else {
        // Check for value drift
        const cloudLower = cloudValues.map((v) => v.toLowerCase());
        const ddLower = ddValues.map((v) => v.toLowerCase());
        const hasValueDrift = cloudLower.some((cv) => !ddLower.includes(cv));

        if (hasValueDrift) {
          rows.push({
            cloudProvider: provider,
            cloudTagKey: cloudKey,
            cloudTagValues: cloudValues,
            ddTagKey: mappedDdKey,
            ddTagValues: ddValues,
            alignmentStatus: 'value_drift',
            mappingSuggestion: `Align values: cloud="${cloudValues.slice(0, 2).join(',')}" vs dd="${ddValues.slice(0, 2).join(',')}"`,
            hostCount,
            affectedHosts,
            affectedHostCount: hostCount,
            bestPractice,
          });
        } else {
          rows.push({
            cloudProvider: provider,
            cloudTagKey: cloudKey,
            cloudTagValues: cloudValues,
            ddTagKey: mappedDdKey,
            ddTagValues: ddValues,
            alignmentStatus: 'aligned',
            mappingSuggestion: null,
            hostCount,
            affectedHosts,
            affectedHostCount: hostCount,
            bestPractice,
          });
        }
      }
    }
  }

  // Summary counts
  const cloudOnlyCount = rows.filter((r) => r.alignmentStatus === 'missing_in_dd').length;
  const alignedCount = rows.filter((r) => r.alignmentStatus === 'aligned').length;
  const keyDriftCount = rows.filter((r) => r.alignmentStatus === 'key_drift').length;
  const valueDriftCount = rows.filter((r) => r.alignmentStatus === 'value_drift').length;

  const total = rows.length;
  const alignmentScore = total > 0
    ? Math.round((alignedCount / total) * 70 + (keyDriftCount / total === 0 ? 15 : 0) + (valueDriftCount / total === 0 ? 15 : 0))
    : 0;

  const propagationGaps = Object.values(propagationGapMap).map((g) => ({
    cloudKey: g.cloudKey,
    ddKey: g.ddKey,
    presentOnCloudResources: g.cloudCount,
    missingInDd: g.missingCount,
    fixRecommendation: `Add "${g.cloudKey}" to Datadog agent extra_tags or use dd-agent integration auto-tagging to propagate as "${g.ddKey}"`,
  }));

  return {
    rows: rows.sort((a, b) => {
      const order = { missing_in_dd: 0, key_drift: 1, value_drift: 2, aligned: 3, dd_only: 4 };
      return (order[a.alignmentStatus] ?? 5) - (order[b.alignmentStatus] ?? 5);
    }),
    cloudOnlyCount,
    alignedCount,
    keyDriftCount,
    valueDriftCount,
    alignmentScore,
    detectedProviders: [...detectedProviders],
    propagationGaps,
  };
}

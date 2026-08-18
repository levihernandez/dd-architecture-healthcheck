import { getDatabase } from '../db/database';

const AFFECTED_CAP = 25;

// ─── Synonym groups: every variant maps to one canonical key ─────────────────
export const SYNONYM_GROUPS = [
  {
    canonical: 'env',
    variants: ['environment', 'env', 'stage', 'deploy_env', 'deployment_env', 'deploy_environment', 'deployment'],
    description: 'Deployment environment (production, staging, dev, qa)',
  },
  {
    canonical: 'service',
    variants: ['app', 'application', 'service_name', 'svc', 'microservice', 'app_name', 'application_name', 'service'],
    description: 'Application or service name — must match APM service identifier',
  },
  {
    canonical: 'version',
    variants: ['ver', 'release', 'app_version', 'release_version', 'deploy_version', 'build_version', 'image_tag', 'version'],
    description: 'Application version, release tag, or git SHA',
  },
  {
    canonical: 'team',
    variants: ['squad', 'team_name', 'group', 'engineering_team', 'dev_team', 'team'],
    description: 'Owning team name — aligns with Datadog Teams for routing',
  },
  {
    canonical: 'owner',
    variants: ['responsible', 'poc', 'contact', 'maintainer', 'steward', 'accountable', 'owner'],
    description: 'Individual or alias responsible for incident routing',
  },
  {
    canonical: 'business_unit',
    variants: ['bu', 'businessunit', 'business-unit', 'bunit', 'business_group', 'business_unit'],
    description: 'Business unit for cost attribution and rollup reporting',
  },
  {
    canonical: 'cost_center',
    variants: ['costcenter', 'cost-center', 'cc', 'cost_centre', 'cost_code', 'billing_code', 'cost_center'],
    description: 'Cost center code for chargeback and FinOps',
  },
  {
    canonical: 'region',
    variants: ['aws_region', 'cloud_region', 'geo', 'geography', 'datacenter_region', 'az_region', 'region'],
    description: 'Cloud or geographic region',
  },
  {
    canonical: 'cluster_name',
    variants: ['kube_cluster_name', 'eks_cluster', 'aks_cluster', 'gke_cluster', 'cluster', 'k8s_cluster', 'cluster_name'],
    description: 'Kubernetes cluster name',
  },
  {
    canonical: 'namespace',
    variants: ['kube_namespace', 'k8s_namespace', 'kubernetes_namespace', 'namespace'],
    description: 'Kubernetes namespace for workload isolation',
  },
  {
    canonical: 'data_center',
    variants: ['dc', 'datacenter', 'data-center', 'data_center'],
    description: 'Physical data center identifier',
  },
];

// Known value normalizations: catch prod vs production etc.
const VALUE_DRIFT_GROUPS: Record<string, string[][]> = {
  env: [
    ['prod', 'production', 'prd', 'PROD', 'Production', 'PRD', 'live'],
    ['staging', 'stage', 'stg', 'STG', 'Staging'],
    ['dev', 'development', 'DEV', 'Development', 'develop'],
    ['qa', 'test', 'QA', 'TEST', 'testing', 'uat'],
  ],
};

function caseFold(s: string) {
  return s.toLowerCase().replace(/[-.\s]/g, '_');
}

/**
 * Looks up concrete resources affected by a tag-key conflict (casing variants)
 * or a value-drift conflict (a single tag key with drifted values), mirroring
 * the resource_tags query pattern used in cloud-alignment.ts. resource_tags is
 * currently only populated for resource_type='host' by the infrastructure
 * collector, so this surfaces host-level detail; the returned list is capped.
 */
function findAffectedResources(
  db: ReturnType<typeof getDatabase>,
  orgId: string,
  scanRunId: string,
  tagKeys: string[],
  tagValues?: string[]
): Array<{ type: string; id: string; name: string }> {
  if (tagKeys.length === 0) return [];
  const keyPlaceholders = tagKeys.map(() => '?').join(', ');
  let query = `SELECT DISTINCT resource_type, resource_id FROM resource_tags
     WHERE org_id = ? AND scan_run_id = ? AND tag_key IN (${keyPlaceholders})`;
  const params: Array<string> = [orgId, scanRunId, ...tagKeys];
  if (tagValues && tagValues.length > 0) {
    const valuePlaceholders = tagValues.map(() => '?').join(', ');
    query += ` AND tag_value IN (${valuePlaceholders})`;
    params.push(...tagValues);
  }
  query += ` LIMIT ${AFFECTED_CAP}`;
  const rows = db.prepare(query).all(...params) as Array<{ resource_type: string; resource_id: string }>;
  return rows.map((r) => ({ type: r.resource_type, id: r.resource_id, name: r.resource_id }));
}

export interface NormalizationResult {
  synonymGroups: Array<{
    canonicalKey: string;
    detectedVariants: string[];
    confidence: number;
    occurrenceCount: number;
    recommendation: string;
    description: string;
    isAligned: boolean;
  }>;
  conflicts: Array<{
    tagKey: string;
    conflictType: 'casing' | 'value_drift' | 'synonym_duplicate';
    valuesFound: string[];
    resourceTypes: string[];
    affectedCount: number;
    recommendation: string;
    affectedResources: Array<{ type: string; id: string; name: string }>;
  }>;
  tagDictionary: Array<{
    canonicalKey: string;
    definition: string;
    currentCoverage: number;
    foundKey: string | null;
    status: 'found' | 'missing' | 'drifted';
    isUst: boolean;
  }>;
  normalizationScore: number;
  totalTagKeys: number;
}

export function analyzeTagNormalization(orgId: string, scanRunId: string): NormalizationResult {
  const db = getDatabase();

  const tagRows = db.prepare(
    `SELECT tag_key, unique_value_count, host_occurrence_count, service_occurrence_count, top_values
     FROM tag_analysis WHERE org_id = ? AND scan_run_id = ?`
  ).all(orgId, scanRunId) as Array<{
    tag_key: string;
    unique_value_count: number;
    host_occurrence_count: number;
    service_occurrence_count: number;
    top_values: string;
  }>;

  const tagKeys = tagRows.map((r) => r.tag_key);
  const tagMap = new Map(tagRows.map((r) => [r.tag_key, r]));

  const totalHosts = (db.prepare(
    'SELECT COUNT(*) as c FROM hosts WHERE org_id = ? AND scan_run_id = ?'
  ).get(orgId, scanRunId) as { c: number })?.c ?? 1;

  // ── Synonym detection ──────────────────────────────────────────────────────
  const synonymGroups: NormalizationResult['synonymGroups'] = [];
  for (const group of SYNONYM_GROUPS) {
    const detected = tagKeys.filter((k) =>
      group.variants.some((v) => caseFold(k) === caseFold(v))
    );
    if (detected.length === 0) continue;

    const occurrenceCount = detected.reduce((sum, k) => {
      const row = tagMap.get(k);
      return sum + (row ? row.host_occurrence_count + row.service_occurrence_count : 0);
    }, 0);

    const isCanonicalPresent = detected.some((k) => k === group.canonical);
    const hasMultipleVariants = detected.length > 1;

    const confidence = isCanonicalPresent && !hasMultipleVariants ? 1.0
      : hasMultipleVariants ? 0.9
      : 0.75;

    let recommendation = '';
    if (hasMultipleVariants) {
      const nonCanonical = detected.filter((k) => k !== group.canonical);
      recommendation = `Consolidate ${nonCanonical.map((k) => `"${k}"`).join(', ')} → "${group.canonical}"`;
    } else if (!isCanonicalPresent) {
      recommendation = `Rename "${detected[0]}" → "${group.canonical}" (canonical Datadog key)`;
    } else {
      recommendation = `Tag "${group.canonical}" is correctly named — no action needed`;
    }

    synonymGroups.push({
      canonicalKey: group.canonical,
      detectedVariants: detected,
      confidence,
      occurrenceCount,
      recommendation,
      description: group.description,
      isAligned: isCanonicalPresent && !hasMultipleVariants,
    });
  }

  // ── Casing conflict detection ──────────────────────────────────────────────
  const conflicts: NormalizationResult['conflicts'] = [];
  const casingGroups: Record<string, string[]> = {};
  for (const key of tagKeys) {
    const lower = key.toLowerCase();
    if (!casingGroups[lower]) casingGroups[lower] = [];
    casingGroups[lower].push(key);
  }
  for (const [lower, variants] of Object.entries(casingGroups)) {
    if (variants.length < 2) continue;
    const affectedCount = variants.reduce((sum, k) => {
      const row = tagMap.get(k);
      return sum + (row ? row.host_occurrence_count + row.service_occurrence_count : 0);
    }, 0);
    conflicts.push({
      tagKey: lower,
      conflictType: 'casing',
      valuesFound: variants,
      resourceTypes: ['host', 'service'],
      affectedCount,
      recommendation: `Standardize to lowercase: use "${lower}" consistently across all resources`,
      affectedResources: findAffectedResources(db, orgId, scanRunId, variants),
    });
  }

  // ── Value drift detection ──────────────────────────────────────────────────
  for (const [key, valueGroups] of Object.entries(VALUE_DRIFT_GROUPS)) {
    const matchingKey = tagKeys.find((k) => k.toLowerCase() === key);
    if (!matchingKey) continue;
    const row = tagMap.get(matchingKey);
    if (!row) continue;

    let topValues: string[] = [];
    try { topValues = JSON.parse(row.top_values ?? '[]'); } catch { /* ignore */ }

    for (const group of valueGroups) {
      const found = topValues.filter((v) => group.map((g) => g.toLowerCase()).includes(v.toLowerCase()));
      if (found.length > 1) {
        conflicts.push({
          tagKey: matchingKey,
          conflictType: 'value_drift',
          valuesFound: found,
          resourceTypes: ['host', 'service'],
          affectedCount: row.host_occurrence_count + row.service_occurrence_count,
          recommendation: `Normalize values: standardize to "${group[0]}" (found variants: ${found.join(', ')})`,
          affectedResources: findAffectedResources(db, orgId, scanRunId, [matchingKey], found),
        });
      }
    }
  }

  // ── Tag dictionary ─────────────────────────────────────────────────────────
  const UST_TAGS = new Set(['env', 'service', 'version']);
  const DICTIONARY_TAGS = ['env', 'service', 'version', 'team', 'owner', 'cost_center', 'region', 'business_unit'];

  const tagDictionary = DICTIONARY_TAGS.map((key) => {
    const foundKey = tagKeys.find((k) => k === key)
      || tagKeys.find((k) => SYNONYM_GROUPS.find((g) => g.canonical === key)?.variants.some((v) => caseFold(k) === caseFold(v)));
    const row = foundKey ? tagMap.get(foundKey) : undefined;
    const coverage = totalHosts > 0 && row ? Math.round((row.host_occurrence_count / totalHosts) * 100) : 0;
    const hasDrift = conflicts.some((c) => c.tagKey === (foundKey ?? key));

    return {
      canonicalKey: key,
      definition: SYNONYM_GROUPS.find((g) => g.canonical === key)?.description ?? key,
      currentCoverage: coverage,
      foundKey: foundKey ?? null,
      status: (foundKey ? (hasDrift ? 'drifted' : 'found') : 'missing') as 'found' | 'missing' | 'drifted',
      isUst: UST_TAGS.has(key),
    };
  });

  // ── Normalization score (0–100) ───────────────────────────────────────────
  const ustFound = ['env', 'service', 'version'].filter((k) =>
    tagDictionary.find((d) => d.canonicalKey === k)?.status === 'found'
  ).length;
  const conflictPenalty = Math.min(30, conflicts.length * 8);
  const normalizationScore = Math.max(0, Math.round(
    (ustFound / 3) * 50 +
    (tagDictionary.filter((d) => d.status === 'found').length / DICTIONARY_TAGS.length) * 20 +
    30 - conflictPenalty
  ));

  return { synonymGroups, conflicts, tagDictionary, normalizationScore, totalTagKeys: tagKeys.length };
}

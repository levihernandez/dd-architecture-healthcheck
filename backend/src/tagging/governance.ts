import { getDatabase } from '../db/database';

export interface OrgTagSummary {
  orgId: string;
  orgName: string;
  tagKeys: string[];
  tagValues: Record<string, string[]>; // key → top values
}

export interface TagInconsistency {
  tagKey: string;
  type: 'key_missing_in_org' | 'value_drift' | 'casing_inconsistency';
  orgsAffected: string[];
  orgsWithKey: string[];
  orgsMissing: string[];
  valuesByOrg: Record<string, string[]>;
  recommendation: string;
}

export interface GovernanceResult {
  orgSummaries: OrgTagSummary[];
  inconsistencies: TagInconsistency[];
  valueDrift: TagInconsistency[];
  consistencyScore: number;
  globalTagKeys: string[];
  commonTagKeys: string[];  // present in ALL orgs
  orphanTagKeys: Record<string, string[]>; // orgId → keys unique to that org
}

const UST_KEYS = ['env', 'service', 'version', 'team', 'application'];

export function analyzeMultiOrgGovernance(): GovernanceResult {
  const db = getDatabase();

  // Get all orgs and their latest scan
  const orgs = db.prepare(
    `SELECT o.id, o.name,
            (SELECT id FROM scan_runs WHERE org_id = o.id AND status = 'completed'
             ORDER BY started_at DESC LIMIT 1) as latest_scan_id
     FROM orgs o`
  ).all() as Array<{ id: string; name: string; latest_scan_id: string | null }>;

  const orgSummaries: OrgTagSummary[] = [];
  const allTagKeySets: Map<string, Set<string>> = new Map(); // orgId → Set of tag keys
  const allTagValues: Map<string, Map<string, Set<string>>> = new Map(); // orgId → key → values

  for (const org of orgs) {
    if (!org.latest_scan_id) continue;

    const tagRows = db.prepare(
      `SELECT tag_key, top_values FROM tag_analysis
       WHERE org_id = ? AND scan_run_id = ?`
    ).all(org.id, org.latest_scan_id) as Array<{ tag_key: string; top_values: string }>;

    const keySet = new Set(tagRows.map((r) => r.tag_key));
    const valueMap = new Map<string, Set<string>>();
    for (const row of tagRows) {
      let vals: string[] = [];
      try { vals = JSON.parse(row.top_values ?? '[]'); } catch { /* ignore */ }
      valueMap.set(row.tag_key, new Set(vals.slice(0, 10)));
    }

    allTagKeySets.set(org.id, keySet);
    allTagValues.set(org.id, valueMap);

    orgSummaries.push({
      orgId: org.id,
      orgName: org.name,
      tagKeys: [...keySet],
      tagValues: Object.fromEntries([...valueMap.entries()].map(([k, v]) => [k, [...v]])),
    });
  }

  if (orgSummaries.length === 0) {
    return {
      orgSummaries: [],
      inconsistencies: [],
      valueDrift: [],
      consistencyScore: 0,
      globalTagKeys: [],
      commonTagKeys: [],
      orphanTagKeys: {},
    };
  }

  // Global tag key union
  const globalTagKeys = new Set<string>();
  for (const keySet of allTagKeySets.values()) {
    for (const key of keySet) globalTagKeys.add(key);
  }

  // Common keys (present in all orgs)
  const commonTagKeys = [...globalTagKeys].filter((key) =>
    [...allTagKeySets.values()].every((s) => s.has(key))
  );

  // Keys unique to one org
  const orphanTagKeys: Record<string, string[]> = {};
  for (const [orgId, keySet] of allTagKeySets.entries()) {
    const orphans = [...keySet].filter((key) =>
      [...allTagKeySets.entries()].filter(([id]) => id !== orgId).every(([, s]) => !s.has(key))
    );
    if (orphans.length > 0) orphanTagKeys[orgId] = orphans;
  }

  // Detect inconsistencies
  const inconsistencies: TagInconsistency[] = [];
  const valueDrift: TagInconsistency[] = [];

  if (orgSummaries.length > 1) {
    // Key presence inconsistency for UST tags
    for (const key of UST_KEYS) {
      const orgsWithKey = orgSummaries.filter((o) => allTagKeySets.get(o.orgId)?.has(key)).map((o) => o.orgName);
      const orgsMissing = orgSummaries.filter((o) => !allTagKeySets.get(o.orgId)?.has(key)).map((o) => o.orgName);
      if (orgsMissing.length > 0) {
        inconsistencies.push({
          tagKey: key,
          type: 'key_missing_in_org',
          orgsAffected: orgsMissing,
          orgsWithKey,
          orgsMissing,
          valuesByOrg: {},
          recommendation: `Tag "${key}" is missing in ${orgsMissing.join(', ')}. Apply this tag across all orgs for unified filtering and governance.`,
        });
      }
    }

    // Value drift for env (prod vs production, etc.)
    const ENV_CANONICAL_GROUPS = [
      ['prod', 'production', 'prd', 'live'],
      ['staging', 'stage', 'stg'],
      ['dev', 'development', 'develop'],
      ['qa', 'test', 'testing', 'uat'],
    ];

    const envKey = 'env';
    const orgEnvValues: Record<string, string[]> = {};
    for (const org of orgSummaries) {
      const vals = [...(allTagValues.get(org.orgId)?.get(envKey) ?? [])];
      if (vals.length > 0) orgEnvValues[org.orgName] = vals;
    }

    if (Object.keys(orgEnvValues).length > 1) {
      for (const group of ENV_CANONICAL_GROUPS) {
        const orgsWithDrift = Object.entries(orgEnvValues).filter(([, vals]) =>
          vals.some((v) => group.includes(v.toLowerCase())) &&
          !vals.includes(group[0])
        );
        if (orgsWithDrift.length > 0) {
          valueDrift.push({
            tagKey: envKey,
            type: 'value_drift',
            orgsAffected: orgsWithDrift.map(([name]) => name),
            orgsWithKey: Object.keys(orgEnvValues),
            orgsMissing: [],
            valuesByOrg: orgEnvValues,
            recommendation: `Standardize env values to "${group[0]}" across all orgs. Found variants: ${[...new Set(orgsWithDrift.flatMap(([, v]) => v.filter((vv) => group.includes(vv.toLowerCase()))))].join(', ')}`,
          });
        }
      }
    }
  }

  // Consistency score
  const totalChecks = UST_KEYS.length * orgSummaries.length;
  const passedChecks = UST_KEYS.reduce((sum, key) => {
    return sum + orgSummaries.filter((o) => allTagKeySets.get(o.orgId)?.has(key)).length;
  }, 0);
  const driftPenalty = valueDrift.length * 5;
  const consistencyScore = totalChecks > 0
    ? Math.max(0, Math.round((passedChecks / totalChecks) * 100) - driftPenalty)
    : 100;

  return {
    orgSummaries,
    inconsistencies,
    valueDrift,
    consistencyScore,
    globalTagKeys: [...globalTagKeys].sort(),
    commonTagKeys: commonTagKeys.sort(),
    orphanTagKeys,
  };
}

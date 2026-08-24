import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/database';
import { safeJsonSnapshot } from '../../utils/redact';
import { logger } from '../../utils/logger';
import type { DatadogClient } from '../client';
import type { DDHost } from '../../types/datadog.types';
import type { CollectorResultSummary, CollectionLimits } from '../../types/api.types';

const STANDARD_TAGS = new Set(['env', 'service', 'version', 'team', 'owner', 'host']);

// Map Datadog's tags_by_source keys to canonical provider IDs
const CLOUD_SOURCE_MAP: Record<string, string> = {
  'amazon web services': 'aws',
  'amazon ec2': 'aws',
  'aws': 'aws',
  'google cloud platform': 'gcp',
  'google compute engine': 'gcp',
  'gcp': 'gcp',
  'azure': 'azure',
  'microsoft azure': 'azure',
  'kubernetes': 'kubernetes',
  'kubernetes-labels': 'kubernetes',
  'kubernetes-annotations': 'kubernetes',
  'docker': 'docker',
  'chef': 'chef',
  'puppet': 'puppet',
  'ansible': 'ansible',
};

function normalizeTagSource(source: string): string {
  return CLOUD_SOURCE_MAP[source.toLowerCase()] ?? 'agent';
}

export async function collectInfrastructure(
  client: DatadogClient,
  orgId: string,
  scanRunId: string,
  limits?: CollectionLimits
): Promise<CollectorResultSummary> {
  const start = Date.now();
  logger.info(`[${orgId}] Collecting infrastructure/hosts`);

  const result = await client.getPaginated<DDHost>(
    '/api/v1/hosts',
    { with_apps: true, with_mute_status: true, include_muted_hosts_data: true },
    limits?.maxPagesHosts ?? 300
  );

  if (result.status !== 'success') {
    return {
      collector: 'infrastructure',
      status: result.status,
      itemCount: 0,
      error: result.error,
      durationMs: Date.now() - start,
      endpoint: result.endpoint,
      requestCount: result.requestCount,
      pageCount: result.pageCount,
      truncated: result.truncated,
      rateLimitRemaining: result.rateLimitRemaining,
    };
  }

  const db = getDatabase();
  const now = new Date().toISOString();

  const hostRows: Record<string, unknown>[] = [];
  const hostResourceRows: Record<string, unknown>[] = [];
  const tagRows: Record<string, unknown>[] = [];

  for (const host of result.data) {
    const hostName = host.host_name || host.name;
    if (!hostName) continue;

    const allTags = flattenTags(host.tags_by_source);
    const tagMap = parseTags(allTags);

    const hasEnv = tagMap.has('env');
    const hasService = tagMap.has('service');
    const hasVersion = tagMap.has('version');
    const hasTeam = tagMap.has('team');

    const hostId = `${orgId}:host:${hostName}`;

    hostRows.push({
      id: uuidv4(),
      org_id: orgId,
      scan_run_id: scanRunId,
      host_name: hostName,
      aliases: JSON.stringify(host.aliases ?? []),
      agent_version: host.agent_version ?? host.meta?.agent_version ?? null,
      platform: host.meta?.platform ?? null,
      has_env_tag: hasEnv ? 1 : 0,
      has_service_tag: hasService ? 1 : 0,
      has_version_tag: hasVersion ? 1 : 0,
      has_team_tag: hasTeam ? 1 : 0,
      tag_count: allTags.length,
      raw_json: safeJsonSnapshot(host),
      first_seen: now,
      last_seen: now,
    });

    hostResourceRows.push({
      id: uuidv4(),
      org_id: orgId,
      scan_run_id: scanRunId,
      resource_type: 'host',
      resource_id: hostName,
      resource_name: hostName,
      source_endpoint: '/api/v1/hosts',
      first_seen: now,
      last_seen: now,
      raw_json: safeJsonSnapshot(host),
    });

    // Store tags preserving their source (aws, gcp, azure, kubernetes, agent…)
    const seenTagKeys = new Set<string>(); // track to avoid exact duplicates across sources
    for (const [sourceName, sourceTags] of Object.entries(host.tags_by_source ?? {})) {
      const tagSource = normalizeTagSource(sourceName);
      const sourceTagMap = parseTags(sourceTags);
      for (const [key, values] of sourceTagMap.entries()) {
        for (const value of values) {
          const dedupeKey = `${tagSource}:${key}:${value}`;
          if (seenTagKeys.has(dedupeKey)) continue;
          seenTagKeys.add(dedupeKey);
          tagRows.push({
            id: uuidv4(),
            org_id: orgId,
            scan_run_id: scanRunId,
            resource_type: 'host',
            resource_id: hostName,
            tag_key: key,
            tag_value: value,
            tag_source: tagSource,
          });
        }
      }
    }
  }

  try {
    await db.transaction(async (trx) => {
      if (hostRows.length > 0) await trx('hosts').insert(hostRows);
      if (hostResourceRows.length > 0) await trx('resources').insert(hostResourceRows);
      if (tagRows.length > 0) await trx('resource_tags').insert(tagRows);
    });
  } catch (err) {
    logger.error(`[${orgId}] Failed to store infrastructure data`, err);
  }

  // ── Fleet & installed-integration signals ──────────────────────────────────
  // Aggregate agent versions, platforms, and installed checks across all hosts.
  // The `apps` field (populated with with_apps=true) contains the integration/check
  // names actually running on each host — this is what powers /integrations?filter=installed.
  const agentVersions: Record<string, number> = {};
  const platforms: Record<string, number> = {};
  const installedChecks: Record<string, number> = {};

  for (const host of result.data) {
    const version = host.agent_version ?? host.meta?.agent_version ?? 'unknown';
    agentVersions[version] = (agentVersions[version] ?? 0) + 1;

    const platform = host.meta?.platform ?? 'unknown';
    platforms[platform] = (platforms[platform] ?? 0) + 1;

    for (const check of host.apps ?? []) {
      // apps contains check names like 'disk', 'cpu', 'aws', 'kubernetes', 'nginx', etc.
      const normalized = check.toLowerCase().trim();
      installedChecks[normalized] = (installedChecks[normalized] ?? 0) + 1;
    }
  }

  const now2 = new Date().toISOString();

  if (Object.keys(agentVersions).length > 0) {
    await db('product_usage_signals').insert({
      id: uuidv4(), org_id: orgId, scan_run_id: scanRunId, product: 'fleet', signal: 'agent_versions',
      value: JSON.stringify(agentVersions), detected: 1, evidence: null, checked_at: now2,
    });
  }
  if (Object.keys(platforms).length > 0) {
    await db('product_usage_signals').insert({
      id: uuidv4(), org_id: orgId, scan_run_id: scanRunId, product: 'fleet', signal: 'platforms',
      value: JSON.stringify(platforms), detected: 1, evidence: null, checked_at: now2,
    });
  }
  if (Object.keys(installedChecks).length > 0) {
    // Sort by host count descending, store top 100
    const sorted = Object.entries(installedChecks)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100);
    await db('product_usage_signals').insert({
      id: uuidv4(), org_id: orgId, scan_run_id: scanRunId, product: 'fleet', signal: 'installed_checks',
      value: JSON.stringify(Object.fromEntries(sorted)), detected: 1, evidence: null, checked_at: now2,
    });

    // Also upsert into integrations table so analytics/integrations pages see them
    const integrationRows: Record<string, unknown>[] = [];
    for (const [checkName, hostCount] of sorted) {
      // Skip Datadog built-in system checks — they're not "integrations"
      if (['disk', 'cpu', 'memory', 'io', 'network', 'ntp', 'load', 'uptime', 'datadog', 'agent'].includes(checkName)) continue;
      integrationRows.push({
        id: uuidv4(),
        org_id: orgId,
        scan_run_id: scanRunId,
        integration_name: checkName,
        integration_type: 'agent_check',
        status: 'installed',
        is_configured: 1,
        is_enabled: 1,
        raw_json: JSON.stringify({ host_count: hostCount }),
        first_seen: now2,
        last_seen: now2,
      });
    }
    if (integrationRows.length > 0) {
      await db('integrations').insert(integrationRows);
    }
  }

  logger.info(`[${orgId}] Collected ${result.itemCount} hosts in ${Date.now() - start}ms`);
  return {
    collector: 'infrastructure',
    status: 'success',
    itemCount: result.itemCount,
    durationMs: Date.now() - start,
    endpoint: result.endpoint,
    requestCount: result.requestCount,
    pageCount: result.pageCount,
    truncated: result.truncated,
    rateLimitRemaining: result.rateLimitRemaining,
  };
}

function flattenTags(tagsBySource?: Record<string, string[]>): string[] {
  if (!tagsBySource) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const sourceTags of Object.values(tagsBySource)) {
    for (const tag of sourceTags) {
      if (!seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
    }
  }
  return tags;
}

function parseTags(tags: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const tag of tags) {
    const colonIdx = tag.indexOf(':');
    if (colonIdx === -1) continue;
    const key = tag.slice(0, colonIdx).toLowerCase().trim();
    const value = tag.slice(colonIdx + 1).trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(value);
  }
  return map;
}

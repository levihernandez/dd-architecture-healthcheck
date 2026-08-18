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

  const insertHost = db.prepare(`
    INSERT OR REPLACE INTO hosts
      (id, org_id, scan_run_id, host_name, aliases, agent_version, platform,
       has_env_tag, has_service_tag, has_version_tag, has_team_tag, tag_count,
       raw_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTag = db.prepare(`
    INSERT OR REPLACE INTO resource_tags
      (id, org_id, scan_run_id, resource_type, resource_id, tag_key, tag_value, tag_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertHost2 = db.prepare(`
    INSERT OR REPLACE INTO resources
      (id, org_id, scan_run_id, resource_type, resource_id, resource_name,
       source_endpoint, first_seen, last_seen, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction((hosts: DDHost[]) => {
    for (const host of hosts) {
      const hostName = host.host_name || host.name;
      if (!hostName) continue;

      const allTags = flattenTags(host.tags_by_source);
      const tagMap = parseTags(allTags);

      const hasEnv = tagMap.has('env');
      const hasService = tagMap.has('service');
      const hasVersion = tagMap.has('version');
      const hasTeam = tagMap.has('team');

      const hostId = `${orgId}:host:${hostName}`;

      insertHost.run(
        uuidv4(), orgId, scanRunId, hostName,
        JSON.stringify(host.aliases ?? []),
        host.agent_version ?? host.meta?.agent_version ?? null,
        host.meta?.platform ?? null,
        hasEnv ? 1 : 0, hasService ? 1 : 0, hasVersion ? 1 : 0, hasTeam ? 1 : 0,
        allTags.length,
        safeJsonSnapshot(host),
        now, now
      );

      insertHost2.run(
        uuidv4(), orgId, scanRunId, 'host', hostName, hostName,
        '/api/v1/hosts', now, now, safeJsonSnapshot(host)
      );

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
            insertTag.run(
              uuidv4(), orgId, scanRunId, 'host', hostName,
              key, value, tagSource
            );
          }
        }
      }
    }
  });

  try {
    txn(result.data);
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

  const insertSignal = db.prepare(`
    INSERT OR REPLACE INTO product_usage_signals
      (id, org_id, scan_run_id, product, signal, value, detected, evidence, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now2 = new Date().toISOString();

  if (Object.keys(agentVersions).length > 0) {
    insertSignal.run(uuidv4(), orgId, scanRunId, 'fleet', 'agent_versions',
      JSON.stringify(agentVersions), 1, null, now2);
  }
  if (Object.keys(platforms).length > 0) {
    insertSignal.run(uuidv4(), orgId, scanRunId, 'fleet', 'platforms',
      JSON.stringify(platforms), 1, null, now2);
  }
  if (Object.keys(installedChecks).length > 0) {
    // Sort by host count descending, store top 100
    const sorted = Object.entries(installedChecks)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100);
    insertSignal.run(uuidv4(), orgId, scanRunId, 'fleet', 'installed_checks',
      JSON.stringify(Object.fromEntries(sorted)), 1, null, now2);

    // Also upsert into integrations table so analytics/integrations pages see them
    const insertInteg = db.prepare(`
      INSERT OR REPLACE INTO integrations
        (id, org_id, scan_run_id, integration_name, integration_type, status,
         is_configured, is_enabled, raw_json, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [checkName, hostCount] of sorted) {
      // Skip Datadog built-in system checks — they're not "integrations"
      if (['disk', 'cpu', 'memory', 'io', 'network', 'ntp', 'load', 'uptime', 'datadog', 'agent'].includes(checkName)) continue;
      insertInteg.run(
        uuidv4(), orgId, scanRunId, checkName, 'agent_check',
        'installed', 1, 1,
        JSON.stringify({ host_count: hostCount }),
        now2, now2
      );
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

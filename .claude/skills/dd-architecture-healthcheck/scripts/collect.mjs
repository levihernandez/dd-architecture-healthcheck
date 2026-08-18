#!/usr/bin/env node
// Collect exactly ONE resource domain. This is the seam that keeps the skill
// from ever hitting all 17 Datadog API surfaces in one shot: every invocation
// is scoped to a single --resource, writes its own snapshot file, and prints
// only a summary (never the raw payload) so the calling model's context stays
// small even for orgs with tens of thousands of hosts/monitors.
//
// Usage:
//   node collect.mjs --resource monitors --org myorg
//
// Requires DD_API_KEY / DD_APP_KEY / DD_SITE in the environment (never as args).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DDClient } from './lib/dd-client.mjs';
import { requireResource, RESOURCE_IDS } from './lib/resources.mjs';
import { recordRun } from './lib/snapshot-index.mjs';

function parseArgs(argv) {
  const args = { org: 'default' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--resource') args.resource = argv[++i];
    else if (argv[i] === '--org') args.org = argv[++i];
  }
  return args;
}

function summarize(resourceId, result) {
  // Multi-part resources (e.g. governance -> {teams, users, org, roles}) return
  // a plain object of sub-results rather than a single {status, data, itemCount}.
  if (result && typeof result === 'object' && !('status' in result)) {
    const parts = {};
    let anyError = false;
    for (const [key, sub] of Object.entries(result)) {
      parts[key] = {
        status: sub.status,
        itemCount: Array.isArray(sub.data) ? sub.data.length : sub.status === 'success' ? 1 : 0,
        error: sub.error,
      };
      if (sub.status === 'error') anyError = true;
    }
    return { resource: resourceId, status: anyError ? 'partial' : 'success', parts };
  }
  return {
    resource: resourceId,
    status: result.status,
    itemCount: result.itemCount ?? (result.status === 'success' ? 1 : 0),
    truncated: Boolean(result.truncated),
    requestCount: result.requestCount,
    error: result.error,
  };
}

async function main() {
  const { resource, org } = parseArgs(process.argv.slice(2));
  if (!resource) {
    console.error(`--resource is required. Valid values: ${RESOURCE_IDS.join(', ')}`);
    process.exit(1);
  }
  const def = requireResource(resource);
  const client = new DDClient();

  const startedAt = Date.now();
  const result = await def.fetch(client);
  const durationMs = Date.now() - startedAt;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(import.meta.dirname, '..', 'snapshots', org, resource);
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${timestamp}.json`);
  writeFileSync(outFile, JSON.stringify(result, null, 2));

  const summary = summarize(resource, result);
  recordRun({
    org,
    resource,
    timestamp,
    status: summary.status,
    itemCount: summary.itemCount ?? null,
    durationMs,
    filePath: outFile,
    error: summary.error ?? null,
  });

  console.log(JSON.stringify({ ...summary, durationMs, file: outFile }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

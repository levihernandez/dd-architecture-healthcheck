#!/usr/bin/env node
// Diffs two snapshot JSON files for the same resource — the trend/checkpoint
// capability: "what changed since last time" without re-fetching or re-reading
// full payloads. Works generically since Datadog list items commonly expose
// an id/name field.
import { readFileSync } from 'node:fs';

function idOf(item) {
  return item?.id ?? item?.name ?? item?.public_id ?? item?.attributes?.name ?? JSON.stringify(item).slice(0, 60);
}

function diffList(before, after) {
  const beforeIds = new Set(before.map(idOf));
  const afterIds = new Set(after.map(idOf));
  const added = after.filter((i) => !beforeIds.has(idOf(i))).map(idOf);
  const removed = before.filter((i) => !afterIds.has(idOf(i))).map(idOf);
  return { beforeCount: before.length, afterCount: after.length, added, removed };
}

function diffResult(before, after) {
  if (Array.isArray(before?.data) && Array.isArray(after?.data)) {
    return diffList(before.data, after.data);
  }
  return { beforeStatus: before?.status, afterStatus: after?.status, note: 'non-list payload — compare status only' };
}

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error('Usage: node snapshot-diff.mjs <before.json> <after.json>');
  process.exit(1);
}
const before = JSON.parse(readFileSync(fileA, 'utf8'));
const after = JSON.parse(readFileSync(fileB, 'utf8'));

let result;
if (before && typeof before === 'object' && !('status' in before)) {
  result = {};
  for (const key of Object.keys(before)) {
    result[key] = diffResult(before[key], after[key]);
  }
} else {
  result = diffResult(before, after);
}

console.log(JSON.stringify(result, null, 2));

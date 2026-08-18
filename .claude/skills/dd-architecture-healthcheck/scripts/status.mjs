#!/usr/bin/env node
// Shows the most recent snapshot per resource for an org, from the SQLite
// index — lets the model check "what's already collected and how stale is
// it" before deciding whether to spend more API calls.
import { latestPerResource } from './lib/snapshot-index.mjs';

const org = process.argv[2] || 'default';
const rows = latestPerResource(org);
if (!rows.length) {
  console.log(`No snapshots recorded yet for org "${org}".`);
  process.exit(0);
}
for (const r of rows) {
  console.log(`${r.resource.padEnd(20)} ${r.timestamp}  ${r.status}  items=${r.item_count ?? '-'}`);
}

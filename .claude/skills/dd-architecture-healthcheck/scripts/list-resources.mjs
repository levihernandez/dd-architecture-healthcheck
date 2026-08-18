#!/usr/bin/env node
// Lists the 17 collectible resource domains so the model/user can pick a
// subset before spending any API calls — the "menu" step.
import { RESOURCES } from './lib/resources.mjs';

for (const [id, def] of Object.entries(RESOURCES)) {
  console.log(`${id}${def.heavy ? '  [heavy]' : ''}\n  ${def.label} — ${def.why}\n`);
}

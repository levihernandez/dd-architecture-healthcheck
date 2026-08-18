---
name: dd-architecture-healthcheck
description: Audit a Datadog org's observability architecture directly via the Datadog API — no server, database, or laptop-hosted app required. Collects one resource domain at a time (infrastructure, monitors, dashboards, APM, logs, integrations, SLOs, governance, IDP, RUM, usage, security findings, cost management, incidents, events, service catalog, synthetics), takes point-in-time snapshots for trend tracking, and reasons over the results to produce findings — replacing the local dd-api-ai app's scan-orchestrator + rules engine with the invoking model's own analysis.
---

# Datadog Architecture Health Check (portable skill)

This skill re-implements the *collection* half of this repo's local app
(`backend/src/datadog/scan-orchestrator.ts` + its 17 collectors) as standalone
Node scripts that call the Datadog API directly — so a health check can run
inside a Claude/Copilot/Gemini session with no server, no SQLite app, nothing
to install (Node 18+ built-in `fetch`; Node 22+ built-in `node:sqlite`, both
already satisfied by this environment's Node 24).

The *analysis* half — turning raw resource data into findings — is
deliberately **not** ported. The local app has a hand-coded rules engine
(`backend/src/assessment/rules/*.ts`); this skill instead hands you (the
model) the collected JSON and expects you to reason over it the way you would
review any other data, citing specific findings back to the source file.

## Why resources are collected one at a time

A single "collect everything" pass across 17 API domains against a large org
means thousands of paginated requests, rate-limit backoff, and — worse for an
agent session — a flood of raw JSON that blows out context for no benefit.
Instead:

1. **Never default to collecting all 17 domains.** Ask the user which
   domains matter for their question, or pick a small default set yourself
   (see "Suggested defaults" below) and say which ones you picked and why.
2. **Each `collect.mjs` call scopes to exactly one `--resource`.** It writes
   its own snapshot file and prints only a *summary* (status, item count,
   truncated flag) to stdout — never the raw payload. Read the written JSON
   file directly (with the Read tool) only for the domains you're actually
   analyzing, and only the fields you need.
3. **Domains marked `[heavy]`** (infrastructure, apm, monitors, governance,
   security_findings, events) can legitimately be large for big orgs — run
   these individually and check `truncated` in the summary before assuming
   completeness.
4. **Sequence, don't parallelize**, when running more than one domain in a
   session — run one, look at its summary, decide if you need the next one,
   rather than firing off all requested collectors concurrently. This is
   also gentler on Datadog's per-org rate limits than the local app's
   sequential-but-uninterruptible scan loop.

## Setup (once per session)

Export credentials — never pass them as CLI arguments (they'd land in shell
history / process listings):

```bash
export DD_API_KEY=...
export DD_APP_KEY=...
export DD_SITE=datadoghq.com   # or datadoghq.eu, us3.datadoghq.com, etc.
```

If credentials live in OpenBao (see this repo's `[[reference_openbao_secrets]]`
memory — DD_API_KEY/DD_APP_KEY are stored as transit-encrypted values, not
plain KV), unwrap them into the environment first; this skill does not talk
to Vault itself, it only reads `DD_API_KEY`/`DD_APP_KEY`/`DD_SITE`.

## Commands

All scripts live in `scripts/` and are run with `node`, from any directory
(paths are resolved relative to the script, not the caller's cwd).

**See what's collectible before spending any API calls:**
```bash
node scripts/list-resources.mjs
```

**Collect one resource domain:**
```bash
node scripts/collect.mjs --resource monitors --org <short-label-for-this-org>
```
Writes `snapshots/<org>/<resource>/<timestamp>.json` and records the run in
`snapshots/index.db` (SQLite). Prints a summary object to stdout — read that
first before opening the JSON file.

**Check what's already been collected for an org** (avoid re-collecting if a
recent snapshot already answers the question):
```bash
node scripts/status.mjs <org>
```

**Diff two snapshots of the same resource** (the "checkpoint"/trend
capability — mirrors this repo's pricing-snapshot / sizing-snapshot tables):
```bash
node scripts/snapshot-diff.mjs snapshots/<org>/<resource>/<older>.json snapshots/<org>/<resource>/<newer>.json
```
Reports added/removed item ids and count deltas. Useful for usage, monitors,
dashboards, integrations — anything where "what changed since last audit"
matters more than a single-point-in-time count.

## Suggested defaults

If the user hasn't specified which domains they care about and just wants
"a health check," start with this small, fast, broadly-informative set
rather than all 17:

- `infrastructure` — host inventory and tag hygiene
- `monitors` — alerting coverage
- `dashboards` — dashboard sprawl
- `usage` — what's actually being consumed/billed

Expand from there based on what the user's question is actually about
(security → `security_findings`; RBAC → `governance`; cost → `usage` +
`cost_management`; service ownership → `service_catalog` + `idp`).

## Producing the report

Once you've collected the domains relevant to the question, read the
written JSON snapshot files for just those domains and write findings
directly in your response (or as a markdown file if the user wants a
document) — reference concrete data points (host counts, monitor names,
tag coverage percentages) rather than generic advice. This is the
"generate the app's output without running the app" step: you are the
assessment engine for this invocation.

## Files

```
scripts/
  lib/dd-client.mjs       fetch-based Datadog client: pagination, 429 backoff, rate-limit pacing
  lib/resources.mjs       registry of the 17 resource domains and their endpoint(s)
  lib/snapshot-index.mjs  SQLite (node:sqlite) run history
  collect.mjs             collect ONE resource, write snapshot + index entry
  list-resources.mjs      print the menu of collectible domains
  status.mjs              show latest snapshot per resource for an org
  snapshot-diff.mjs       diff two snapshots of the same resource
snapshots/                gitignored output: <org>/<resource>/<timestamp>.json + index.db
```

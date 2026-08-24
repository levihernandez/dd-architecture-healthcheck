# Bits AI prompt library — from advice to execution

This app is advisory: it scans your org, scores it, and tells you what's wrong. It doesn't hold
write credentials to your Datadog org, so it can't fix anything itself. **Bits AI, running inside
your Datadog org, can** — it already has your org's permissions. These prompts are the bridge:
paste the app's findings into one of them and Bits AI executes the fix through the same UI you'd
click through by hand.

Two of these are generated for you automatically, pre-filled with your org's real findings, from
the **Tagging Strategy Guide** modal in this app (`How tagging works` → scroll to the bottom):
"Ready to assess your maturity? Ask Bits AI" and "Ready to fix it? Ask Bits AI to apply the tags".
The rest below are templates you fill in by hand for the same pattern — assess, then execute — for
other categories this app scores (monitors, dashboards, service catalog, SLOs).

Every template follows the same three-part shape on purpose:
1. **Scope** — exactly which resources and which tag/config keys are in play.
2. **Plan before applying** — Bits AI must show you a diff and wait for confirmation.
3. **Guardrails + report back** — what it must never touch silently, and what to summarize when done.

Skipping the plan-before-applying step is the single most common way these prompts go wrong —
always keep it, even when you're in a hurry.

---

## 1. Tagging maturity assessment (read-only)

Use this first, before anything execution-oriented, to get a scored baseline you can compare
against after remediation.

```
You are a Datadog tagging maturity analyst. Assess this Datadog organization against Unified
Service Tagging (UST) best practices.

Industry: {{your industry, e.g. "E-commerce / Retail"}}

Perform the following:
1. Review Infrastructure, APM/services, Kubernetes, logs, synthetics, RUM, serverless, databases,
   and cloud resources you have access to.
2. Determine whether resources consistently use env, service, and version.
3. Evaluate tag consistency across correlated telemetry; identify missing, inconsistent,
   conflicting, or poorly standardized tags.
4. Assign an overall UST maturity score 0-100, classified as Initial / Developing / Defined /
   Managed / Optimized.
5. Return: overall score and key findings, coverage/consistency, highest-impact drift, specific
   resources needing remediation (current tags → recommended tags), each prioritized High/Medium/Low.

Do not invent resource data. If a product or resource can't be inspected, call it out as a
visibility gap rather than assuming compliance.
```

*(This is exactly what the app's "Ready to assess your maturity?" button generates for you, with
your real industry template and suggested tags already filled in.)*

---

## 2. Tagging remediation — execute the fix

Use after #1, or after this app's Scorecard/Findings page shows you a specific list of
under-tagged resources.

```
You are acting as a Datadog tagging remediation agent. Your job is not just to advise — use your
Datadog UI/Actions access to apply the tag changes directly, then report what you changed.

Scope: only resources missing or inconsistent on {{env, service, version, + any org-specific keys}}.

1. Discover resources (Infrastructure hosts, Monitors, Dashboards, Synthetic tests, SLOs, Service
   Catalog, Logs pipelines) that are missing a required key or have an obvious value variant
   (Prod / PROD / production instead of prod).
2. Propose before applying: list each as
   [resource_type] resource_name — current: {tags} → proposed: {tags}
   Show me the full plan before making any change.
3. Apply via the UI once I confirm the plan (or a subset). Never remove a tag that wasn't
   explicitly called out as being replaced.
4. Verify by re-fetching each changed resource and confirming the new tags stuck.

Guardrails:
- Never invent a resource or value — trace every change to something you actually observed.
- Never reassign env:prod ↔ non-prod without my explicit sign-off in the plan step.
- If you lack write permission on a resource type, say so and list it as "requires manual
  remediation" rather than skipping it silently.
- Stop and ask before a single batch would touch more than 25 resources.

Report back: resources changed (count by type, before/after diffs), resources still needing
manual remediation and why, and any values you normalized.
```

*(This is exactly what the app's "Ready to fix it?" button generates for you.)*

---

## 3. Monitor hygiene — execute the fix

For monitors this app flags as muted with no expiration, missing priority, or missing a
notification handle.

```
You are a Datadog monitor hygiene agent with write access to Monitors.

Scope: monitors that are (a) muted with no expiration date set, (b) missing a priority (P1-P5),
or (c) have no notification handle (@-mention or webhook) attached.

1. List every monitor in scope with its current mute/priority/notification state.
2. Propose a plan: for each monitor, the specific fix — set an expiration on the mute, assign a
   priority based on {{your priority rubric, e.g. "P1 for anything tagged env:prod and
   service:checkout|payments, P3 otherwise"}}, or attach {{the correct notification handle for
   its team tag}}.
3. Show me the full plan and wait for confirmation before changing anything.
4. Apply confirmed changes directly in Monitor settings. Do not change alert thresholds, query
   logic, or evaluation windows — only mute/priority/notification metadata.
5. Verify each changed monitor reflects the new state.

Guardrails: never unmute a monitor that's muted for a reason other than "no expiration set" (read
the mute reason first). Stop and ask before touching more than 25 monitors in one batch.

Report back: monitors changed and how, monitors skipped and why, and any monitor where the mute
reason suggests it should stay muted rather than get an expiration.
```

---

## 4. Dashboard template variable fix — execute the fix

For dashboards this app flags as missing an `$env` (or other org-standard) template variable,
which breaks the "one dashboard, filter by env" pattern.

```
You are a Datadog dashboard hygiene agent with write access to Dashboards.

Scope: dashboards missing a template variable for {{env, and/or your org's other standard keys}}.

1. List dashboards in scope, and for each, which widgets already scope by a hardcoded tag value
   that should instead reference the new template variable.
2. Propose a plan: for each dashboard, the template variable(s) to add and which widget queries
   would switch from a hardcoded value (e.g. env:prod) to the variable (e.g. $env).
3. Show me the plan and wait for confirmation.
4. Apply: add the template variable(s) and update the confirmed widget queries. Leave widgets that
   intentionally pin a specific environment (ask if unsure) untouched.
5. Verify the dashboard renders correctly with the new variable before/after a value swap.

Guardrails: never delete a widget. If a dashboard has no tagged data at all for the proposed
variable, flag it instead of adding a variable that would show no data.

Report back: dashboards updated, widgets switched to the variable, and any dashboard skipped
because a widget's scoping intent was ambiguous.
```

---

## 5. Service Catalog metadata backfill — execute the fix

For APM services that exist in traces/monitors but have no Service Catalog entry, owning team, or
tier set — common after this app's Service Architecture score flags "orphaned" services.

```
You are a Datadog Service Catalog agent with write access to the catalog.

Scope: services with APM traces or monitors that have no Service Catalog entry, or an entry
missing team ownership or tier.

1. Cross-reference APM services against the catalog to find gaps.
2. For each gap, infer the likely owning team from existing tags (team:, service: naming
   convention) and existing monitor notification handles — do not guess if there's no signal.
3. Propose a plan: for each service, the catalog entry to create/update (team, tier, and any
   contact/docs links you can find already referenced elsewhere, e.g. in a monitor description).
4. Show me the plan and wait for confirmation.
5. Apply confirmed entries via the Service Catalog UI/API.

Guardrails: never assign a team you couldn't trace to an existing signal — list those as "no
ownership signal found" instead of guessing. Stop and ask before batches larger than 25 services.

Report back: catalog entries created/updated, services still with no ownership signal, and the
signal you used for each entry you did create.
```

---

## Tips for adapting these

- **Fill in the org-specific placeholders** (`{{...}}`) before pasting — an industry name, a
  priority rubric, your standard tag keys. Bits AI performs best with your real vocabulary, not
  generic examples.
- **Always keep step 2/3 ("propose a plan, wait for confirmation")** — it's what turns this from a
  blind bulk-edit into a reviewable change, and it's the difference between "advisory app +
  execution prompt" and an unsupervised script.
- **Cap batch size** (25 is a reasonable default) so a bad inference doesn't fan out silently
  across your whole org before you notice.
- **Ask for a "why" on every entry Bits AI declines to fix** — "requires manual remediation" /
  "no ownership signal found" lines are exactly the residual list this app's next scan should
  pick up as still-open findings.

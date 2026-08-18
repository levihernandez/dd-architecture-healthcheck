---
mode: agent
description: Run a Datadog architecture health check via the Datadog API — no local server/app required.
---
Follow the instructions in `.claude/skills/dd-architecture-healthcheck/SKILL.md` in this
repo. That file is the source of truth — read it first, then use its
`scripts/collect.mjs`, `scripts/list-resources.mjs`, `scripts/status.mjs`, and
`scripts/snapshot-diff.mjs` (run via the terminal tool) to collect Datadog
resource data one domain at a time and produce findings.

Do not invent a different collection approach — this prompt file only points
at the shared scripts so Copilot and Claude stay in sync; the skill file has
the full logic on scoping, defaults, and how to avoid calling all 17 resource
domains at once.

Before running anything, confirm `DD_API_KEY`, `DD_APP_KEY`, and `DD_SITE`
are set in the environment — do not ask the user to paste key values into
chat.

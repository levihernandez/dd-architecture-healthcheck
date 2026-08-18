# Datadog Architecture Health Check

A production-quality, local-first web application for auditing and improving Datadog observability architecture. Connect one or more Datadog organizations, collect a comprehensive inventory, run deterministic health checks, generate scored findings, and optionally use AI to produce executive-ready assessment reports.

## Features

- **Multi-org support** — connect multiple Datadog organizations
- **Read-only API access** — only GET requests, never modifies your Datadog config
- **Encrypted credential storage** — AES encryption, never logged or exported
- **18-page React UI** — inventory explorer, scorecard, per-product health pages
- **Assessment engine** — 20+ deterministic rules across 9 categories
- **Unified Service Tagging analysis** — env/service/version coverage with tag mapping suggestions
- **AI assessment** — optional OpenAI or Anthropic integration for executive summaries and remediation plans
- **Export** — JSON, CSV, Markdown, and printable HTML reports
- **SQLite storage** — all data local, no cloud dependencies

## Quick Start

There are two ways to run this: **standalone** (`npm run dev`, no containers) or **Docker/Podman**. Both read from the same `.env` file.

### Fastest path — the setup wizard

```bash
npm install:all
npm run init
```

This interactive wizard asks about run mode (standalone vs. Docker), HTTPS, Datadog observability (APM/RUM/Agent), OpenBao, and AI provider, then writes `.env` (and `.compose-files` for Docker mode) for you — including generating `ENCRYPTION_KEY`. Then:

```bash
npm run dev          # standalone mode
# or
npm run docker:up    # Docker/Podman mode
```

### Doing it by hand — standalone

```bash
cd dd-api-ai
npm install
npm install --workspace=backend
npm install --workspace=frontend
cp .env.example backend/.env
```

Edit `backend/.env`:

```env
# Required
ENCRYPTION_KEY=<generate with: openssl rand -base64 32>
PORT=3001

# Optional AI assessment
AI_PROVIDER=anthropic       # or: openai, ollama, none
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
npm run dev
# or individually:
npm run dev --workspace=backend   # http://localhost:3001
npm run dev --workspace=frontend  # http://localhost:5173
```

Open **http://localhost:5173** and connect your first Datadog organization.

**To stop:** `npm run dev` runs both servers in the foreground — press `Ctrl+C` once to stop them (or in the terminal running that specific workspace, if started individually).

### Doing it by hand — Docker/Podman

```bash
cp .env.example .env
npm run docker:up      # build + start
npm run docker:down    # stop (add -v to also remove the certs volume, if HTTPS was enabled)
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

For HTTPS, the Datadog Agent, OpenBao secret resolution, and combinations of the three, see **[docker-compose.md](docker-compose.md)** — it covers every overlay and the `scripts/deploy.sh` flags that wire them together.

### Startup options reference

| Mode | Command | Notes |
|---|---|---|
| Standalone (dev servers) | `npm run dev` | No containers; fastest for local iteration |
| Standalone + HTTPS | set `HTTPS_ENABLED=true` in `.env`, then `npm run dev` | Self-signed cert auto-generated at `./certs/` |
| Docker/Podman (base) | `npm run docker:up` / `npm run docker:down` | Builds `frontend` + `backend` containers |
| Docker/Podman + HTTPS | `scripts/deploy.sh --https up -d --build` | TLS terminated at nginx, self-signed by default |
| Docker/Podman + Datadog Agent | `scripts/deploy.sh --observability up -d --build` | Adds Agent container, wires APM/DogStatsD |
| Docker/Podman + OpenBao | `scripts/deploy.sh --openbao up -d --build` | Resolves `ENC[...]` secrets via Vault transit |
| Docker/Podman + all three | `scripts/deploy.sh --observability --openbao --https up -d --build` | Full stack |

`scripts/compose.sh` auto-detects `docker compose` vs. `podman compose` (override with `COMPOSE_ENGINE`), and `.compose-files` remembers whichever overlays you last applied — so however you started it (plain `npm run docker:up` or a `scripts/deploy.sh --...` combination), **`npm run docker:down`** (or the equivalent `scripts/deploy.sh --... down`) stops it and reuses the same overlays. Full details, overlay-by-overlay, in **[docker-compose.md](docker-compose.md)**.

---

## Usage

### Connecting an Organization

1. Go to **Org Connections** → **Add Organization**
2. Enter a display name, select your Datadog site, and paste your API key + Application key
3. The app validates credentials with a harmless `/api/v1/validate` call before saving
4. Keys are AES-encrypted and stored in SQLite — never plaintext, never logged

### Running a Scan

1. On **Overview** or **Scan Runs**, click **Run Scan**
2. The scan runs asynchronously, collecting data from 10 collectors
3. View progress and collector results in real-time on the Scan Runs page
4. Assessment engine automatically runs after collection (~5-30 seconds for full scan)

### Understanding the Scorecard

| Grade | Score | Meaning |
|-------|-------|---------|
| Excellent | 90-100 | Best practices followed |
| Good | 75-89 | Minor gaps, low risk |
| Needs Attention | 50-74 | Gaps affecting observability |
| Critical | < 50 | Significant gaps, action required |

### Assessment Categories

| Category | Weight | Key Checks |
|----------|--------|------------|
| Unified Tagging | 30% | env/service/version coverage on hosts, monitors, synthetics |
| Service Architecture | 20% | Service catalog, ownership, monitors, SLOs |
| Monitors Health | 15% | Muted monitors, missing priorities, notification routing |
| Logs Health | 10% | Index filters, pipeline coverage, rate limiting |
| Dashboards Health | 5% | Template variables, widget count |
| Synthetics Health | 5% | Tagging, notifications, multi-location |
| Integration Hygiene | 8% | Cloud account errors, notification integrations |
| Network & Cloud | 4% | Cloud account status |
| Governance | 3% | Teams, SSO status (high-level only) |

### AI Assessment

The AI assessment receives only normalized, non-secret scan summaries (finding counts, tag coverage percentages, inventory counts). It never receives API keys, raw host data, or any secrets.

To enable:
1. Set `AI_PROVIDER=anthropic` or `AI_PROVIDER=openai` in `backend/.env`
2. Set your API key for the chosen provider
3. Run a scan, then navigate to **AI Assessment** and click **Generate Assessment**

---

## Architecture

```
dd-api-ai/
├── backend/                    # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── server.ts           # Express app entry point
│   │   ├── db/
│   │   │   ├── schema.ts       # SQLite migrations (20+ tables)
│   │   │   ├── database.ts     # Connection management
│   │   │   └── repositories/   # Type-safe DB access
│   │   ├── datadog/
│   │   │   ├── client.ts       # Axios-based DD API client
│   │   │   ├── scan-orchestrator.ts
│   │   │   └── collectors/     # 10 product-specific collectors
│   │   ├── assessment/
│   │   │   ├── engine.ts       # Runs all rules
│   │   │   ├── scorer.ts       # Category scores & grading
│   │   │   └── rules/          # 20+ deterministic checks
│   │   ├── ai/
│   │   │   ├── service.ts      # Orchestrates AI calls
│   │   │   ├── prompts.ts      # Evidence-grounded prompts
│   │   │   └── providers/      # OpenAI + Anthropic
│   │   └── api/routes/         # Express REST routes
│   └── tests/                  # Jest unit tests
│       ├── fixtures/           # Mock DD API responses
│       └── rules/              # Rule engine tests
└── frontend/                   # React + TypeScript + Vite
    └── src/
        ├── pages/              # 18 pages
        ├── components/         # Layout, common, charts, forms
        ├── hooks/              # React Query hooks
        ├── services/           # API client wrapper
        └── types/              # Shared TypeScript types
```

## Data Model (SQLite)

Key tables:
- `orgs` — org connections
- `api_credentials_metadata` — encrypted keys, never plaintext
- `scan_runs` — scan history and status
- `hosts` — infrastructure inventory with tag coverage flags
- `services` — APM services with catalog/monitor/SLO cross-references
- `monitors` — monitor inventory with notification/tag flags
- `dashboards`, `synthetics_tests`, `logs_indexes`, `logs_pipelines`
- `integrations`, `cloud_accounts`
- `slos`, `service_catalog`
- `resource_tags` — normalized tag store
- `tag_analysis` — aggregated tag statistics with mapping suggestions
- `findings` — assessment results with evidence
- `scorecards` — computed scores by category
- `ai_assessments` — stored AI responses
- `permissions_report` — which endpoints succeeded/failed per scan
- `product_usage_signals` — SSO status, user counts, etc.

No separate init/migrate command to run — the backend creates the SQLite file and applies idempotent migrations automatically on first startup (`runMigrations()` in `backend/src/db/schema.ts`). To reset to a clean database, stop the app and delete `./data/` (standalone) or `./backend/data/` (Docker), then start again.

## Datadog API Endpoints Used

All endpoints are read-only (GET requests only):

| Collector | Endpoints |
|-----------|-----------|
| Infrastructure | `GET /api/v1/hosts` |
| APM | `GET /api/v1/services` |
| Service Catalog | `GET /api/v2/catalog/entity` |
| Monitors | `GET /api/v1/monitor` |
| Dashboards | `GET /api/v1/dashboard` |
| Synthetics | `GET /api/v1/synthetics/tests` |
| Logs | `GET /api/v1/logs/config/indexes`, `.../pipelines` |
| Integrations | `GET /api/v1/integration/aws|azure|gcp` |
| SLOs | `GET /api/v1/slo` |
| Governance | `GET /api/v2/teams`, `/api/v2/users`, `/api/v1/org`, `/api/v2/roles` |

## Security

- **No write API calls** — all Datadog operations are read-only
- **Encrypted storage** — API/App keys AES-encrypted with your `ENCRYPTION_KEY`
- **No key logging** — keys never appear in logs, exports, or console output
- **Secret redaction** — all raw JSON snapshots are sanitized before storage
- **AI isolation** — AI providers receive only anonymized summaries, never credentials or raw data
- **SSO handling** — only high-level enablement flags collected, no IdP metadata or certificates
- **Session-only mode** — option to not persist credentials at all
- **Optional HTTPS** — self-signed TLS for local/standalone use, or bring your own cert; see [docker-compose.md](docker-compose.md#docker--https)

## Running Tests

```bash
npm run test --workspace=backend
```

Tests cover:
- Rule engine (unified tagging rules, severity thresholds)
- Scorer (grade calculation, category weighting)
- In-memory SQLite fixtures for deterministic rule testing

## API Reference

| Method | Path | Description |
|--------|------|--------------|
| GET | `/api/orgs` | List organizations |
| POST | `/api/orgs` | Create org (validates credentials) |
| DELETE | `/api/orgs/:id` | Remove org and all data |
| POST | `/api/orgs/:id/validate` | Test credentials |
| POST | `/api/scans` | Start async scan |
| GET | `/api/scans?orgId=` | List scans for org |
| GET | `/api/scans/:id/scorecard` | Get scorecard |
| GET | `/api/scans/:id/findings` | Get findings |
| GET | `/api/scans/:id/permissions` | Get API permissions report |
| GET | `/api/inventory/hosts` | Paginated host list |
| GET | `/api/inventory/services` | Paginated service list |
| GET | `/api/inventory/tags` | Tag analysis |
| GET | `/api/inventory/summary` | Inventory counts |
| POST | `/api/ai/assess` | Generate AI assessment |
| GET | `/api/ai/assess/:scanRunId` | Get stored assessment |
| GET | `/api/export/:scanRunId?format=` | Export (json/csv/markdown/html) |
| GET | `/health` | Health check |

## `.env` reference

Copy `.env.example` to `.env` (standalone: `backend/.env`) and fill in what you need — see that file's inline comments for the full list (server port, encryption key, AI provider, HTTPS, CORS, Datadog credentials, APM/RUM, OpenBao). `npm run init` fills most of it in interactively.

## License

Internal tool — for authorized Datadog Architecture Health Check engagements only.

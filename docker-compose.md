# Running with Docker / Podman

The base `docker-compose.yaml` builds and runs two containers — `frontend`
(nginx + built SPA) and `backend` (Node/Express API) — and needs nothing else
installed. Everything beyond that (HTTPS, the Datadog Agent, OpenBao secret
resolution) is layered on with **overlay files**, so the base stack never has
to be edited.

`scripts/compose.sh` auto-detects `docker compose` or `podman compose`
(override with `COMPOSE_ENGINE`) and always applies whatever overlays are
listed in `.compose-files`, so plain `npm run docker:up`/`:down` stay in sync
once you've chosen a combination.

## Quick start

```bash
cp .env.example .env   # fill in values you need
npm run docker:up      # build + start
npm run docker:down    # stop
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

Or let the wizard do it for you — `npm run init` asks about HTTPS,
observability, and OpenBao, then writes the right combination to
`.compose-files` automatically.

## Adding overlays with `scripts/deploy.sh`

```bash
scripts/deploy.sh [--https] [--openbao] [--observability] <compose-args...>

# examples
scripts/deploy.sh up -d --build                                     # base stack only
scripts/deploy.sh --https up -d --build                             # + TLS at nginx
scripts/deploy.sh --observability up -d --build                     # + Datadog Agent container
scripts/deploy.sh --openbao up -d --build                           # + OpenBao secret resolution
scripts/deploy.sh --observability --openbao --https up -d --build   # all three
scripts/deploy.sh --observability --openbao --https down
```

`deploy.sh` resolves the right `-f` flags and writes them to
`.compose-files`, so a later plain `npm run docker:up`/`:down` (without
re-specifying flags) keeps using the same combination.

## Overlay reference

| Overlay | Effect |
|---|---|
| `docker-compose.https.yaml` | Terminates TLS at the frontend nginx container (self-signed cert by default) |
| `docker-compose.observability.yaml` | Adds a Datadog Agent container; wires backend APM + DogStatsD to it |
| `docker-compose.openbao.yaml` | Resolves `ENC[...]` secrets in the backend via OpenBao transit |
| `docker-compose.observability-openbao.yaml` | Auto-included when both `--observability` and `--openbao` are set — lets the Agent itself decrypt `DD_API_KEY`/`DD_APP_KEY` |

If you'd rather assemble the `-f` flags yourself instead of using
`deploy.sh`, any combination of the files above works with
`docker compose -f docker-compose.yaml -f <overlay...> up -d --build`.

---

## Docker + HTTPS

```bash
scripts/deploy.sh --https up -d --build
```

TLS terminates at the frontend nginx container:
- `frontend/nginx.https.conf` — nginx listens on 443, proxies `/api` to the
  backend over plain HTTP on the internal docker network (same-origin for the
  browser, so no CORS and RUM trace-propagation headers pass through intact);
  port 80 just 301-redirects to the TLS port.
- `frontend/docker-entrypoint.sh` — generates a self-signed cert on first
  start into the `dd-api-ai-certs` volume (so it persists across restarts
  instead of regenerating — and re-triggering browser trust warnings — every
  time). Mount your own cert/key at `/etc/nginx/certs/{cert,key}.pem` instead
  if you have one from a real CA.

- Frontend: **https://localhost:8443**
- Backend: https://localhost:3001 *(only if standalone HTTPS is also enabled — see below; the backend itself stays HTTP-only inside Docker, reached only through the nginx proxy)*

Browsers will warn about the self-signed cert — expected for local HTTPS.

Standalone (non-Docker) runs can enable backend HTTPS directly instead, via
`HTTPS_ENABLED=true` in `.env` — see `backend/src/server.ts` and
`backend/src/utils/tls.ts`, which generates its own self-signed cert at
`./certs/cert.pem` / `./certs/key.pem` on first start.

## Docker + observability (Datadog Agent)

```bash
scripts/deploy.sh --observability up -d --build
```

Starts a Datadog Agent container and wires backend APM traces + DogStatsD
metrics to it. Set `DD_API_KEY` in `.env` first (plain value, or an OpenBao
`ENC[...]` ciphertext if you're also using the OpenBao overlay).

## Docker + OpenBao (secrets via Vault transit)

```bash
scripts/deploy.sh --openbao up -d --build
```

Resolves any `ENC[vault:v1:...]` value in `.env` (e.g. `DD_API_KEY`,
`DD_APP_KEY`) through an OpenBao transit key before the backend reads it (see
`backend/src/utils/secrets.ts`). Requires an OpenBao server reachable at
`BAO_ADDR` with a userpass login (`BAO_USERNAME`/`BAO_PASSWORD`), plus
`BAO_NAMESPACE` and `BAO_CACERT` set in `.env`.

## Docker + observability + OpenBao together

```bash
scripts/deploy.sh --observability --openbao up -d --build
```

Also pulls in `docker-compose.observability-openbao.yaml`, which lets the
Agent container itself decrypt `DD_API_KEY`/`DD_APP_KEY` — only needed at
this specific intersection of the two overlays.

---

## Database

No separate init/migrate command to run — the backend does it automatically
on startup.

- On the first call to `getDatabase()` (during server boot,
  `backend/src/server.ts`), `better-sqlite3` opens the file at `DB_PATH`
  (`./backend/data/health-check.db` in Docker — see the `backend` volume
  mount in `docker-compose.yaml`), creating the directory and file if they
  don't exist.
- `runMigrations()` (`backend/src/db/schema.ts`) then runs idempotent
  `CREATE TABLE IF NOT EXISTS` statements for all tables, plus a few one-off
  data migrations. Safe to run on every startup — already-applied changes are
  skipped.
- WAL mode is enabled, so `health-check.db-shm` and `health-check.db-wal`
  alongside `health-check.db` is normal.
- The db file lives on the host at `./backend/data/`, so it survives
  `docker:down`/`docker:up` cycles and image rebuilds. Delete that directory
  to reset to a clean database.

## `.env` reference

Copy `.env.example` to `.env` and fill in what you need — see that file's
inline comments for the full list (server port, encryption key, AI provider,
HTTPS, CORS, Datadog credentials, APM/RUM, OpenBao). `npm run init` fills
most of it in interactively, including generating `ENCRYPTION_KEY` for you.

See the main [README.md](README.md) for app features, usage, and the
standalone (non-Docker) run mode.

#!/usr/bin/env bash
# Interactive setup wizard: generates .env from .env.example and (for Docker
# mode) writes .compose-files so `npm run docker:up` applies the right set
# of overlays. Safe to re-run — it only overwrites .env after confirming.
set -euo pipefail
cd "$(dirname "$0")/.."

BLUE=$'\033[1;34m'; GREEN=$'\033[1;32m'; DIM=$'\033[2m'; RESET=$'\033[0m'

heading() { echo; echo "${BLUE}== $1 ==${RESET}"; }

ask_yn() {
  local prompt="$1" default="$2" reply
  local hint="y/n"
  [[ "$default" == "y" ]] && hint="Y/n" || hint="y/N"
  read -r -p "$prompt [$hint] " reply || true
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy] ]]
}

ask() {
  local prompt="$1" default="$2" reply
  read -r -p "$prompt ${DIM}[$default]${RESET} " reply || true
  echo "${reply:-$default}"
}

echo "${BLUE}Datadog Architecture Health Check — setup${RESET}"
echo "${DIM}Answer a few questions; this writes .env (and .compose-files for Docker).${RESET}"

if [[ -f .env ]]; then
  if ! ask_yn "An .env already exists. Overwrite it?" "n"; then
    echo "Keeping existing .env. Re-run without changes needed, or edit .env by hand."
    exit 0
  fi
fi

# ---------------------------------------------------------------- run mode
heading "Run mode"
echo "  1) Standalone — npm run dev, no containers, no Agent required"
echo "  2) Docker / Podman — docker-compose stack (frontend, backend, optional Agent)"
mode="$(ask "Choice" "1")"
[[ "$mode" == "2" ]] && RUN_MODE=docker || RUN_MODE=standalone

# ------------------------------------------------------------ deployment target
heading "Deployment target"
echo "  1) Local development — just you, on your own machine"
echo "  2) Shared / production — a real internal deployment other people will log into"
deploy_choice="$(ask "Choice" "1")"
NODE_ENV_VAL="development"
ALLOWED_EMAIL_DOMAINS_VAL=""
DB_CLIENT_VAL="sqlite"
DATABASE_URL_VAL=""
CORS_ORIGIN_VAL=""
if [[ "$deploy_choice" == "2" ]]; then
  NODE_ENV_VAL="production"
  echo "  ${DIM}These map directly to the checklist in README.md#before-deploying-beyond-your-own-laptop.${RESET}"

  ALLOWED_EMAIL_DOMAINS_VAL="$(ask "  Restrict self-registration to these email domains (comma-separated, blank = open to anyone)" "")"

  echo "  Database:"
  echo "    1) SQLite — fine for light/low-concurrency use"
  echo "    2) Postgres — recommended for real concurrent multi-user load"
  db_choice="$(ask "  Choice" "2")"
  if [[ "$db_choice" == "2" ]]; then
    DB_CLIENT_VAL="postgres"
    DATABASE_URL_VAL="$(ask "  DATABASE_URL (postgres://user:pass@host:5432/dbname)" "")"
  fi

  while [[ -z "$CORS_ORIGIN_VAL" ]]; do
    CORS_ORIGIN_VAL="$(ask "  Real hostname the frontend will be served from (e.g. https://health-check.internal.example.com)" "")"
    [[ -z "$CORS_ORIGIN_VAL" ]] && echo "  ${DIM}Required for a shared deployment — CORS will otherwise reject the frontend's own requests.${RESET}"
  done
else
  echo "  ${DIM}Local dev — self-registration stays open, SQLite, CORS_ORIGIN left at the localhost default.${RESET}"
fi

# ------------------------------------------------------------ observability
heading "Datadog observability"
OBSERVABILITY=false
APM=false
RUM=false
if ask_yn "Enable any Datadog observability for this app (APM traces, RUM, container Agent)?" "n"; then
  OBSERVABILITY=true
  ask_yn "  Include APM tracing (backend, via dd-trace)?" "y" && APM=true
  ask_yn "  Include RUM + Session Replay (frontend, browser SDK)?" "n" && RUM=true
  if [[ "$RUN_MODE" == "docker" ]]; then
    ask_yn "  Run a local Datadog Agent container (needed for APM/DogStatsD in Docker mode)?" "y" && RUN_AGENT=true || RUN_AGENT=false
  else
    RUN_AGENT=false
    echo "  ${DIM}Standalone mode: point DD_AGENT_HOST at an Agent you already have running, or leave it — traces just won't be collected without one.${RESET}"
  fi
else
  echo "  ${DIM}Skipping observability — DD_TRACE_ENABLED=false, RUM stays unconfigured, no Agent.${RESET}"
  RUN_AGENT=false
fi

DD_API_KEY_VAL=""
DD_APP_KEY_VAL=""
DD_SITE_VAL="datadoghq.com"
VITE_RUM_APP_ID=""
VITE_RUM_CLIENT_TOKEN=""
if [[ "$OBSERVABILITY" == true ]]; then
  DD_SITE_VAL="$(ask "  Datadog site" "datadoghq.com")"
  if [[ "$APM" == true && "$RUN_AGENT" == true ]]; then
    DD_API_KEY_VAL="$(ask "  DD_API_KEY (plain value, or paste an ENC[...] ciphertext, blank to fill in later)" "")"
    DD_APP_KEY_VAL="$(ask "  DD_APP_KEY (plain value, or ENC[...], blank to fill in later)" "")"
  fi
  if [[ "$RUM" == true ]]; then
    VITE_RUM_APP_ID="$(ask "  RUM Application ID (blank to fill in later)" "")"
    VITE_RUM_CLIENT_TOKEN="$(ask "  RUM Client Token (blank to fill in later)" "")"
  fi
fi

# --------------------------------------------------------------------- HTTPS
heading "HTTPS"
HTTPS_ENABLED=false
if ask_yn "Serve over HTTPS instead of plain HTTP?" "n"; then
  HTTPS_ENABLED=true
  if [[ "$RUN_MODE" == "docker" ]]; then
    echo "  ${DIM}A self-signed cert is generated automatically on first start (frontend/docker-entrypoint.sh).${RESET}"
    echo "  ${DIM}Bring your own cert instead by mounting it at /etc/nginx/certs/{cert,key}.pem.${RESET}"
  else
    echo "  ${DIM}A self-signed cert is generated automatically on first start (./certs/cert.pem, ./certs/key.pem).${RESET}"
    echo "  ${DIM}Browsers will warn about it being self-signed — that's expected for local HTTPS.${RESET}"
  fi
fi

# ------------------------------------------------------------------ OpenBao
heading "Secrets"
OPENBAO=false
if ask_yn "Resolve secrets via OpenBao/Vault transit (ENC[...] ciphertext) instead of plain values in .env?" "n"; then
  OPENBAO=true
  echo "  ${DIM}You'll still need an OpenBao server reachable (BAO_ADDR) with a userpass login and an 'ai-app' transit key.${RESET}"
  BAO_ADDR_VAL="$(ask "  BAO_ADDR (from the host, e.g. https://127.0.0.1:8200)" "https://127.0.0.1:8200")"
  BAO_NAMESPACE_VAL="$(ask "  BAO_NAMESPACE" "datadog")"
  BAO_CACERT_VAL="$(ask "  BAO_CACERT path (CA cert used to verify the OpenBao server)" "/path/to/openbao/certs/ca.pem")"
  BAO_USERNAME_VAL="$(ask "  BAO_USERNAME" "")"
  BAO_PASSWORD_VAL="$(ask "  BAO_PASSWORD" "")"
else
  BAO_ADDR_VAL=""
  BAO_NAMESPACE_VAL=""
  BAO_CACERT_VAL=""
  BAO_USERNAME_VAL=""
  BAO_PASSWORD_VAL=""
fi

# ---------------------------------------------------------------------- AI
heading "AI assessment (optional)"
echo "  1) none     2) ollama (local)     3) openai     4) anthropic"
ai_choice="$(ask "Choice" "1")"
case "$ai_choice" in
  2) AI_PROVIDER=ollama ;;
  3) AI_PROVIDER=openai ;;
  4) AI_PROVIDER=anthropic ;;
  *) AI_PROVIDER=none ;;
esac
OPENAI_KEY=""; ANTHROPIC_KEY=""
[[ "$AI_PROVIDER" == "openai" ]] && OPENAI_KEY="$(ask "  OPENAI_API_KEY" "")"
[[ "$AI_PROVIDER" == "anthropic" ]] && ANTHROPIC_KEY="$(ask "  ANTHROPIC_API_KEY" "")"

# ------------------------------------------------------------- write .env
heading "Writing configuration"

ENCRYPTION_KEY_VAL="$(openssl rand -base64 32)"
JWT_SECRET_VAL="$(openssl rand -base64 32)"

cp .env.example .env

set_env() {
  local key="$1" value="$2"
  local escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[&/\]/\\&/g')
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${escaped}|" .env
    rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}

set_env ENCRYPTION_KEY "$ENCRYPTION_KEY_VAL"
set_env JWT_SECRET "$JWT_SECRET_VAL"
set_env AI_PROVIDER "$AI_PROVIDER"
[[ -n "$OPENAI_KEY" ]] && set_env OPENAI_API_KEY "$OPENAI_KEY"
[[ -n "$ANTHROPIC_KEY" ]] && set_env ANTHROPIC_API_KEY "$ANTHROPIC_KEY"

set_env NODE_ENV "$NODE_ENV_VAL"
set_env DB_CLIENT "$DB_CLIENT_VAL"
[[ -n "$DATABASE_URL_VAL" ]] && set_env DATABASE_URL "$DATABASE_URL_VAL"
[[ -n "$ALLOWED_EMAIL_DOMAINS_VAL" ]] && set_env ALLOWED_EMAIL_DOMAINS "$ALLOWED_EMAIL_DOMAINS_VAL"

set_env HTTPS_ENABLED "$HTTPS_ENABLED"
if [[ -n "$CORS_ORIGIN_VAL" ]]; then
  set_env CORS_ORIGIN "$CORS_ORIGIN_VAL"
elif [[ "$HTTPS_ENABLED" == true && "$RUN_MODE" == "standalone" ]]; then
  set_env CORS_ORIGIN "https://localhost:5173"
fi
set_env DD_TRACE_ENABLED "$APM"
set_env DD_SITE "$DD_SITE_VAL"
[[ -n "$DD_API_KEY_VAL" ]] && set_env DD_API_KEY "$DD_API_KEY_VAL"
[[ -n "$DD_APP_KEY_VAL" ]] && set_env DD_APP_KEY "$DD_APP_KEY_VAL"
set_env VITE_DD_SITE "$DD_SITE_VAL"
[[ -n "$VITE_RUM_APP_ID" ]] && set_env VITE_DD_RUM_APP_ID "$VITE_RUM_APP_ID"
[[ -n "$VITE_RUM_CLIENT_TOKEN" ]] && set_env VITE_DD_RUM_CLIENT_TOKEN "$VITE_RUM_CLIENT_TOKEN"

if [[ "$OPENBAO" == true ]]; then
  set_env BAO_ADDR "$BAO_ADDR_VAL"
  set_env BAO_NAMESPACE "$BAO_NAMESPACE_VAL"
  set_env BAO_CACERT "$BAO_CACERT_VAL"
  set_env BAO_USERNAME "$BAO_USERNAME_VAL"
  set_env BAO_PASSWORD "$BAO_PASSWORD_VAL"
fi

echo "${GREEN}Wrote .env${RESET}"

# ------------------------------------------------------- write compose plan
if [[ "$RUN_MODE" == "docker" ]]; then
  : >.compose-files
  if [[ "$RUN_AGENT" == true && "$OPENBAO" == true ]]; then
    {
      echo "docker-compose.observability.yaml"
      echo "docker-compose.openbao.yaml"
      echo "docker-compose.observability-openbao.yaml"
    } >.compose-files
  elif [[ "$RUN_AGENT" == true ]]; then
    echo "docker-compose.observability.yaml" >.compose-files
  elif [[ "$OPENBAO" == true ]]; then
    echo "docker-compose.openbao.yaml" >.compose-files
  fi
  [[ "$HTTPS_ENABLED" == true ]] && echo "docker-compose.https.yaml" >>.compose-files
  echo "${GREEN}Wrote .compose-files${RESET} $( [[ -s .compose-files ]] && echo "(overlays: $(tr '\n' ' ' <.compose-files))" || echo "(base stack only)" )"
fi

# --------------------------------------------------------------- next steps
heading "Next steps"
FRONTEND_URL="http://localhost:5173"
BACKEND_URL="http://localhost:3001"
if [[ "$HTTPS_ENABLED" == true ]]; then
  BACKEND_URL="https://localhost:3001"
  [[ "$RUN_MODE" == "docker" ]] && FRONTEND_URL="https://localhost:8443" || FRONTEND_URL="https://localhost:5173"
fi
if [[ "$RUN_MODE" == "docker" ]]; then
  cat <<EOF
  npm run docker:up      # build + start (auto-detects docker or podman)
  npm run docker:down    # stop

  Frontend: $FRONTEND_URL
  Backend:  $BACKEND_URL
EOF
else
  cat <<EOF
  npm install
  npm run dev

  Frontend: $FRONTEND_URL
  Backend:  $BACKEND_URL
EOF
fi

if [[ "$OPENBAO" == true ]]; then
  echo "  ${DIM}OpenBao must be reachable at BAO_ADDR before the backend starts, or ENC[] values will fail to resolve.${RESET}"
fi
if [[ "$OBSERVABILITY" == true && -z "$DD_API_KEY_VAL" && "$RUN_AGENT" == true ]]; then
  echo "  ${DIM}DD_API_KEY/DD_APP_KEY are blank — fill them into .env before starting the Agent.${RESET}"
fi
if [[ "$NODE_ENV_VAL" == "production" ]]; then
  echo
  echo "  ${DIM}Production checklist (README.md#before-deploying-beyond-your-own-laptop):${RESET}"
  echo "  ${DIM}  - Self-registration: $( [[ -n "$ALLOWED_EMAIL_DOMAINS_VAL" ]] && echo "restricted to $ALLOWED_EMAIL_DOMAINS_VAL" || echo "OPEN — no ALLOWED_EMAIL_DOMAINS set" )${RESET}"
  echo "  ${DIM}  - Database: $DB_CLIENT_VAL${RESET}"
  echo "  ${DIM}  - CORS_ORIGIN: $CORS_ORIGIN_VAL${RESET}"
  echo "  ${DIM}  - Consider wrapping JWT_SECRET/ENCRYPTION_KEY as OpenBao ENC[...] values instead of plaintext.${RESET}"
fi

#!/usr/bin/env bash
# Flag-based wrapper for choosing which optional overlays (HTTPS, OpenBao/Vault,
# Datadog observability) to stack on top of docker-compose.yaml — so any of the
# 8 combinations can be picked without hand-assembling -f flags or maintaining
# a separate compose file per combo (which would duplicate shared service
# definitions across files).
#
# Usage: scripts/deploy.sh [--https] [--openbao] [--observability] <compose-args...>
#   scripts/deploy.sh --https --openbao up -d --build
#   scripts/deploy.sh --observability --openbao --https down
#   scripts/deploy.sh up -d                      # base stack only
#
# Resolves the matching overlay(s) per combo:
#   observability + openbao together also pull in
#   docker-compose.observability-openbao.yaml, which lets the Agent itself
#   decrypt ENC[] DD_API_KEY/DD_APP_KEY — it's a no-op layer in isolation, only
#   needed at that specific intersection.
#
# Writes the resolved list to .compose-files so a plain `npm run docker:up`/
# `:down` (scripts/compose.sh) afterward stays in sync with the last combo
# picked here, then delegates the actual compose invocation to compose.sh.
set -eo pipefail
cd "$(dirname "$0")/.."

HTTPS=false
OPENBAO=false
OBSERVABILITY=false
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --https) HTTPS=true; shift ;;
    --openbao|--vault) OPENBAO=true; shift ;;
    --observability|--agent) OBSERVABILITY=true; shift ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

if [[ ${#ARGS[@]} -eq 0 ]]; then
  echo "error: no compose command given (e.g. up -d --build, down, build)" >&2
  echo "Usage: $0 [--https] [--openbao] [--observability] <compose-args...>" >&2
  exit 1
fi

FILES=()
[[ "$OBSERVABILITY" == true ]] && FILES+=(docker-compose.observability.yaml)
[[ "$OPENBAO" == true ]] && FILES+=(docker-compose.openbao.yaml)
[[ "$OPENBAO" == true && "$OBSERVABILITY" == true ]] && FILES+=(docker-compose.observability-openbao.yaml)
[[ "$HTTPS" == true ]] && FILES+=(docker-compose.https.yaml)

: >.compose-files
if [[ ${#FILES[@]} -gt 0 ]]; then
  printf '%s\n' "${FILES[@]}" >.compose-files
fi

echo "+ combo: https=$HTTPS openbao=$OPENBAO observability=$OBSERVABILITY" >&2
echo "+ overlays: $( [[ ${#FILES[@]} -gt 0 ]] && printf '%s ' "${FILES[@]}" || echo '(none — base stack only)' )" >&2

# The Agent container (observability overlay) gets DD_API_KEY/DD_APP_KEY via
# compose variable substitution — i.e. `${DD_API_KEY}` in
# docker-compose.observability.yaml — which resolves from either the shell
# env or .env, unlike the backend's env_file which only ever reads .env.
# Only warn when that overlay is actually in play; otherwise these keys are
# entered later via the app UI and aren't required at deploy time.
if [[ "$OBSERVABILITY" == true ]]; then
  is_set() {
    local key="$1"
    [[ -n "${!key:-}" ]] && return 0
    [[ -f .env ]] && grep -qE "^${key}=.+" .env && return 0
    return 1
  }

  missing=()
  for key in DD_API_KEY DD_APP_KEY; do
    is_set "$key" || missing+=("$key")
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    if [[ "$OPENBAO" == true ]]; then
      echo "warning: ${missing[*]} not found in .env or the shell env." >&2
      echo "  The Agent will decrypt ENC[vault:v1:...] ciphertext for these via OpenBao (see decrypt-entrypoint.sh)," >&2
      echo "  so set them either as plain values, ENC[...] ciphertext in .env, or export them in the shell before running." >&2
    else
      echo "warning: ${missing[*]} not found in .env or the shell env." >&2
      echo "  The Agent container needs these as plain values — set them in .env, or export them in the shell before running." >&2
      echo "  (add --openbao instead if you want to supply ENC[...] ciphertext and decrypt via Vault.)" >&2
    fi
  fi
fi

exec scripts/compose.sh "${ARGS[@]}"

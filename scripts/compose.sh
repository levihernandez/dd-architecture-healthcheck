#!/usr/bin/env bash
# Thin wrapper around `docker compose` / `podman compose` that:
#   - auto-detects whichever container engine is installed
#   - applies the overlay files chosen by `npm run init` (.compose-files)
#   - stamps GIT_SHA fresh on every invocation for DD_VERSION/VITE_DD_VERSION
#
# Usage: scripts/compose.sh <compose-args...>
#   scripts/compose.sh up -d --build
#   scripts/compose.sh down
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${COMPOSE_ENGINE:-}" ]]; then
  read -r -a ENGINE_CMD <<<"$COMPOSE_ENGINE"
elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ENGINE_CMD=(docker compose)
elif command -v podman >/dev/null 2>&1; then
  ENGINE_CMD=(podman compose)
else
  echo "error: neither 'docker' nor 'podman' found on PATH." >&2
  echo "Install one of them, or set COMPOSE_ENGINE to override detection." >&2
  exit 1
fi

FILES=(-f docker-compose.yaml)
if [[ -f .compose-files ]]; then
  while IFS= read -r overlay; do
    [[ -z "$overlay" || "$overlay" == \#* ]] && continue
    if [[ ! -f "$overlay" ]]; then
      echo "warning: .compose-files references missing overlay '$overlay' — skipping" >&2
      continue
    fi
    FILES+=(-f "$overlay")
  done <.compose-files
fi

export GIT_SHA="${GIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"

echo "+ ${ENGINE_CMD[*]} ${FILES[*]} $*" >&2
exec "${ENGINE_CMD[@]}" "${FILES[@]}" "$@"

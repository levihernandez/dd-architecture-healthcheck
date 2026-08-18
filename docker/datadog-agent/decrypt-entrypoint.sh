#!/usr/bin/env bash
# Resolves ENC[vault:v1:...] transit ciphertext (OpenBao) into plaintext env vars
# before handing off to the real Datadog Agent entrypoint. Keeps the API/APP
# keys out of docker-compose.yaml and .env in decrypted form — only the
# ciphertext ever gets committed/shared.
set -euo pipefail

PYTHON=/opt/datadog-agent/embedded/bin/python3
ENC_RE='^ENC\[vault:v1:(.+)\]$'

bao_login() {
  curl -sf --cacert "$BAO_CACERT" \
    -H "X-Vault-Namespace: $BAO_NAMESPACE" \
    -X POST "$BAO_ADDR/v1/auth/userpass/login/$BAO_USERNAME" \
    -d "{\"password\":\"$BAO_PASSWORD\"}" \
    | "$PYTHON" -c 'import sys,json; print(json.load(sys.stdin)["auth"]["client_token"])'
}

decrypt_enc() {
  local ciphertext="$1" token="$2"
  curl -sf --cacert "$BAO_CACERT" \
    -H "X-Vault-Token: $token" \
    -H "X-Vault-Namespace: $BAO_NAMESPACE" \
    -X POST "$BAO_ADDR/v1/transit/decrypt/ai-app" \
    -d "{\"ciphertext\":\"vault:v1:$ciphertext\"}" \
    | "$PYTHON" -c 'import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)["data"]["plaintext"]).decode())'
}

needs_decrypt=false
for var in DD_API_KEY DD_APP_KEY; do
  value="${!var:-}"
  if [[ "$value" =~ $ENC_RE ]]; then
    needs_decrypt=true
  fi
done

if [[ "$needs_decrypt" == true ]]; then
  : "${BAO_ADDR:?BAO_ADDR must be set to resolve ENC[] values}"
  : "${BAO_USERNAME:?BAO_USERNAME must be set to resolve ENC[] values}"
  : "${BAO_PASSWORD:?BAO_PASSWORD must be set to resolve ENC[] values}"
  token="$(bao_login)"
  for var in DD_API_KEY DD_APP_KEY; do
    value="${!var:-}"
    if [[ "$value" =~ $ENC_RE ]]; then
      plaintext="$(decrypt_enc "${BASH_REMATCH[1]}" "$token")"
      export "$var=$plaintext"
    fi
  done
  echo "[decrypt-entrypoint] Resolved ENC[] secrets via OpenBao"
fi

exec /bin/entrypoint.sh "$@"

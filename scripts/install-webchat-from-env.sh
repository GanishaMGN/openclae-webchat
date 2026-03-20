#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.webchat}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file tidak ditemukan: $ENV_FILE"
  echo "Contoh: cp scripts/webchat.env.example .env.webchat"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

: "${MODE:=auto}"
: "${CHAT_PORT:=8081}"
: "${MIGRATE_MODELS:=true}"

[[ -n "${CHAT_DOMAIN:-}" ]] || { echo "CHAT_DOMAIN wajib di env"; exit 1; }
[[ -n "${BASIC_AUTH_USER:-}" ]] || { echo "BASIC_AUTH_USER wajib di env"; exit 1; }
[[ -n "${BASIC_AUTH_PASS:-}" ]] || { echo "BASIC_AUTH_PASS wajib di env"; exit 1; }

bash scripts/install-webchat.sh \
  --mode "$MODE" \
  --chat-domain "$CHAT_DOMAIN" \
  --chat-port "$CHAT_PORT" \
  --provider-base-url "${PROVIDER_BASE_URL:-}" \
  --provider-api-key "${PROVIDER_API_KEY:-}" \
  --migrate-models "$MIGRATE_MODELS" \
  --basic-auth-user "$BASIC_AUTH_USER" \
  --basic-auth-pass "$BASIC_AUTH_PASS"

echo "Done. Source env: $ENV_FILE"
#!/usr/bin/env bash
set -euo pipefail

MODE="auto"
CHAT_DOMAIN=""
PROVIDER_BASE_URL=""
PROVIDER_API_KEY=""
BASIC_USER="mgn"
BASIC_PASS=""
CHAT_PORT="8081"
WORKDIR="$HOME/chat-ui"
MIGRATE_MODELS="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --chat-domain) CHAT_DOMAIN="$2"; shift 2 ;;
    --provider-base-url) PROVIDER_BASE_URL="$2"; shift 2 ;;
    --provider-api-key) PROVIDER_API_KEY="$2"; shift 2 ;;
    --basic-auth-user) BASIC_USER="$2"; shift 2 ;;
    --basic-auth-pass) BASIC_PASS="$2"; shift 2 ;;
    --chat-port) CHAT_PORT="$2"; shift 2 ;;
    --migrate-models) MIGRATE_MODELS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

[[ -n "$CHAT_DOMAIN" ]] || { echo "--chat-domain wajib"; exit 1; }
[[ -n "$BASIC_PASS" ]] || { echo "--basic-auth-pass wajib"; exit 1; }

if [[ "$MODE" == "auto" ]]; then
  if systemctl --user is-active openfang-gateway.service >/dev/null 2>&1 || [[ -x "$HOME/.openfang/bin/openfang" ]]; then
    MODE="openfang"
  elif command -v openclaw >/dev/null 2>&1 || systemctl --user is-active openclaw-gateway.service >/dev/null 2>&1; then
    MODE="openclaw"
  else
    echo "Tidak menemukan service OpenFang/OpenClaw. Gunakan --mode manual."
    exit 1
  fi
fi

if [[ ! -d "$WORKDIR" ]]; then
  echo "chat-ui tidak ditemukan di $WORKDIR"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  sudo apt-get update -y && sudo apt-get install -y nginx
fi
if ! command -v certbot >/dev/null 2>&1; then
  sudo apt-get update -y && sudo apt-get install -y certbot python3-certbot-nginx apache2-utils
fi

cd "$WORKDIR"
npm install --omit=dev

# Determine backend gateway URL
GATEWAY_URL="http://127.0.0.1:50051"
if [[ "$MODE" == "openclaw" ]]; then
  GATEWAY_URL="http://127.0.0.1:18789"
fi

# Optional model migration from provider /v1/models
if [[ "$MIGRATE_MODELS" == "true" && -n "$PROVIDER_BASE_URL" && -n "$PROVIDER_API_KEY" ]]; then
  TMP_MODELS=$(mktemp)
  if curl -fsS "$PROVIDER_BASE_URL/models" -H "Authorization: Bearer $PROVIDER_API_KEY" -H "Content-Type: application/json" > "$TMP_MODELS"; then
    python3 - "$TMP_MODELS" "$WORKDIR/openclaw.json" <<'PY'
import json,sys
src=json.load(open(sys.argv[1]))
ids=[m.get('id') for m in src.get('data',[]) if m.get('id')]
models={m:{} for m in ids}
cfg={
  'gateway': {'port': 50051},
  'agents': {
    'list': [{'id':'main'}],
    'defaults': {
      'model': {'primary': ids[0] if ids else 'claude-sonnet-4-6'},
      'models': models
    }
  }
}
json.dump(cfg, open(sys.argv[2],'w'), indent=2)
print('Migrated model count:', len(ids))
PY
  fi
  rm -f "$TMP_MODELS"
fi

mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/chat-ui.service <<SERVICE
[Unit]
Description=Custom Chat UI
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$WORKDIR
Environment=NODE_ENV=production
Environment=PORT=$CHAT_PORT
Environment=GATEWAY_URL=$GATEWAY_URL
Environment=OPENCLAW_CONFIG=$WORKDIR/openclaw.json
ExecStart=/usr/bin/node $WORKDIR/server.js
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
SERVICE

if [[ "$MODE" == "openfang" && -n "$PROVIDER_BASE_URL" && -n "$PROVIDER_API_KEY" ]]; then
  mkdir -p ~/.openfang
  touch ~/.openfang/.env
  grep -vE '^(OPENAI_API_KEY|OPENAI_BASE_URL)=' ~/.openfang/.env > ~/.openfang/.env.tmp || true
  mv ~/.openfang/.env.tmp ~/.openfang/.env
  printf "OPENAI_API_KEY=%s\nOPENAI_BASE_URL=%s\n" "$PROVIDER_API_KEY" "$PROVIDER_BASE_URL" >> ~/.openfang/.env
  ~/.openfang/bin/openfang config set default_model.provider openai >/dev/null || true
  ~/.openfang/bin/openfang config set default_model.api_key_env OPENAI_API_KEY >/dev/null || true
  ~/.openfang/bin/openfang config set default_model.base_url "$PROVIDER_BASE_URL" >/dev/null || true
fi

systemctl --user daemon-reload
systemctl --user enable --now chat-ui.service

sudo htpasswd -bc /etc/nginx/.htpasswd-chatui "$BASIC_USER" "$BASIC_PASS"

sudo tee /etc/nginx/sites-available/$CHAT_DOMAIN >/dev/null <<NGINX
server {
  listen 80;
  listen [::]:80;
  server_name $CHAT_DOMAIN;

  location / {
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd-chatui;
    proxy_pass http://127.0.0.1:$CHAT_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/$CHAT_DOMAIN /etc/nginx/sites-enabled/$CHAT_DOMAIN
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d "$CHAT_DOMAIN" --non-interactive --agree-tos -m admin@localhost --redirect || true

echo "OK: mode=$MODE url=https://$CHAT_DOMAIN"

#!/usr/bin/env bash
set -euo pipefail
DOMAIN="${1:-}"
echo "== chat-ui service =="
systemctl --user status chat-ui.service --no-pager | sed -n '1,14p' || true

echo "== nginx =="
sudo systemctl is-active nginx || true

if [[ -n "$DOMAIN" ]]; then
  echo "== domain =="
  curl -k -I -sS "https://$DOMAIN" | head -n 8 || true
fi

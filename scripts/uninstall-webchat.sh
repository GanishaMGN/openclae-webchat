#!/usr/bin/env bash
set -euo pipefail
DOMAIN="${1:-}"
[[ -n "$DOMAIN" ]] || { echo "Usage: $0 <chat-domain>"; exit 1; }

systemctl --user disable --now chat-ui.service || true
rm -f ~/.config/systemd/user/chat-ui.service
systemctl --user daemon-reload || true

sudo rm -f "/etc/nginx/sites-enabled/$DOMAIN" "/etc/nginx/sites-available/$DOMAIN"
sudo nginx -t && sudo systemctl reload nginx || true

echo "Uninstalled webchat for $DOMAIN"
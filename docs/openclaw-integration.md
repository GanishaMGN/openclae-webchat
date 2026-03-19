# Integrating openclae-webchat with OpenClaw

This guide explains how to run `openclae-webchat` as an alternative web channel for an OpenClaw Gateway deployment.

## 1) Prerequisites

- OpenClaw installed and runnable on the target host
- OpenClaw Gateway reachable locally (default: `127.0.0.1:18789`)
- Node.js 18+

## 2) Run OpenClaw Gateway

Start gateway (example):

```bash
openclaw gateway run --bind loopback --port 18789
```

Health check:

```bash
curl -fsS http://127.0.0.1:18789/health
```

## 3) Run Web Chat

From repo root:

```bash
npm install
npm start
```

Open:

- `http://127.0.0.1:8080`

## 4) Optional: Use helper scripts (Termux/Linux)

```bash
bash scripts/start-chat-stack.sh
bash scripts/chatctl.sh status
```

What scripts do:

- bring up gateway (if down)
- bring up web chat (if down)
- keep lightweight watchdog for gateway health

## 5) Environment configuration

Supported environment variables:

- `PORT` (default `8080`)
- `OPENCLAW_CONFIG` (default `$HOME/.openclaw/openclaw.json`)
- `GATEWAY_TIMEOUT_MS` (default `120000`)
- `WORKSPACE` (optional script override)

## 6) Production notes

- Put a reverse proxy (Nginx/Caddy) in front for TLS + domain.
- Keep gateway bound to loopback whenever possible.
- Ensure proper CORS/origin policy on OpenClaw side.
- Do not commit runtime `data/chat-store.json` and uploaded files.

## 7) Troubleshooting

- Gateway down: verify `openclaw gateway` process and `/health` endpoint.
- UI loads but no response: check gateway URL and timeout.
- Stream interruptions: inspect logs and proxy buffering settings.


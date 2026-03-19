#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="${WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CHAT_DIR="$WORKSPACE"
LOG_DIR="$WORKSPACE/.openclaw/logs"
GATEWAY_HEALTH="http://127.0.0.1:18789/health"
CHAT_HEALTH="http://127.0.0.1:8080/api/sessions"
CHAT_ROOT="http://127.0.0.1:8080/"
CHAT_MATCH='node .*server\.js'
WATCHDOG_SCRIPT="$WORKSPACE/scripts/gateway-watchdog.sh"
WATCHDOG_PID="$WORKSPACE/.openclaw/run/gateway-watchdog.pid"

mkdir -p "$LOG_DIR"

is_http_up() {
  local url="$1"
  curl -fsS --max-time 3 "$url" >/dev/null 2>&1
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-20}"

  for _ in $(seq 1 "$attempts"); do
    if is_http_up "$url"; then
      echo "[ok] $label"
      return 0
    fi
    sleep 1
  done

  return 1
}

list_chat_pids() {
  pgrep -f "$CHAT_MATCH" || true
}

kill_chat_pids() {
  local pids
  pids="$(list_chat_pids | tr '\n' ' ' | xargs echo 2>/dev/null || true)"
  if [ -z "${pids// }" ]; then
    return 0
  fi

  echo "[warn] Stopping stale Chat UI process(es): $pids"
  kill $pids 2>/dev/null || true
  sleep 2

  local remaining
  remaining="$(list_chat_pids | tr '\n' ' ' | xargs echo 2>/dev/null || true)"
  if [ -n "${remaining// }" ]; then
    echo "[warn] Force-killing remaining Chat UI process(es): $remaining"
    kill -9 $remaining 2>/dev/null || true
    sleep 1
  fi
}

start_gateway() {
  if is_http_up "$GATEWAY_HEALTH"; then
    echo "[ok] OpenClaw gateway already running"
    return 0
  fi

  echo "[start] Starting OpenClaw gateway"
  nohup openclaw gateway run --bind loopback --port 18789 >"$LOG_DIR/gateway-start.log" 2>&1 &

  if wait_for_http "$GATEWAY_HEALTH" "OpenClaw gateway is up" 20; then
    return 0
  fi

  echo "[warn] Gateway start command was sent, but health check is still failing"
  return 1
}

start_watchdog() {
  if [ ! -x "$WATCHDOG_SCRIPT" ]; then
    echo "[warn] Gateway watchdog script missing or not executable: $WATCHDOG_SCRIPT"
    return 0
  fi

  if [ -f "$WATCHDOG_PID" ]; then
    local existing_pid
    existing_pid="$(cat "$WATCHDOG_PID" 2>/dev/null || true)"
    if [ -n "${existing_pid:-}" ] && kill -0 "$existing_pid" 2>/dev/null; then
      echo "[ok] Gateway watchdog already running (pid $existing_pid)"
      return 0
    fi
  fi

  echo "[start] Starting gateway watchdog"
  nohup "$WATCHDOG_SCRIPT" >/dev/null 2>&1 &
}

start_chat_ui() {
  if is_http_up "$CHAT_HEALTH"; then
    echo "[ok] Chat UI already healthy on :8080"
    return 0
  fi

  if [ -n "$(list_chat_pids)" ]; then
    echo "[warn] Chat UI process exists but health check failed"
    kill_chat_pids
  fi

  echo "[start] Starting Chat UI on :8080"
  cd "$CHAT_DIR"
  nohup node server.js >"$LOG_DIR/chat-ui.log" 2>&1 &

  if wait_for_http "$CHAT_HEALTH" "Chat UI is healthy on :8080" 20; then
    return 0
  fi

  echo "[warn] Chat UI process was started, but API health check is still failing"
  echo "[info] Root URL check: $CHAT_ROOT"
  return 1
}

start_gateway
start_watchdog
start_chat_ui

echo "[done] Chat stack startup check finished"

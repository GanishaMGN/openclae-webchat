#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="${WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
START_SCRIPT="$WORKSPACE/scripts/start-chat-stack.sh"
CHAT_HEALTH="http://127.0.0.1:8080/api/sessions"
GATEWAY_HEALTH="http://127.0.0.1:18789/health"
CHAT_MATCH='node .*server\.js'

is_http_up() {
  local url="$1"
  curl -fsS --max-time 3 "$url" >/dev/null 2>&1
}

chat_pids() {
  pgrep -f "$CHAT_MATCH" || true
}

stop_chat_ui() {
  local pids
  pids="$(chat_pids | tr '\n' ' ' | xargs echo 2>/dev/null || true)"
  if [ -z "${pids// }" ]; then
    echo "[ok] Chat UI already stopped"
    return 0
  fi

  echo "[stop] Stopping Chat UI: $pids"
  kill $pids 2>/dev/null || true
  sleep 2

  local remaining
  remaining="$(chat_pids | tr '\n' ' ' | xargs echo 2>/dev/null || true)"
  if [ -n "${remaining// }" ]; then
    echo "[warn] Force-killing Chat UI: $remaining"
    kill -9 $remaining 2>/dev/null || true
    sleep 1
  fi

  echo "[ok] Chat UI stopped"
}

status() {
  if is_http_up "$GATEWAY_HEALTH"; then
    echo "Gateway : UP"
  else
    echo "Gateway : DOWN"
  fi

  if is_http_up "$CHAT_HEALTH"; then
    echo "Chat UI : UP"
  else
    echo "Chat UI : DOWN"
  fi

  local pids
  pids="$(chat_pids | tr '\n' ' ' | xargs echo 2>/dev/null || true)"
  echo "Chat PID : ${pids:-none}"
}

cmd="${1:-status}"

case "$cmd" in
  up|start)
    bash "$START_SCRIPT"
    ;;
  down|stop)
    stop_chat_ui
    ;;
  restart)
    stop_chat_ui
    bash "$START_SCRIPT"
    ;;
  status)
    status
    ;;
  *)
    echo "Usage: $(basename "$0") {up|down|restart|status}"
    exit 1
    ;;
esac

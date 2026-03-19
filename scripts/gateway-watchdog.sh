#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="${WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG_DIR="$WORKSPACE/.openclaw/logs"
GATEWAY_HEALTH="http://127.0.0.1:18789/health"
LOCK_DIR="$WORKSPACE/.openclaw/run"
PID_FILE="$LOCK_DIR/gateway-watchdog.pid"
LOG_FILE="$LOG_DIR/gateway-watchdog.log"
CHECK_INTERVAL="${CHECK_INTERVAL:-20}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-6}"   # 6 * 20s = 120s before any recovery attempt

mkdir -p "$LOG_DIR" "$LOCK_DIR"

# Single-instance via pid file (works reliably in Termux)
if [ -f "$PID_FILE" ]; then
  existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${existing_pid:-}" ] && kill -0 "$existing_pid" 2>/dev/null; then
    exit 0
  fi
fi

echo $$ > "$PID_FILE"
cleanup() {
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

is_gateway_up() {
  curl -fsS --max-time 8 "$GATEWAY_HEALTH" >/dev/null 2>&1
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

gateway_pids() {
  pgrep -f 'openclaw-gateway|openclaw gateway run' || true
}

start_gateway() {
  log "starting gateway using foreground run mode (android-safe)"
  nohup openclaw gateway run --bind loopback --port 18789 >> "$LOG_FILE" 2>&1 &
}

log "gateway-watchdog started (pid=$$ interval=${CHECK_INTERVAL}s fail-threshold=${FAIL_THRESHOLD})"

fail_count=0

while true; do
  if is_gateway_up; then
    fail_count=0
  else
    fail_count=$((fail_count + 1))
    log "gateway health check failed (${fail_count}/${FAIL_THRESHOLD})"

    if [ "$fail_count" -ge "$FAIL_THRESHOLD" ]; then
      pids="$(gateway_pids | tr '\n' ' ' | xargs echo 2>/dev/null || true)"

      if [ -z "${pids// }" ]; then
        log "gateway process not found; attempting start"
        start_gateway
      else
        # Important: do NOT kill a running gateway process here.
        # Aggressive kills were causing chat disconnects/flapping.
        log "gateway process still exists (pid(s): $pids); skip force-restart to avoid disconnect loops"
      fi

      fail_count=0
      sleep 5
    fi
  fi

  sleep "$CHECK_INTERVAL"
done

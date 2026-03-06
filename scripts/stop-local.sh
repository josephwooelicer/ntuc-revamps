#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

HOST="${HOST:-127.0.0.1}"
PORT_WEB="${PORT_WEB:-3000}"
PORT_WORKER="${PORT_WORKER:-4000}"

kill_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -TERM 2>/dev/null || true
      sleep 0.5
      pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
      if [ -n "$pids" ]; then
        echo "$pids" | xargs kill -KILL 2>/dev/null || true
      fi
    fi
  fi
}

kill_port "$PORT_WEB"
kill_port "$PORT_WORKER"

# Fallback pattern cleanup in case lsof is unavailable or no listener was found.
pkill -f "next dev" 2>/dev/null || true
pkill -f "node src/index.js" 2>/dev/null || true
pkill -f "worker-service" 2>/dev/null || true

echo "Stopped local services on ${HOST}:${PORT_WEB} and ${HOST}:${PORT_WORKER} (if running)."

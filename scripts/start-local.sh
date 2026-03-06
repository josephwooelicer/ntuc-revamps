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

mkdir -p "${DATA_LAKE_RAW_PATH:-./data-lake/raw}" "${DATA_LAKE_ARCHIVE_PATH:-./data-lake/archive}" ./data
: > "${SQLITE_DB_PATH:-./data/ntuc-ews.db}"

if [ ! -d node_modules ]; then
  echo "Dependencies are not installed. Run: npm install"
  exit 1
fi

cleanup() {
  kill "$WEB_PID" "$WORKER_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

npm run dev:web &
WEB_PID=$!

npm run dev:worker &
WORKER_PID=$!

wait "$WEB_PID" "$WORKER_PID"

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

PORT_WEB="${PORT_WEB:-3000}"
PORT_WORKER="${PORT_WORKER:-4000}"
HOST="${HOST:-127.0.0.1}"
RAW_PATH="${DATA_LAKE_RAW_PATH:-./data-lake/raw}"
DB_PATH="${SQLITE_DB_PATH:-./data/ntuc-ews.db}"

curl -fsS "http://${HOST}:${PORT_WEB}/api/health" >/dev/null
curl -fsS "http://${HOST}:${PORT_WORKER}/health" >/dev/null

[ -d "$RAW_PATH" ]
[ -f "$DB_PATH" ]

echo "health check passed"

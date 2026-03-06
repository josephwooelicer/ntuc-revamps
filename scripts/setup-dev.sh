#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_node_major=22
required_npm_major=10

if ! command -v node >/dev/null 2>&1; then
  echo "node is required (Node.js ${required_node_major}+)."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required (npm ${required_npm_major}+)."
  exit 1
fi

node_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
npm_major="$(npm -v | sed -E 's/^([0-9]+).*/\1/')"

if [ "$node_major" -lt "$required_node_major" ]; then
  echo "Node.js version $(node -v) detected. Please upgrade to ${required_node_major}+."
  exit 1
fi

if [ "$npm_major" -lt "$required_npm_major" ]; then
  echo "npm version $(npm -v) detected. Please upgrade to ${required_npm_major}+."
  exit 1
fi

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

mkdir -p "${DATA_LAKE_RAW_PATH:-./data-lake/raw}" "${DATA_LAKE_ARCHIVE_PATH:-./data-lake/archive}" ./data
DB_PATH="${SQLITE_DB_PATH:-./data/ntuc-ews.db}"
mkdir -p "$(dirname "$DB_PATH")"
if [ ! -f "$DB_PATH" ]; then
  touch "$DB_PATH"
fi

echo "Installing workspace dependencies..."
npm install

echo "Applying database migrations and seeds..."
npm run db:init

echo "Setup complete."
echo "Next steps:"
echo "  npm run dev"
echo "  npm run health"

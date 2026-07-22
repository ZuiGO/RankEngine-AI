#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

kill_port() {
  local port=$1
  local pid
  pid=$(lsof -ti ":$port" 2>/dev/null) && kill -9 "$pid" 2>/dev/null || true
}

cleanup() {
  echo ""
  echo "[dev.sh] Shutting down..."
  kill_port 3000
  kill_port 5173
  exit 0
}

trap cleanup EXIT INT TERM

echo "[dev.sh] Cleaning stale processes..."
kill_port 3000
kill_port 5173

# Wait for ports to release
for port in 3000 5173; do
  for i in $(seq 1 5); do
    if ! lsof -ti ":$port" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
done

echo "[dev.sh] Starting API (port 3000) and Web (port 5173)..."
(cd "$ROOT/apps/api" && npm run dev) &
(cd "$ROOT/apps/web" && npm run dev) &

wait

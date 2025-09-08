#!/usr/bin/env bash
set -euo pipefail

CTFD_URL="${CTFD_URL:-http://127.0.0.1:8000}"
SEED_JS="${SEED_JS:-/app/seed-ctfd.js}"

echo "[seeder] waiting for CTFd to start at ${CTFD_URL} …"

# Wait for CTFd HTTP to come up (try modern, legacy, and root)
up=0
for i in $(seq 1 120); do
  if curl -fsS -H 'Accept: application/json' "${CTFD_URL}/api/v1/configs" >/dev/null 2>&1 \
     || curl -fsS -H 'Accept: application/json' "${CTFD_URL}/api/v1/config"  >/dev/null 2>&1 \
     || curl -fsS "${CTFD_URL}/" >/dev/null 2>&1
  then
    up=1
    echo "[seeder] CTFd HTTP is up."
    break
  fi
  echo "[seeder] … still waiting (${i})"
  sleep 1
done

if [ "$up" -ne 1 ]; then
  echo "[seeder] ERROR: CTFd did not become ready in time."
  exit 1
fi

# Find the admin token from the bootstrap plugin
# Prefer /tmp (no disk on free tier), fallback to /data if present
TOKEN_FILE_ENV="${TOKEN_FILE:-}"
TOKEN_FILE=""
if [ -n "$TOKEN_FILE_ENV" ] && [ -s "$TOKEN_FILE_ENV" ]; then
  TOKEN_FILE="$TOKEN_FILE_ENV"
else
  for try in /tmp/ctfd_token /data/ctfd_token; do
    if [ -s "$try" ]; then TOKEN_FILE="$try"; break; fi
  done
fi

if [ -z "$TOKEN_FILE" ]; then
  echo "[seeder] waiting for admin token (/tmp/ctfd_token or /data/ctfd_token) …"
  for i in $(seq 1 60); do
    for try in /tmp/ctfd_token /data/ctfd_token; do
      if [ -s "$try" ]; then TOKEN_FILE="$try"; break; fi
    done
    [ -n "$TOKEN_FILE" ] && break
    echo "[seeder] … token not yet available (${i})"
    sleep 1
  done
fi

if [ -z "$TOKEN_FILE" ] || [ ! -s "$TOKEN_FILE" ]; then
  echo "[seeder] ERROR: token file not found or empty."
  echo "         Ensure the bootstrap_token plugin is enabled and writing /tmp/ctfd_token (or /data/ctfd_token)."
  exit 1
fi

echo "[seeder] using token file: $TOKEN_FILE"

# Run the seeder (Node 18+). The seeder itself is idempotent using CTFd config.
export CTFD_URL
echo "[seeder] running node ${SEED_JS}"
node "${SEED_JS}"

echo "[seeder] done."
exit 0

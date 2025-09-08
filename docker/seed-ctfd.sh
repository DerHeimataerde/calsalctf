#!/usr/bin/env bash
set -euo pipefail

MARKER=/data/.seeded
if [[ -f "$MARKER" ]]; then
  echo "[seed] already ran, skipping."
  exit 0
fi

CTFD_BASE="${CTFD_BASE:-http://127.0.0.1:8080/ctf}"
echo "[seed] waiting for CTFd at $CTFD_BASE ..."
for i in {1..60}; do
  if curl -fsS "$CTFD_BASE/api/v1/config" >/dev/null 2>&1; then
    echo "[seed] CTFd is up."
    break
  fi
  sleep 2
done

# If no env token, read the auto-created one from the bootstrap plugin
if [[ -z "${CTFD_TOKEN:-}" && -f /data/ctfd_token ]]; then
  export CTFD_TOKEN="$(tr -d '\r\n' < /data/ctfd_token)"
fi

echo "[seed] seeding…"
node /app/seed-ctfd.js

touch "$MARKER"
echo "[seed] done."

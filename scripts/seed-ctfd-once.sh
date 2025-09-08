#!/usr/bin/env bash
set -euo pipefail

CTFD_URL="${CTFD_URL:-http://127.0.0.1:8000}"
TOKEN_FILE="${TOKEN_FILE:-/data/ctfd_token}"
SEEDED_MARK="${SEEDED_MARK:-/data/.seeded}"
SEED_JS="${SEED_JS:-/app/seed-ctfd.js}"

# If already seeded, exit successfully
if [ -f "$SEEDED_MARK" ]; then
  echo "[seeder] already seeded ($SEEDED_MARK exists) — skipping."
  exit 0
fi

echo "[seeder] waiting for CTFd to start at ${CTFD_URL} …"

# Wait for CTFd HTTP to come up (try both modern/legacy endpoints)
for i in $(seq 1 120); do
  if curl -fsS -H 'Accept: application/json' "${CTFD_URL}/api/v1/configs" >/dev/null 2>&1 \
     || curl -fsS -H 'Accept: application/json' "${CTFD_URL}/api/v1/config"  >/dev/null 2>&1 \
     || curl -fsS "${CTFD_URL}/" >/dev/null 2>&1
  then
    echo "[seeder] CTFd HTTP is up."
    break
  fi
  echo "[seeder] … still waiting (${i})"
  sleep 1
done

# Wait for token created by your bootstrap plugin
echo "[seeder] waiting for admin token at ${TOKEN_FILE} …"
for i in $(seq 1 60); do
  if [ -s "$TOKEN_FILE" ]; then
    echo "[seeder] token file present."
    break
  fi
  echo "[seeder] … token not yet available (${i})"
  sleep 1
done

if [ ! -s "$TOKEN_FILE" ]; then
  echo "[seeder] ERROR: token file ${TOKEN_FILE} not found or empty."
  echo "         Ensure the bootstrap_token plugin is enabled and can write the token."
  exit 1
fi

# Run the seeder (Node 18+). Pass URL explicitly so it is robust to changes.
echo "[seeder] running node ${SEED_JS}"
export CTFD_URL="${CTFD_URL}"
node "${SEED_JS}" && {
  touch "${SEEDED_MARK}"
  echo "[seeder] done. Created ${SEEDED_MARK}"
  exit 0
}

echo "[seeder] ERROR: seeding failed."
exit 1

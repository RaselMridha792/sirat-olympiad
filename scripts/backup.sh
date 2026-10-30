#!/usr/bin/env bash
# Nightly logical backup, shipped OFF the server. TODO(claude-code): upload to S3-compatible storage + alert on failure.
set -euo pipefail
umask 077   # dumps hold minors' personal data: owner-only (dir 0700, files 0600), RULEBOOK §15
cd "$(dirname "$0")/.."
DC="docker compose --env-file .env -f infra/docker-compose.yml"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups && chmod 700 backups   # also tightens a directory created earlier
OUT="backups/sirat-$STAMP.dump"
TMP="backups/.sirat-$STAMP.dump.partial"
trap 'rm -f "$TMP"' EXIT                # a failed or interrupted run never leaves a restorable-looking file
# Credentials are read from the postgres container's own environment, never from this shell or its history.
# shellcheck disable=SC2016
$DC exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TMP"
# Read the whole archive: `pg_restore --list` alone passes on a truncated dump.
$DC exec -T postgres pg_restore -f /dev/null < "$TMP"
mv "$TMP" "$OUT"
echo "backup written: $OUT (NOT yet off-server - finish the upload step)"

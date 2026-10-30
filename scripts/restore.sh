#!/usr/bin/env bash
# DESTRUCTIVE: restores a dump into the target DB. Run restore drills on ANOTHER machine first.
# Stop nginx, web and api before restoring (docs/RUNBOOK.md section 5).
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?usage: scripts/restore.sh backups/file.dump}"
DC="docker compose --env-file .env -f infra/docker-compose.yml"
# Read the whole archive BEFORE touching the database: a truncated dump must fail here, not halfway through.
$DC exec -T postgres pg_restore -f /dev/null < "$FILE" || { echo "dump is unreadable or truncated: $FILE" >&2; exit 1; }
read -r -p "This OVERWRITES the database in the postgres container. Type YES to continue: " OK
[ "$OK" = "YES" ] || { echo aborted; exit 1; }
# One transaction: any error rolls the whole restore back and leaves the current data untouched.
# Credentials are read from the postgres container's own environment.
# shellcheck disable=SC2016
$DC exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --single-transaction --exit-on-error' < "$FILE"
echo "restore finished. Next: $DC run --rm migrate, flush redis-cache, then $DC up -d and scripts/healthcheck.sh"

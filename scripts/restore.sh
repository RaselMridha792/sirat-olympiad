#!/usr/bin/env bash
# DESTRUCTIVE: restores a dump into the target DB. Run restore drills on ANOTHER machine first.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?usage: scripts/restore.sh backups/file.dump}"
DC="docker compose --env-file .env -f infra/docker-compose.yml"
read -r -p "This OVERWRITES the database in the postgres container. Type YES to continue: " OK
[ "$OK" = "YES" ] || { echo aborted; exit 1; }
# Credentials are read from the postgres container's own environment.
$DC exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < "$FILE"

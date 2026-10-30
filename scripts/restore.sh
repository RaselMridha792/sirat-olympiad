#!/usr/bin/env bash
# DESTRUCTIVE: restores a dump into the target DB. Run restore drills on ANOTHER machine first.
set -euo pipefail
FILE="${1:?usage: scripts/restore.sh backups/file.dump}"
read -r -p "This overwrites database ${POSTGRES_DB}. Type YES to continue: " OK
[ "$OK" = "YES" ] || { echo aborted; exit 1; }
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --clean --if-exists < "$FILE"

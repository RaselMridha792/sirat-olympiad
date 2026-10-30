#!/usr/bin/env bash
# Nightly logical backup, shipped OFF the server. TODO(claude-code): upload to S3-compatible storage + alert on failure.
set -euo pipefail
cd "$(dirname "$0")/.."
DC="docker compose --env-file .env -f infra/docker-compose.yml"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups
# Credentials are read from the postgres container's own environment, never from this shell or its history.
$DC exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/sirat-$STAMP.dump"
echo "backup written: backups/sirat-$STAMP.dump (NOT yet off-server — finish the upload step)"

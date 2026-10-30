#!/usr/bin/env bash
# Nightly logical backup, shipped OFF the server. TODO(claude-code): upload to S3-compatible storage + alert on failure.
set -euo pipefail
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc > "backups/sirat-$STAMP.dump"
echo "backup written: backups/sirat-$STAMP.dump (NOT yet off-server — finish the upload step)"

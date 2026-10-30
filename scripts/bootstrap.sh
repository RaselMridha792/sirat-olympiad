#!/usr/bin/env bash
# Rebuild on a fresh Ubuntu VPS in < 1 hour. SCAFFOLD: finish + TEST this before the exam (rulebook sec. 3).
set -euo pipefail
echo "1) install docker + compose plugin, ufw (80/443/ssh), fail2ban, chrony, unattended-upgrades"
echo "2) clone repo, copy .env, create swap"
echo "3) docker compose -f infra/docker-compose.yml up -d --build"
echo "4) pnpm --filter @sirat/api prisma:deploy   # migrations"
echo "5) restore latest backup if rebuilding: scripts/restore.sh <dump>"
echo "6) scripts/healthcheck.sh https://<domain>"
echo "TODO(claude-code): implement each step as real commands and rehearse on a clean VPS."

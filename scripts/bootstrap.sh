#!/usr/bin/env bash
# Rebuild on a fresh Ubuntu VPS in < 1 hour. SCAFFOLD: finish + TEST this before the exam (rulebook sec. 3).
set -euo pipefail
echo "1) install docker + compose plugin, ufw (80/443/ssh), fail2ban, chrony, unattended-upgrades"
echo "2) clone repo, copy .env (chmod 600), create swap"
echo "3) docker compose --env-file .env -f infra/docker-compose.yml up -d --build   # migrate job runs migrations + config seed"
echo "4) restore latest backup if rebuilding: scripts/restore.sh <dump>"
echo "5) scripts/healthcheck.sh https://<domain>"
echo "TODO(claude-code): implement each step as real commands and rehearse on a clean VPS."

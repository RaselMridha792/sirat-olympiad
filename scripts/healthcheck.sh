#!/usr/bin/env bash
# Quick production check. Usage: scripts/healthcheck.sh https://your-domain
set -euo pipefail
BASE="${1:-http://localhost}"
curl -fsS "$BASE/api/health" && echo " liveness ok"
curl -fsS "$BASE/api/ready"  && echo " readiness ok"
curl -fsSI "$BASE/" | head -1

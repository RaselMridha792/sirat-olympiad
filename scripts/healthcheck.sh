#!/usr/bin/env bash
# Quick production check. Exits non-zero if ANY check fails, so a deploy can roll back on it.
# Usage: scripts/healthcheck.sh https://your-domain
set -euo pipefail
BASE="${1:-http://localhost}"
fail=0
check() {
  if curl -fsS -m 10 -o /dev/null "$2"; then echo "ok    $1"; else echo "FAIL  $1 ($2)"; fail=1; fi
}
check liveness "$BASE/api/health"
check readiness "$BASE/api/ready"
check "home page" "$BASE/"
exit "$fail"

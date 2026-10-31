#!/usr/bin/env bash
# Quick production check. Exits non-zero if ANY check fails, so a deploy can roll back on it.
# Usage: scripts/healthcheck.sh https://your-domain
# The URL is required: on the TLS site, plain http answers with a redirect, which is not the app.
# Every check needs exactly 200 (`curl -f` would count a 3xx redirect as success).
set -euo pipefail
BASE="${1:?usage: scripts/healthcheck.sh https://<domain>}"
fail=0
check() {
  # Inside the `if`, so a connection error (status 000) prints FAIL instead of stopping the script.
  if [ "$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$2")" = 200 ]; then echo "ok    $1"; else echo "FAIL  $1 ($2)"; fail=1; fi
}
check liveness "$BASE/api/health"
check readiness "$BASE/api/ready"
check "home page" "$BASE/"
exit "$fail"

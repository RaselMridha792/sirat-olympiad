#!/usr/bin/env bash
# Maintenance switch (L5, RUNBOOK section 4). While the flag file exists, nginx answers the public site with the 503
# maintenance page (and JSON `code: MAINTENANCE` for /api calls); /healthz and the PayStation IPN and callback still
# pass. Checks from the server use nginx's internal listener, which the switch does not affect:
#   $DC exec -T nginx wget -qO- http://127.0.0.1:8081/api/ready
# nginx looks for the file on every request, so no reload. This script touches only the flag file: it never runs up,
# down or restart.
# Usage: scripts/maintenance.sh on|off|status
#   status prints `maintenance: on (since <UTC time>)` or `maintenance: off` (deploy.sh reads the first two words).
set -euo pipefail
cd "$(dirname "$0")/.."

# Inside the folder compose mounts at /etc/nginx/sirat; infra/nginx/maintenance.conf looks for .../maintenance/on.
dir=infra/nginx/maintenance
flag=$dir/on
page=infra/nginx/pages/maintenance.html

since() { head -c 40 "$flag" 2>/dev/null | tr -cd '0-9TZ:-' || true; }

case "${1:-}" in
  on)
    if [ -f "$flag" ]; then
      echo "maintenance: on (already, since $(since))"
      exit 0
    fi
    # nginx's workers (not root) read the page; a clone checked out with a strict umask would hide it.
    if [ -z "$(find "$page" -perm -0004 2>/dev/null)" ]; then
      echo "maintenance: $page is missing or not world-readable; nginx would answer its own error page" >&2
      exit 1
    fi
    mkdir -p "$dir"
    tmp=$(mktemp "$dir/.on.XXXXXX")
    date -u +%Y-%m-%dT%H:%M:%SZ >"$tmp"
    chmod 644 "$tmp"
    mv -f "$tmp" "$flag"
    echo "maintenance: on (since $(since))"
    ;;
  off)
    if [ ! -f "$flag" ]; then
      echo "maintenance: off (already)"
      exit 0
    fi
    rm -f "$flag"
    echo "maintenance: off"
    ;;
  status)
    if [ -f "$flag" ]; then echo "maintenance: on (since $(since))"; else echo "maintenance: off"; fi
    ;;
  *)
    echo "usage: scripts/maintenance.sh on|off|status" >&2
    exit 2
    ;;
esac

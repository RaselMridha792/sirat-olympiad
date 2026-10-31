#!/usr/bin/env bash
# Refreshes infra/nginx/cloudflare-realip.conf (the Cloudflare ranges nginx trusts for the real client IP).
# Never installs an empty or partial list: both downloads are validated, the new config is tested with the pinned
# nginx image, and only then is the live file rewritten in place. Any failure leaves the live file untouched.
# Usage: scripts/refresh-cloudflare-ips.sh
#   then: docker compose --env-file .env -f infra/docker-compose.yml exec nginx nginx -c /etc/nginx/sirat/nginx.conf -s reload
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep container paths as written
LIVE=infra/nginx/cloudflare-realip.conf
BASE="${CF_IPS_BASE:-https://www.cloudflare.com}" # overridable only to test failure handling
DC="docker compose --env-file .env -f infra/docker-compose.yml"
MIN_V4=10
MIN_V6=5

hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
fetch() { curl -fsS --retry 2 --max-time 15 "$BASE/$1" | tr -d '\r' | awk 'NF'; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fetch ips-v4 > "$tmp/v4"
fetch ips-v6 > "$tmp/v6"

v4_re='^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$'
v6_re='^[0-9a-fA-F:]+:[0-9a-fA-F:]*/[0-9]{1,3}$'
if grep -v -E "$v4_re" "$tmp/v4" || grep -v -E "$v6_re" "$tmp/v6"; then
  echo "unexpected lines in the Cloudflare lists (shown above); live file untouched" >&2
  exit 1
fi
n4=$(wc -l < "$tmp/v4" | tr -d ' ')
n6=$(wc -l < "$tmp/v6" | tr -d ' ')
if [ "$n4" -lt "$MIN_V4" ] || [ "$n6" -lt "$MIN_V6" ]; then
  echo "only $n4 IPv4 / $n6 IPv6 ranges (need >= $MIN_V4 / >= $MIN_V6); live file untouched" >&2
  exit 1
fi

{
  echo "# Cloudflare edge ranges: real client IP is restored only from these peers, so a client that reaches the"
  echo "# origin directly cannot spoof CF-Connecting-IP. Generated $(date -u +%Y-%m-%d) from $BASE/ips-v4 and /ips-v6."
  echo "# Refresh with scripts/refresh-cloudflare-ips.sh (docs/RUNBOOK.md section 10). Never edit by hand."
  sed 's/^/set_real_ip_from /; s/$/;/' "$tmp/v4" "$tmp/v6"
  echo "real_ip_header CF-Connecting-IP;"
  echo "real_ip_recursive on;"
} > "$tmp/cloudflare-realip.conf"

# Test the new list in a copy of the nginx folder (without the certificates) on the pinned image, with the plain site
# (the production site would need the certificate; the list is used the same way by both).
mkdir -p "$tmp/nginx/sites"
cp infra/nginx/nginx.conf infra/nginx/app-locations.conf infra/nginx/security-headers.conf \
  infra/nginx/proxy_params_inline "$tmp/nginx/"
cp -R infra/nginx/sites/plain "$tmp/nginx/sites/"
cp "$tmp/cloudflare-realip.conf" "$tmp/nginx/cloudflare-realip.conf"
image=$($DC config --images | grep '^nginx:')
docker run --rm --network none -e NGINX_ENTRYPOINT_QUIET_LOGS=1 \
  -v "$(hostpath "$tmp/nginx"):/etc/nginx/sirat:ro" \
  -v "$(hostpath "$tmp/nginx/sites/plain"):/etc/nginx/templates:ro" \
  "$image" nginx -c /etc/nginx/sirat/nginx.conf -t -q

diff -u "$LIVE" "$tmp/cloudflare-realip.conf" || true
# Rewritten in place (same inode); the running container mounts the whole folder, so it sees the new content either way.
cat "$tmp/cloudflare-realip.conf" > "$LIVE"
echo "updated $LIVE ($n4 IPv4 + $n6 IPv6 ranges). Apply: $DC exec nginx nginx -c /etc/nginx/sirat/nginx.conf -s reload"

#!/usr/bin/env bash
# Real client addresses and shared addresses (L4), on the pinned nginx image, without the stack: its own Docker network
# with fixed addresses, stub upstreams that echo the X-Real-IP nginx sends, a trusted peer (standing in for Cloudflare),
# an untrusted peer and a load-test generator. It checks that:
#  - the address in CF-Connecting-IP is restored from the trusted peer only (a spoofed header from anyone else is ignored);
#  - the rate-limit key is the IPv4 address or the IPv6 /64, for every place "::" can stand;
#  - one client's 429 does not touch another, and two IPv6 addresses in one /64 share a bucket;
#  - the internal listener (127.0.0.1:8081 in the container) cannot be reached from a peer;
#  - scripts/loadtest-generators.sh on/status/off makes nginx trust a generator, and then no longer.
# It runs a copy of the tracked infra/nginx files (never the working tree, which a running stack may mount), with two
# test-only changes: the zone rates lowered, so a few requests reach a 429, and a location that returns the key.
# TLS, HSTS, the redirects and /healthz are check-sites.sh's. Usage: infra/nginx/test/check-real-ips.sh (CI's docker job)
set -euo pipefail
cd "$(dirname "$0")/../../.."
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }
hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

image=$(grep -m1 -o 'nginx:[0-9][^ ]*' infra/docker-compose.yml)
run="sirat-realip-$$"
net="$run-net"
subnet=10.250.47
nginx_ip=$subnet.10 trusted_ip=$subnet.30 untrusted_ip=$subnet.31 generator_ip=$subnet.32
tmp=$(mktemp -d)
clone=$tmp/clone
cleanup() {
  dk rm -f "$run-nginx" "$run-stub" "$run-trusted" "$run-untrusted" "$run-generator" >/dev/null 2>&1 || true
  dk network rm "$net" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

failures=0
pass() { echo "PASS $1"; }
fail() {
  echo "FAIL $1"
  failures=$((failures + 1))
}
check() { # check <name> <command...>
  local name=$1
  shift
  if "$@"; then pass "$name"; else fail "$name"; fi
}

# ---- the copy: tracked files only, then the two test-only changes ----
mkdir -p "$clone/scripts"
while IFS= read -r -d '' f; do
  mkdir -p "$clone/$(dirname "$f")"
  cp "$f" "$clone/$f"
done < <(git ls-files -z infra/nginx)
cp scripts/loadtest-generators.sh "$clone/scripts/"
mkdir -p "$clone/infra/nginx/maintenance" "$clone/infra/nginx/certs"
# The trusted peer stands in for Cloudflare's ranges.
printf 'set_real_ip_from %s;\nreal_ip_header CF-Connecting-IP;\nreal_ip_recursive on;\n' "$trusted_ip" \
  > "$clone/infra/nginx/cloudflare-realip.conf"
sed -i -e 's/rate=100r\/s/rate=1r\/m/' -e 's/rate=200r\/s/rate=1r\/m/' "$clone/infra/nginx/nginx.conf"
sed -i -e 's/burst=1000 /burst=2 /' -e 's/burst=2000 /burst=2 /' "$clone/infra/nginx/app-locations.conf"
grep -q 'rate=1r/m' "$clone/infra/nginx/nginx.conf" || { echo "FAIL the zone rates were not found in nginx.conf"; exit 1; }
sed -i 's|^  location = /healthz { return 200 "ok"; }$|&\n  location = /__sirat_key { default_type text/plain; return 200 "$sirat_limit_key"; }|' \
  "$clone/infra/nginx/sites/plain/site.conf.template"
grep -q '__sirat_key' "$clone/infra/nginx/sites/plain/site.conf.template" || { echo "FAIL the key location was not added"; exit 1; }

# ---- the network, the stub upstreams (one container answers as api:4000 and web:3000), the peers ----
dk network create --subnet "$subnet.0/24" "$net" >/dev/null
printf '%s\n' 'events {}' 'http { server { listen 4000; listen 3000; location / {' \
  '  default_type text/plain; return 200 "real=$http_x_real_ip"; } } }' > "$tmp/stub.conf"
dk run -d --name "$run-stub" --network "$net" --network-alias api --network-alias web \
  -v "$(hostpath "$tmp/stub.conf"):/stub.conf:ro" "$image" nginx -c /stub.conf -g 'daemon off;' >/dev/null
for p in trusted untrusted generator; do
  ip_var="${p}_ip"
  dk run -d --name "$run-$p" --network "$net" --ip "${!ip_var}" --entrypoint sleep "$image" 3600 >/dev/null
done
dk run -d --name "$run-nginx" --network "$net" --ip "$nginx_ip" \
  -v "$(hostpath "$clone/infra/nginx"):/etc/nginx/sirat:ro" \
  -v "$(hostpath "$clone/infra/nginx/sites/plain"):/etc/nginx/templates:ro" \
  -v "$(hostpath "$PWD/infra/nginx/entrypoint/15-public-host.envsh"):/docker-entrypoint.d/15-public-host.envsh:ro" \
  -e APP_URL=https://sirat.test -e NGINX_ENVSUBST_FILTER=PUBLIC_HOST -e NGINX_ENTRYPOINT_QUIET_LOGS=1 \
  "$image" nginx -c /etc/nginx/sirat/nginx.conf -g 'daemon off;' >/dev/null
for _ in $(seq 1 30); do
  dk exec "$run-nginx" wget -qO- http://127.0.0.1:8081/healthz >/dev/null 2>&1 && break
  sleep 1
done

# req <peer> <CF-Connecting-IP or -> <path>: "<status> <body>" of one request to nginx from that peer.
req() {
  local peer=$1 client=$2 path=$3 out code
  local -a header=()
  [ "$client" = - ] || header=(--header "CF-Connecting-IP: $client")
  if out=$(dk exec "$run-$peer" wget -q -T 5 -O- "${header[@]}" "http://$nginx_ip$path" 2>&1); then
    printf '200 %s' "$out"
  else
    code=$(sed -n 's/.*HTTP\/1\.[01] \([0-9][0-9][0-9]\).*/\1/p' <<< "$out")
    printf '%s %s' "${code:-000}" "$out"
  fi
}
is() { [ "$1" = "$2" ] || { echo "  got: $1" >&2; return 1; }; }

# ---- the restore ----
check "the trusted peer's CF-Connecting-IP is the client address upstream" \
  is "$(req trusted 203.0.113.7 /api/whoami)" "200 real=203.0.113.7"
check "an untrusted peer's CF-Connecting-IP is ignored (the peer's own address upstream)" \
  is "$(req untrusted 203.0.113.8 /api/whoami)" "200 real=$untrusted_ip"
check "an IPv6 client address is restored from the trusted peer" \
  is "$(req trusted 2001:db8:5::9 /api/whoami)" "200 real=2001:db8:5::9"

# ---- the key: the /64 for every place "::" can stand (nginx rewrites each input in canonical form first) ----
while read -r input expected; do
  check "key of $input is $expected" is "$(req trusted "$input" /__sirat_key)" "200 $expected"
done <<'EOF'
2001:db8:1:2:3:4:5:6 2001:db8:1:2
2001:db8:1:2:: 2001:db8:1:2
2001:db8:1:2::7:8 2001:db8:1:2
2001:db8:1:2:3::8 2001:db8:1:2
2001:db8:1:2:3:4:: 2001:db8:1:2
2001:db8:1::6:7:8 2001:db8:1:0
2001:db8::5:6:7:8 2001:db8:0:0
2001:db8:: 2001:db8:0:0
2001::3:4:5:6:7 2001:0:0:3
2001::8 2001:0:0:0
::2:3:4:5:6:7 0:0:2:3
::3:4:5:6:7 0:0:0:3
::1 0:0:0:0
2001:0DB8:0000:0000:0000:0000:0000:0001 2001:db8:0:0
2001:db8:0:1:0:0:0:1 2001:db8:0:1
EOF

# ---- the buckets (rates lowered in the copy: 1 a minute, burst 2, so the fourth request in a row is refused) ----
burst() { # burst <peer> <client>: the status of the fourth request in a row
  local i last=''
  for i in 1 2 3 4; do last=$(req "$1" "$2" /api/bucket); done
  printf '%s' "${last%% *}"
}
check "a client that sends too much gets 429" is "$(burst trusted 198.51.100.1)" 429
check "another IPv4 client is not touched by that 429" is "$(req trusted 198.51.100.2 /api/bucket)" "200 real=198.51.100.2"
check "an IPv6 client that sends too much gets 429" is "$(burst trusted 2001:db8:7:7::a)" 429
check "another address in the same /64 shares that bucket" is "$(req trusted 2001:db8:7:7::b /api/bucket | cut -c1-3)" 429
check "an address in the next /64 does not" is "$(req trusted 2001:db8:7:8::a /api/bucket)" "200 real=2001:db8:7:8::a"

# ---- the internal listener ----
unreachable() { ! dk exec "$run-untrusted" wget -q -T 3 -O- "http://$nginx_ip:8081/healthz" > /dev/null 2>&1; }
check "the internal listener cannot be reached from a peer" unreachable

# ---- the load-test generators (the copied script, driving this nginx container) ----
gen() { SIRAT_NGINX_CONTAINER="$run-nginx" "$clone/scripts/loadtest-generators.sh" "$@"; }
check "before: a generator's CF-Connecting-IP is ignored" \
  is "$(req generator 192.0.2.50 /api/whoami)" "200 real=$generator_ip"
out=$(gen on "$generator_ip" --hours 1 2>&1) && pass "loadtest-generators.sh on" || fail "loadtest-generators.sh on: $out"
check "on: the generator's CF-Connecting-IP is the client address" \
  is "$(req generator 192.0.2.50 /api/whoami)" "200 real=192.0.2.50"
out=$(gen status 2>&1)
check "status names the generator and an expiry" grep -q "on (expires .*) $generator_ip" <<< "$out"
out=$(gen off 2>&1) && pass "loadtest-generators.sh off" || fail "loadtest-generators.sh off: $out"
check "off: the generator's CF-Connecting-IP is ignored again" \
  is "$(req generator 192.0.2.51 /api/whoami)" "200 real=$generator_ip"
check "status after off" is "$(gen status 2>&1)" "loadtest-generators: off"
code=0
gen on 10.0.0.0/8 > /dev/null 2>&1 || code=$?
check "a range is refused as usage (exit 2)" is "$code" 2
code=0
gen on "$generator_ip" --hours 13 > /dev/null 2>&1 || code=$?
check "more than 12 hours is refused as usage (exit 2)" is "$code" 2

echo
if [ "$failures" -gt 0 ]; then
  echo "real IPs: $failures failed"
  dk logs --tail 30 "$run-nginx" 2>&1 || true
  exit 1
fi
echo "real IPs: all passed"

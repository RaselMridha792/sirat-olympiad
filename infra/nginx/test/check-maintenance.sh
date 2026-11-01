#!/usr/bin/env bash
# Checks the maintenance switch (L5) on the pinned nginx image, without the stack: its own network and containers, two
# fake upstreams answering as `api` and `web`, loopback ports, cleaned up. The switch is the real scripts/maintenance.sh,
# run in a copy of its folder layout whose flag folder is mounted over the container's, so the repo's flag is never used.
#  1. The script: on, off, status, twice in a row, a bad argument.
#  2. Both sites (sites/plain, sites/tls), flag off: pages and the API answer; the internal paths are not reachable.
#  3. Flag on:
#     - pages (any method, any path, static assets) get the 503 HTML page; other /api calls the JSON MAINTENANCE;
#       both with no-store, Retry-After and each security header exactly once (HSTS on https only);
#     - /healthz, the PayStation IPN and the callback reach the API; paths that only look like them do not;
#     - the internal listener still serves the app.
#  4. Flag off again: everything answers.
#  5. Upstreams down (a deploy gap, a restore): pages and the callback get the page with nginx's own 502; other /api
#     calls keep the JSON 502.
# Usage: infra/nginx/test/check-maintenance.sh   (CI's docker job runs it; needs docker, openssl and curl)
set -euo pipefail
cd "$(dirname "$0")/../../.."
# Git Bash on Windows: docker gets container paths as written (dk); host paths are converted as usual.
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }

hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
image=$(grep -m1 -o 'nginx:[0-9][^ ]*' infra/docker-compose.yml)
host=sirat.test
name="sirat-maint-check-$$"
net="$name-net"
tmp=$(mktemp -d)
cleanup() {
  dk rm -f "$name-plain" "$name-tls" "$name-down" "$name-api" "$name-web" >/dev/null 2>&1 || true
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
check() { # check <what> <command...>
  local what=$1
  shift
  if "$@"; then pass "$what"; else fail "$what"; fi
}

# A copy of the script's folder layout: scripts/maintenance.sh writes <copy>/infra/nginx/maintenance/on.
copy=$tmp/clone
mkdir -p "$copy/scripts" "$copy/infra/nginx/maintenance" "$copy/infra/nginx/pages" "$tmp/certs"
cp scripts/maintenance.sh "$copy/scripts/"
cp infra/nginx/pages/maintenance.html "$copy/infra/nginx/pages/"
chmod 644 "$copy/infra/nginx/pages/maintenance.html"
switch() { bash "$copy/scripts/maintenance.sh" "$@"; }

# 1. The script.
out=$(switch status)
check "status says off" test "$out" = "maintenance: off"
out=$(switch on)
check "on sets the flag" test -f "$copy/infra/nginx/maintenance/on"
check "on says since when" grep -Eq '^maintenance: on \(since [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z\)$' <<<"$out"
check "the flag is world-readable (nginx's workers check it)" test -n "$(find "$copy/infra/nginx/maintenance/on" -perm -0004)"
check "status says on" grep -q '^maintenance: on (since ' <<<"$(switch status)"
check "on twice keeps the first time" grep -q '^maintenance: on (already, since ' <<<"$(switch on)"
check "off removes the flag" test "$(switch off)" = "maintenance: off"
check "the flag is gone" test ! -e "$copy/infra/nginx/maintenance/on"
check "off twice says so" test "$(switch off)" = "maintenance: off (already)"
code=0
switch sideways >/dev/null 2>&1 || code=$?
check "a bad argument exits 2" test "$code" = 2
chmod 600 "$copy/infra/nginx/pages/maintenance.html"
code=0
switch on >/dev/null 2>&1 || code=$?
if [ "$(stat -c %a "$copy/infra/nginx/pages/maintenance.html" 2>/dev/null)" = 600 ]; then # not on Windows file systems
  check "on refuses a page nginx's workers cannot read" test "$code" = 1
  check "and sets no flag" test ! -e "$copy/infra/nginx/maintenance/on"
fi
chmod 644 "$copy/infra/nginx/pages/maintenance.html"
switch off >/dev/null

# 2.–5. nginx. Fake upstreams on a network of their own, answering every path with a marker.
cat >"$tmp/fake-api.conf" <<'EOF'
events {}
http {
  server {
    listen 4000;
    location / { default_type application/json; return 200 '{"upstream":"api","method":"$request_method"}'; }
  }
}
EOF
cat >"$tmp/fake-web.conf" <<'EOF'
events {}
http {
  server {
    listen 3000;
    location / { default_type text/html; return 200 '<!doctype html><title>web</title><p data-upstream="web">web</p>'; }
  }
}
EOF
dk network create "$net" >/dev/null
for svc in api web; do
  dk run -d --name "$name-$svc" --network "$net" --network-alias "$svc" -e NGINX_ENTRYPOINT_QUIET_LOGS=1 \
    -v "$(hostpath "$tmp/fake-$svc.conf"):/fake/nginx.conf:ro" "$image" nginx -c /fake/nginx.conf -g 'daemon off;' >/dev/null
done

MSYS2_ARG_CONV_EXCL=/CN openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 -subj "/CN=$host" \
  -addext "subjectAltName=DNS:$host" -keyout "$tmp/certs/origin.key" -out "$tmp/certs/origin.pem" 2>/dev/null
chmod 644 "$tmp/certs/origin.key" # a throwaway key: the container's nginx must be able to read it

start() { # start <container> <site> [docker run options]: nginx as compose runs it, with the copy's flag folder
  local container=$1 site=$2
  shift 2
  dk run -d --name "$container" "$@" -p 127.0.0.1::80 -p 127.0.0.1::443 \
    -v "$(hostpath "$PWD/infra/nginx"):/etc/nginx/sirat:ro" \
    -v "$(hostpath "$tmp/certs"):/etc/nginx/sirat/certs:ro" \
    -v "$(hostpath "$copy/infra/nginx/maintenance"):/etc/nginx/sirat/maintenance:ro" \
    -v "$(hostpath "$PWD/infra/nginx/sites/$site"):/etc/nginx/templates:ro" \
    -v "$(hostpath "$PWD/infra/nginx/entrypoint/15-public-host.envsh"):/docker-entrypoint.d/15-public-host.envsh:ro" \
    -e "APP_URL=https://$host" -e NGINX_ENVSUBST_FILTER=PUBLIC_HOST -e NGINX_ENTRYPOINT_QUIET_LOGS=1 \
    "$image" nginx -c /etc/nginx/sirat/nginx.conf -g 'daemon off;' >/dev/null
  for _ in $(seq 1 30); do
    dk exec "$container" curl -fs -o /dev/null http://127.0.0.1:8081/healthz 2>/dev/null && return 0
    sleep 1
  done
  echo "nginx in $container did not start" >&2
  dk logs "$container" 2>&1 | tail -20 >&2
  return 1
}
start "$name-plain" plain --network "$net"
start "$name-tls" tls --network "$net"
p_plain=$(dk port "$name-plain" 80/tcp | sed -n '1s/.*://p')
p_tls=$(dk port "$name-tls" 443/tcp | sed -n '1s/.*://p')

# fetch <site> <path> [curl options]: prints the status; headers in $tmp/h, body in $tmp/b. --path-as-is sends
# dot segments as written, so nginx (not curl) normalises them.
fetch() {
  local site=$1 path=$2
  shift 2
  case $site in
    plain) curl -s --max-time 10 --path-as-is -D "$tmp/h" -o "$tmp/b" -w '%{http_code}' "$@" "http://127.0.0.1:$p_plain$path" ;;
    tls)
      curl -sk --max-time 10 --path-as-is --resolve "$host:$p_tls:127.0.0.1" -D "$tmp/h" -o "$tmp/b" -w '%{http_code}' \
        "$@" "https://$host:$p_tls$path"
      ;;
    down)
      curl -sk --max-time 20 --path-as-is --resolve "$host:$p_down:127.0.0.1" -D "$tmp/h" -o "$tmp/b" -w '%{http_code}' \
        "$@" "https://$host:$p_down$path"
      ;;
  esac
}
status_is() { # status_is <want> <site> <path> [curl options]
  local want=$1 got
  shift
  got=$(fetch "$@") || true
  [ "$got" = "$want" ] || {
    echo "  $2: got $got, want $want"
    return 1
  }
}
reaches() { # reaches <api|web> <site> <path> [curl options]: 200 from that fake upstream
  local upstream=$1
  shift
  status_is 200 "$@" && grep -Eq "upstream[^a-z]+$upstream" "$tmp/b"
}
answer_headers() { # no-store, Retry-After and each security header exactly once; HSTS on https only
  local site=$1 h
  for h in Cache-Control Retry-After X-Content-Type-Options Referrer-Policy Content-Security-Policy-Report-Only; do
    [ "$(grep -ci "^$h:" "$tmp/h")" = 1 ] || {
      echo "  $h is not there exactly once"
      return 1
    }
  done
  grep -qi '^cache-control: no-store' "$tmp/h" || return 1
  if [ "$site" = plain ]; then
    if grep -qi '^strict-transport-security:' "$tmp/h"; then return 1; fi
  else
    [ "$(grep -ci '^strict-transport-security: max-age=300' "$tmp/h")" = 1 ]
  fi
}
page() { # page <status> <site> <path> [curl options]: the maintenance page with that status
  status_is "$@" && grep -qi '^content-type: text/html; charset=utf-8' "$tmp/h" &&
    grep -q 'data-sirat-page="maintenance"' "$tmp/b" && grep -q 'your payment is safe' "$tmp/b" && answer_headers "$2"
}
blocked() { # blocked <site> <path> [curl options]: a maintenance answer (page or JSON), never an upstream
  status_is 503 "$@" && ! grep -Eq 'upstream[^a-z]+(api|web)' "$tmp/b" &&
    grep -Eq 'data-sirat-page="maintenance"|"code":"MAINTENANCE"' "$tmp/b"
}
maintenance_json() { # maintenance_json <site> <path> [curl options]
  status_is 503 "$@" && grep -qi '^content-type: application/json' "$tmp/h" &&
    grep -q '"code":"MAINTENANCE"' "$tmp/b" && answer_headers "$1"
}
internal_reaches() { # internal_reaches <api|web> <container> <path>: through the internal listener, inside the container
  grep -Eq "upstream[^a-z]+$1" <<< "$(dk exec "$2" curl -s --max-time 10 "http://127.0.0.1:8081$3")"
}
wait_for() { # wait_for <status>: a host bind mount can show a new file a moment later (Docker Desktop)
  for _ in $(seq 1 20); do
    [ "$(fetch plain /)" = "$1" ] && [ "$(fetch tls /)" = "$1" ] && return 0
    sleep 0.5
  done
  return 1
}
json=(-H 'Content-Type: application/json')

# 2. Flag off.
for site in plain tls; do
  check "$site, off: a page reaches the web" reaches web "$site" /
  check "$site, off: /api/ready reaches the API" reaches api "$site" /api/ready
  check "$site, off: the page's internal path is not reachable" status_is 404 "$site" /_sirat/maintenance.html
  check "$site, off: the JSON's internal path is not reachable" status_is 404 "$site" /_sirat/maintenance.json
done

# 3. Flag on.
switch on >/dev/null
check "nginx sees the flag without a reload" wait_for 503
for site in plain tls; do
  check "$site, on: the home page gets the 503 page" page 503 "$site" /
  check "$site, on: a deep page with a query gets it" page 503 "$site" '/dashboard/exam/1?x=1'
  check "$site, on: a form POST gets it, not a 405" page 503 "$site" /register -X POST -d a=b
  check "$site, on: a static asset gets it" page 503 "$site" /_next/static/chunks/main.js
  check "$site, on: the page's internal path stays unreachable" status_is 404 "$site" /_sirat/maintenance.html
  check "$site, on: /api/ready gets the JSON MAINTENANCE" maintenance_json "$site" /api/ready
  check "$site, on: a login POST gets it" maintenance_json "$site" /api/auth/login -X POST "${json[@]}" -d '{}'
  check "$site, on: /healthz answers 200 ok" status_is 200 "$site" /healthz
  check "$site, on: the PayStation IPN reaches the API" \
    reaches api "$site" /api/payments/paystation/ipn -X POST "${json[@]}" -d '{"invoice_number":"T261101ABCDEFGHIJ"}'
  check "$site, on: the PayStation callback reaches the API" \
    reaches api "$site" '/api/payments/paystation/callback/T261101ABCDEFGHIJ?status=Successful&trx_id=1'
  # The exceptions are exact: a path that only looks like them gets the maintenance answer.
  check "$site, on: walking out of the callback gets the JSON" \
    maintenance_json "$site" /api/payments/paystation/callback/../../../auth/login -X POST "${json[@]}" -d '{}'
  check "$site, on: an encoded walk out of the callback gets it" \
    maintenance_json "$site" /api/payments/paystation/callback/%2e%2e/%2e%2e/%2e%2e/auth/me
  check "$site, on: more segments after the callback get it" \
    maintenance_json "$site" /api/payments/paystation/callback/T261101ABCDEFGHIJ/x
  check "$site, on: the callback without an invoice gets it" maintenance_json "$site" /api/payments/paystation/callback/
  check "$site, on: more after the IPN path gets it" maintenance_json "$site" /api/payments/paystation/ipn/x
  check "$site, on: another case of the IPN path gets the page" page 503 "$site" /API/payments/paystation/ipn -X POST
  check "$site, on: another case of the callback gets it" page 503 "$site" /Api/payments/paystation/callback/T261101ABCDEFGHIJ
  check "$site, on: another case of /healthz gets it" page 503 "$site" /HEALTHZ
  check "$site, on: another case of a login gets it" page 503 "$site" /API/auth/login -X POST "${json[@]}" -d '{}'
  # Paths nginx normalises into or out of an exception: only the exact path as sent passes.
  check "$site, on: /api/../<page> gets it" blocked "$site" /api/../dashboard
  check "$site, on: an encoded /api/%2e%2e/<page> gets it" blocked "$site" /api/%2e%2e/dashboard
  check "$site, on: /healthz/../<page> gets it" blocked "$site" /healthz/../dashboard
  check "$site, on: a page walking into the IPN gets it" \
    blocked "$site" /dashboard/../api/payments/paystation/ipn -X POST "${json[@]}" -d '{}'
  check "$site, on: an encoded walk into the IPN gets it" \
    blocked "$site" /x/%2e%2e/api/payments/paystation/ipn -X POST "${json[@]}" -d '{}'
  check "$site, on: a dot segment inside the IPN path gets it" \
    blocked "$site" /api/payments/./paystation/ipn -X POST "${json[@]}" -d '{}'
  check "$site, on: a double slash before the IPN path gets it" \
    blocked "$site" //api/payments/paystation/ipn -X POST "${json[@]}" -d '{}'
  check "$site, on: an encoded letter in the IPN path gets it" \
    blocked "$site" /api/payments/paystation/%69pn -X POST "${json[@]}" -d '{}'
  check "$site, on: the IPN walking out of itself gets it" \
    blocked "$site" /api/payments/paystation/ipn/../../../auth/login -X POST "${json[@]}" -d '{}'
  check "$site, on: a callback invoice of dots gets it" blocked "$site" /api/payments/paystation/callback/..
  check "$site, on: an encoded callback invoice gets it" blocked "$site" /api/payments/paystation/callback/%54261101ABC
  check "$site, on: the IPN with a query still reaches the API" \
    reaches api "$site" '/api/payments/paystation/ipn?x=1' -X POST "${json[@]}" -d '{}'
done
check "on: the internal listener still serves the API" internal_reaches api "$name-tls" /api/ready
check "on: the internal listener still serves pages" internal_reaches web "$name-tls" /

# 4. Flag off again.
switch off >/dev/null
check "nginx sees the flag gone without a reload" wait_for 200
for site in plain tls; do
  check "$site, off again: a page reaches the web" reaches web "$site" /dashboard
  check "$site, off again: /api/ready reaches the API" reaches api "$site" /api/ready
done

# 5. Upstreams down: no fake upstreams on this container's network (the default bridge has no Docker DNS).
start "$name-down" tls
p_down=$(dk port "$name-down" 443/tcp | sed -n '1s/.*://p')
check "down: a page gets the maintenance page with nginx's 502" page 502 down /dashboard
check "down: a static asset gets it too" page 502 down /_next/static/chunks/main.js
check "down: the PayStation callback gets the page, not JSON" page 502 down /api/payments/paystation/callback/T261101ABCDEFGHIJ
check "down: other /api calls keep the JSON 502" status_is 502 down /api/ready
check "down: ... and it is the JSON" grep -q '"code":"BAD_GATEWAY"' "$tmp/b"
check "down: the IPN keeps the JSON 502 (PayStation retries)" \
  status_is 502 down /api/payments/paystation/ipn -X POST "${json[@]}" -d '{}'

if [ "$failures" -gt 0 ]; then
  echo "check-maintenance: $failures failed" >&2
  dk logs "$name-tls" 2>&1 | tail -20 >&2
  exit 1
fi
echo "check-maintenance: all passed"

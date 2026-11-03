#!/usr/bin/env bash
# Checks both nginx sites on the pinned image, without the stack: its own container, loopback ports, cleaned up.
#  1. `nginx -t` on the dev/CI site (sites/plain) and on the production site (sites/tls, a throwaway certificate).
#  2. The production site answering:
#     - https /healthz with exactly one HSTS header and the security headers;
#     - nginx's own JSON errors with the same headers;
#     - port 80: /healthz for any name, the redirect for the site's own name only, no host name for an IP;
#     - the refusal of any other name on 443, and the internal listener;
#     - no query string or Referer in nginx's logs: for a 200, an upstream that is down (error level) and a full temp
#       disk (crit level: a second container with a 64 KB tmpfs).
# Usage: infra/nginx/test/check-sites.sh   (CI's docker job runs it; needs docker, openssl and curl)
set -euo pipefail
cd "$(dirname "$0")/../../.."
# Git Bash on Windows: docker gets container paths as written (dk); host paths are converted as usual.
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }

hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
image=$(grep -m1 -o 'nginx:[0-9][^ ]*' infra/docker-compose.yml)
host=sirat.test
name="sirat-nginx-check-$$"
tmp=$(mktemp -d)
cleanup() {
  dk rm -f "$name" "$name-disk" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

failures=0
pass() { echo "PASS $1"; }
fail() {
  echo "FAIL $1"
  failures=$((failures + 1))
}

MSYS2_ARG_CONV_EXCL=/CN openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 -subj "/CN=$host" \
  -addext "subjectAltName=DNS:$host" -keyout "$tmp/origin.key" -out "$tmp/origin.pem" 2>/dev/null
chmod 644 "$tmp/origin.key" # a throwaway key: the container's nginx must be able to read it

mounts() { # the compose mounts, with the throwaway certificate over the certs folder
  printf '%s\n' \
    -v "$(hostpath "$PWD/infra/nginx"):/etc/nginx/sirat:ro" \
    -v "$(hostpath "$tmp"):/etc/nginx/sirat/certs:ro" \
    -v "$(hostpath "$PWD/infra/nginx/sites/$1"):/etc/nginx/templates:ro" \
    -v "$(hostpath "$PWD/infra/nginx/entrypoint/15-public-host.envsh"):/docker-entrypoint.d/15-public-host.envsh:ro" \
    -e "APP_URL=https://$host" -e NGINX_ENVSUBST_FILTER=PUBLIC_HOST -e NGINX_ENTRYPOINT_QUIET_LOGS=1
}

# 1. Config tests. The image's entrypoint renders the template first, because the command starts with `nginx`.
for site in plain tls; do
  mapfile -t opts < <(mounts "$site")
  if dk run --rm --network none "${opts[@]}" "$image" nginx -c /etc/nginx/sirat/nginx.conf -t -q; then
    pass "nginx -t, $site site"
  else
    fail "nginx -t, $site site"
  fi
done

# 2. The production site, running.
mapfile -t opts < <(mounts tls)
dk run -d --name "$name" -p 127.0.0.1::80 -p 127.0.0.1::443 "${opts[@]}" \
  "$image" nginx -c /etc/nginx/sirat/nginx.conf -g 'daemon off;' >/dev/null
for _ in $(seq 1 30); do
  dk exec "$name" wget -qO- http://127.0.0.1:8081/healthz >/dev/null 2>&1 && break
  sleep 1
done
p80=$(dk port "$name" 80/tcp | sed -n '1s/.*://p')
p443=$(dk port "$name" 443/tcp | sed -n '1s/.*://p')
https() { curl -sk --max-time 10 --resolve "$host:$p443:127.0.0.1" "$@"; }

headers=$(https -D - -o /dev/null "https://$host:$p443/healthz")
grep -q '^HTTP/[0-9.]* 200' <<< "$headers" && pass "https /healthz answers 200" || fail "https /healthz answers 200"
[ "$(echo "$headers" | grep -ci '^strict-transport-security: max-age=300')" = 1 ] &&
  pass "exactly one HSTS header (max-age=300)" || fail "exactly one HSTS header (max-age=300)"
for h in X-Content-Type-Options Referrer-Policy Content-Security-Policy-Report-Only Permissions-Policy; do
  grep -qi "^$h:" <<< "$headers" && pass "$h on https" || fail "$h on https"
done
grep -qi '^permissions-policy: camera=(), microphone=(), geolocation=()' <<< "$headers" &&
  pass "Permissions-Policy turns off the camera, the microphone and the location" ||
  fail "Permissions-Policy turns off the camera, the microphone and the location"

# The API is not running here, so nginx answers with its own JSON 502 (a named location with its own add_header).
q="q$RANDOM$RANDOM$RANDOM"
r="r$RANDOM$RANDOM$RANDOM"
error=$(https -D - -H "Referer: https://$host/admin/users?q=$r" "https://$host:$p443/api/health?q=$q")
grep -q 'BAD_GATEWAY' <<< "$error" && pass "nginx's own 502 is JSON" || fail "nginx's own 502 is JSON"
once=0
for h in Strict-Transport-Security X-Content-Type-Options Referrer-Policy Content-Security-Policy-Report-Only Permissions-Policy; do
  [ "$(echo "$error" | grep -ci "^$h:")" = 1 ] || once=1
done
[ "$once" = 0 ] && pass "nginx's own errors carry each security header exactly once" ||
  fail "nginx's own errors carry each security header exactly once"

redirect=$(curl -s --max-time 10 -D - -o /dev/null -H "Host: $host" "http://127.0.0.1:$p80/some/page?x=1")
grep -q '^HTTP/[0-9.]* 301' <<< "$redirect" &&
  grep -qi "^location: https://$host/some/page?x=1" <<< "$redirect" &&
  pass "http redirects the site's own name to https://$host" || fail "http redirects the site's own name to https://$host"
if grep -qi '^location:' <<< "$(curl -s --max-time 10 -D - -o /dev/null -H 'Host: 203.0.113.10' "http://127.0.0.1:$p80/")"; then
  fail "http on the bare IP does not show the host name"
else
  pass "http on the bare IP does not show the host name"
fi
[ "$(curl -s --max-time 10 "http://127.0.0.1:$p80/healthz")" = ok ] &&
  pass "http /healthz answers without a redirect" || fail "http /healthz answers without a redirect"
if curl -sk --max-time 10 --resolve "other.test:$p443:127.0.0.1" -o /dev/null "https://other.test:$p443/"; then
  fail "another name is refused during the handshake"
else
  pass "another name is refused during the handshake"
fi
[ "$(dk exec "$name" wget -qO- http://127.0.0.1:8081/healthz)" = ok ] &&
  pass "the internal listener answers inside the container" || fail "the internal listener answers inside the container"
dk port "$name" 8081/tcp >/dev/null 2>&1 &&
  fail "the internal listener is not published" || pass "the internal listener is not published"

sleep 1
logs=$(dk logs "$name" 2>&1)
grep -q '"GET /api/health HTTP' <<< "$logs" && pass "the request is in the access log, path only" ||
  fail "the request is in the access log, path only"
if grep -q -e "$q" -e "$r" <<< "$logs"; then
  fail "no query string or Referer in nginx's logs"
else
  pass "no query string or Referer in nginx's logs"
fi

# 3. A full temp disk: nginx cannot buffer a 512 KB body and logs a crit line, which would carry the request line and
#    the referrer. Only the access log (path only) may mention the request.
q2="q$RANDOM$RANDOM$RANDOM"
r2="r$RANDOM$RANDOM$RANDOM"
dk run -d --name "$name-disk" --tmpfs /var/cache/nginx:size=64k "${opts[@]}" \
  "$image" nginx -c /etc/nginx/sirat/nginx.conf -g 'daemon off;' >/dev/null
for _ in $(seq 1 30); do
  dk exec "$name-disk" wget -qO- http://127.0.0.1:8081/healthz >/dev/null 2>&1 && break
  sleep 1
done
status=$(dk exec "$name-disk" sh -c "head -c 524288 /dev/zero > /tmp/body && curl -sk -o /dev/null -w '%{http_code}' \
  --resolve $host:443:127.0.0.1 -H 'Referer: https://$host/admin/users?q=$r2' --data-binary @/tmp/body \
  'https://$host/api/auth/login?q=$q2'")
[ "$status" = 500 ] && pass "a full temp disk answers 500 (the crit path ran)" ||
  fail "a full temp disk answers 500 (the crit path ran; got $status)"
sleep 1
disklogs=$(dk logs "$name-disk" 2>&1)
grep -q '"POST /api/auth/login HTTP' <<< "$disklogs" && pass "the full-disk request is in the access log, path only" ||
  fail "the full-disk request is in the access log, path only"
if grep -q -e "$q2" -e "$r2" <<< "$disklogs"; then
  fail "no query string or Referer in nginx's logs at crit level"
else
  pass "no query string or Referer in nginx's logs at crit level"
fi

if [ "$failures" -gt 0 ]; then
  echo "check-sites: $failures failed" >&2
  dk logs "$name" 2>&1 | tail -20 >&2
  exit 1
fi
echo "check-sites: all passed"

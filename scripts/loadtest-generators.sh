#!/usr/bin/env bash
# Load-test generators (L4, LAUNCH-PLAN section 3, RUNBOOK section 10). For a k6 run, nginx takes CF-Connecting-IP from
# up to 4 generator machines, for a few hours, as it does from Cloudflare. A generator connects straight to the server
# on 443 (SNI and Host = the public host) and sends `CF-Connecting-IP: <simulated client address>`, so a few machines
# can play many clients and shared IPs. The header from anyone else stays ignored.
#
#   scripts/loadtest-generators.sh on <ip>[,<ip>...] [--hours N]   trust these generators: single IPv4 or IPv6
#                                                                   addresses, at most 4, for N hours (default 2, max 12)
#   scripts/loadtest-generators.sh off                              trust none again (idempotent)
#   scripts/loadtest-generators.sh status                           on or off, the addresses and the expiry
#
# Exit codes: 0 done, 1 failed (the previous state is kept), 2 usage.
# The file is infra/nginx/loadtest-realip.local.conf (git-ignored): a first line `# expires <UTC ISO 8601>`, then one
# `set_real_ip_from <ip>;` per address. nginx.conf includes loadtest-realip*.conf, so no file means no generator. Each
# change is tested with `nginx -t` in the running nginx container, then nginx is reloaded; a failure puts the previous
# file back (or none) and reloads nothing. Nothing removes the file at its expiry: status says when it has expired.
# Run as the deploy user from the clone. Compose runs as the VPS `$DC`, built the way scripts/deploy.sh builds it:
#   docker compose --env-file .env [--env-file /var/lib/sirat/release.env] -f infra/docker-compose.yml
# Tests only: SIRAT_NGINX_CONTAINER=<container> runs the nginx commands with `docker exec <container>` instead
# (infra/nginx/test/check-real-ips.sh). Nothing here is secret, and no .env value is read or printed.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep container paths as written

FILE=infra/nginx/loadtest-realip.local.conf
SEEN_AS=/etc/nginx/sirat/loadtest-realip.local.conf # the same file in the nginx container (compose's folder mount)
RELEASE_FILE=/var/lib/sirat/release.env
NGINX=(nginx -c /etc/nginx/sirat/nginx.conf)
MAX_ADDRESSES=4
MAX_HOURS=12

say() { echo "loadtest-generators: $*"; }
fail() {
  echo "loadtest-generators: $*" >&2
  exit 1
}
usage() {
  [ -z "${1:-}" ] || echo "loadtest-generators: $1" >&2
  echo "usage: scripts/loadtest-generators.sh on <ip>[,<ip>...] [--hours N] | off | status" >&2
  exit 2
}

if [ -n "${SIRAT_NGINX_CONTAINER:-}" ]; then
  in_nginx() { docker exec "$SIRAT_NGINX_CONTAINER" "$@"; }
else
  DC=(docker compose --env-file .env)
  if [ -f "$RELEASE_FILE" ]; then DC+=(--env-file "$RELEASE_FILE"); fi
  DC+=(-f infra/docker-compose.yml)
  in_nginx() { "${DC[@]}" exec -T nginx "$@"; }
fi

# ---- addresses: one IPv4 or IPv6 address each; no prefix length, zone, brackets, IPv4 tail or host name ----
is_ipv4() {
  local octet='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
  local re="^${octet}\.${octet}\.${octet}\.${octet}\$"
  [[ $1 =~ $re ]]
}
is_ipv6() {
  local h='[0-9A-Fa-f]{1,4}' head tail colons groups=0
  local full="^${h}(:${h}){7}\$" part="^${h}(:${h})*\$"
  if [[ $1 =~ $full ]]; then return 0; fi
  [[ $1 == *::* ]] || return 1
  head=${1%%::*}
  tail=${1#*::}
  # Each side of the one "::" is empty or whole groups (a second "::" leaves an empty group in the tail).
  if [ -n "$head" ]; then
    [[ $head =~ $part ]] || return 1
    colons=${head//[^:]/}
    groups=$((groups + ${#colons} + 1))
  fi
  if [ -n "$tail" ]; then
    [[ $tail =~ $part ]] || return 1
    colons=${tail//[^:]/}
    groups=$((groups + ${#colons} + 1))
  fi
  [ "$groups" -le 7 ]
}

# ---- the state: the file and what nginx's include also matches ----
status_line() {
  local expiry end when
  local -a addresses=()
  if [ ! -e "$FILE" ]; then
    say off
    return 0
  fi
  expiry=$(sed -n '1s/^# expires \([0-9]\{4\}-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z\)$/\1/p' "$FILE")
  mapfile -t addresses < <(sed -n 's/^set_real_ip_from \([0-9A-Fa-f.:]*\);$/\1/p' "$FILE")
  if [ -n "$expiry" ] && end=$(date -u -d "$expiry" +%s 2>/dev/null); then
    if [ "$(date -u +%s)" -lt "$end" ]; then when="expires $expiry"; else when="EXPIRED $expiry: turn it off"; fi
  else
    when="no readable expiry: turn it off"
  fi
  say "on ($when) ${addresses[*]:-no address}"
}
warn_others() { # other files nginx's include matches: not this script's, so `off` leaves them trusted
  local f
  for f in infra/nginx/loadtest-realip*.conf; do
    if [ -e "$f" ] && [ "$f" != "$FILE" ]; then
      echo "loadtest-generators: WARNING: nginx also includes $f, which this script does not manage" >&2
    fi
  done
}

# ---- changes ----
work=''
placing=''
cleanup() {
  if [ -n "$placing" ]; then rm -f "$placing"; fi
  if [ -n "$work" ]; then rm -rf "$work"; fi
}
trap cleanup EXIT

preflight() {
  [ "$(id -u)" != 0 ] || fail "do not run as root: run as the deploy user from the clone"
  [ -f infra/nginx/nginx.conf ] || fail "no infra/nginx/nginx.conf in $PWD: run the script from the clone"
  if [ -z "${SIRAT_NGINX_CONTAINER:-}" ]; then
    [ -f .env ] || fail "no .env in $PWD: run the script from the clone on the server"
  fi
  in_nginx nginx -v >/dev/null 2>&1 || fail "cannot run nginx in the nginx container: is it up? (\$DC ps nginx)"
  work=$(mktemp -d)
}
place() { # place <file>: it becomes $FILE in one rename (only nginx's master reads it, as root; 644 like the rest)
  placing=$(mktemp infra/nginx/.loadtest-realip.local.conf.XXXXXX)
  cat "$1" >"$placing"
  chmod 644 "$placing"
  mv -f "$placing" "$FILE"
  placing=''
}
restore() { # the previous state: its file, or none
  if [ -f "$work/previous" ]; then place "$work/previous"; else rm -f "$FILE"; fi
}
nginx_sees() { # nginx_sees present|absent: the container shows what the clone now holds. A Docker Desktop bind mount
  # can lag a moment; a container that mounts another folder never matches.
  local i got
  for ((i = 0; i < 20; i++)); do
    if [ "$1" = absent ]; then
      if in_nginx test ! -e "$SEEN_AS" 2>/dev/null; then return 0; fi
    else
      got=$(in_nginx cat "$SEEN_AS" 2>/dev/null) || got=''
      if [ "$got" = "$(cat "$FILE")" ]; then return 0; fi
    fi
    sleep 0.5
  done
  return 1
}
apply() { # nginx -t, then a reload; on a failure the previous state comes back and nothing is reloaded
  local out
  if ! out=$(in_nginx "${NGINX[@]}" -t 2>&1); then
    restore
    printf '%s\n' "$out" >&2
    fail "nginx -t failed (above): the previous state is back, nginx was not reloaded"
  fi
  if ! out=$(in_nginx "${NGINX[@]}" -s reload 2>&1); then
    restore
    printf '%s\n' "$out" >&2
    fail "the reload failed (above): the previous state is back"
  fi
}

cmd_on() { # cmd_on <hours> <address>...
  local hours=$1 expires address
  shift
  preflight
  if [ -f "$FILE" ]; then cp "$FILE" "$work/previous"; fi
  expires=$(date -u -d "+$hours hours" +%Y-%m-%dT%H:%M:%SZ)
  {
    echo "# expires $expires"
    for address in "$@"; do echo "set_real_ip_from $address;"; done
  } >"$work/new"
  place "$work/new"
  if ! nginx_sees present; then
    restore
    fail "the nginx container does not show the new $FILE (does it mount this clone?): the previous state is back"
  fi
  apply
  status_line
  warn_others
}
cmd_off() {
  local had=0
  preflight
  if [ -f "$FILE" ]; then
    had=1
    cp "$FILE" "$work/previous"
    rm -f "$FILE"
  fi
  if ! nginx_sees absent; then
    restore
    fail "the nginx container still shows $SEEN_AS (does it mount this clone?): the previous state is back"
  fi
  # Reloaded even without a file: an earlier `off` may have removed it and then failed to reload.
  apply
  if [ "$had" = 1 ]; then say off; else say "off (already)"; fi
  warn_others
}

case "${1:-}" in
  on)
    shift
    hours=2
    list=''
    while [ "$#" -gt 0 ]; do
      case $1 in
        --hours)
          [ "$#" -ge 2 ] || usage "--hours needs a number"
          hours=$2
          shift 2
          ;;
        --hours=*)
          hours=${1#--hours=}
          shift
          ;;
        -*) usage "unknown option: $1" ;;
        *)
          [ -z "$list" ] || usage "give the addresses as one comma-separated list"
          list=$1
          shift
          ;;
      esac
    done
    [ -n "$list" ] || usage "on needs at least one address"
    if ! [[ $hours =~ ^[1-9][0-9]?$ ]] || [ "$hours" -gt "$MAX_HOURS" ]; then
      usage "--hours must be a whole number from 1 to $MAX_HOURS"
    fi
    case $list in ,* | *, | *,,*) usage "an empty address in the list" ;; esac
    IFS=, read -r -a addresses <<<"$list"
    [ "${#addresses[@]}" -le "$MAX_ADDRESSES" ] || usage "at most $MAX_ADDRESSES addresses"
    declare -A listed=()
    for address in "${addresses[@]}"; do
      is_ipv4 "$address" || is_ipv6 "$address" || usage "not a single IPv4 or IPv6 address: $address"
      [ -z "${listed[${address,,}]:-}" ] || usage "listed twice: $address"
      listed[${address,,}]=1
    done
    cmd_on "$hours" "${addresses[@]}"
    ;;
  off)
    [ "$#" -eq 1 ] || usage
    cmd_off
    ;;
  status)
    [ "$#" -eq 1 ] || usage
    status_line
    warn_others
    ;;
  *) usage ;;
esac

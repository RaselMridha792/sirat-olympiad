#!/usr/bin/env bash
# scripts/loadtest-generators-left.sh on files in a temp folder (A2's loadtest-realip*.conf): nothing when there is
# none, the minutes to the earliest expiry, negative at once past it or without a readable expiry line, every matching
# file counted and other names ignored. Plain bash and GNU date (CI's checks job). Usage: bash scripts/test/loadtest-generators-left.test.sh
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
T=$(mktemp -d)
trap 'chmod -R u+rwx "$T" 2> /dev/null; rm -rf "$T"' EXIT
NOW=$(date -u +%s)
export NOW
left() { bash "$SRC/scripts/loadtest-generators-left.sh" "$T"; }
at() { date -u -d "@$((NOW + $1))" +"${2:-%Y-%m-%dT%H:%M:%SZ}"; }
file() { printf '%s\nset_real_ip_from 203.0.113.5;\n' "$2" > "$T/$1"; }
fails=0
expect() { if [ "$2" = "$3" ]; then echo "  ok    $1"; else echo "  FAIL  $1: got '$2', want '$3'"; fails=$((fails + 1)); fi; }

expect "no file: nothing (off)" "$(left)" ""
file loadtest-realip.local.conf "# expires $(at $((90 * 60 + 30)))"
expect "on: the minutes to the expiry" "$(left)" 90
file loadtest-realip.local.conf "# expires $(at -30 '%Y-%m-%dT%H:%M:%S.000Z')"
expect "30 s past the expiry (fractional seconds): -1 at once" "$(left)" -1
file loadtest-realip.local.conf "# expires $(at 0)"
expect "exactly at the expiry: 0, still a warning" "$(left)" 0
file loadtest-realip.local.conf "set_real_ip_from 203.0.113.9;"
expect "no expiry line: -1" "$(left)" -1
file loadtest-realip.local.conf "# expires tomorrow-ish"
expect "an expiry that is not a date: -1" "$(left)" -1
file loadtest-realip.local.conf "# expires $(at $((120 * 60)))"
file loadtest-realip-second.conf "# expires $(at -3600)"
expect "two files: the earliest expiry wins" "$(left)" -60
rm -f "$T/loadtest-realip-second.conf"
file realip-other.conf "# expires $(at -3600)"
file loadtest-realip.conf.bak "# expires $(at -3600)"
expect "other names are not nginx's wildcard: ignored" "$(left)" 120
if [ "$(id -u)" != 0 ]; then
  chmod 000 "$T/loadtest-realip.local.conf"
  expect "an unreadable file: -1" "$(left)" -1
  chmod 644 "$T/loadtest-realip.local.conf"
fi
rm -f "$T"/*
expect "all removed (off): nothing again" "$(left)" ""

echo "loadtest-generators-left test: $fails failed"
[ "$fails" = 0 ]

#!/usr/bin/env bash
# The trusted load-test generators (A2's scripts/loadtest-generators.sh, LAUNCH-PLAN L14) as one number: the minutes
# until the earliest `# expires <UTC ISO 8601>` first line among the loadtest-realip*.conf files of the folder (default
# infra/nginx, which nginx includes by that wildcard). Negative once any is past its expiry or has no readable expiry
# line; nothing at all when no such file exists (off). Nothing removes the file at its expiry, so:
#   - monitor.sh reports the number (ops-check `trusted_generators`: a warning while on, critical past the expiry);
#   - prelaunch-check.sh fails while it prints anything.
# Usage: scripts/loadtest-generators-left.sh [folder]   (NOW=<epoch seconds> for tests)
set -euo pipefail
dir=${1:-"$(cd "$(dirname "$0")/.." && pwd)/infra/nginx"}
now=${NOW:-$(date -u +%s)}
min=''
for f in "$dir"/loadtest-realip*.conf; do
  [ -e "$f" ] || continue
  expires=''
  if [ -r "$f" ]; then expires=$(sed -n '1s/^# expires \([0-9][0-9TZ:.+-]*\)$/\1/p' "$f"); fi
  if [ -n "$expires" ] && at=$(date -u -d "$expires" +%s 2> /dev/null); then
    # Rounded down, so a second past the expiry is already -1 (bash division truncates toward zero).
    if [ "$at" -ge "$now" ]; then m=$(((at - now) / 60)); else m=$(((at - now - 59) / 60)); fi
  else
    m=-1
  fi
  if [ -z "$min" ] || [ "$m" -lt "$min" ]; then min=$m; fi
done
[ -z "$min" ] || echo "$min"

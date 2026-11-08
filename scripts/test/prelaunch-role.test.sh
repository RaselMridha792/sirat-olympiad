#!/usr/bin/env bash
# prelaunch-check.sh's runtime_role() on stubbed containers and logs: it passes only when every API and worker replica's
# newest `database role=` boot line says sirat_app and superuser=false. CI's development stack connects as the owner
# until L8, so this is where the passing case is proven. Plain bash. Usage: bash scripts/test/prelaunch-role.test.sh
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
fn=$(sed -n '/^runtime_role() {/,/^}/p' "$SRC/scripts/prelaunch-check.sh")
[ -n "$fn" ] || { echo "runtime_role() not found in scripts/prelaunch-check.sh"; exit 1; }
eval "$fn"

declare -A LOGS=()
REPLICAS_API="a1 a2"
REPLICAS_WORKER="w1"
service_ids() { case "$1" in api) echo "$REPLICAS_API" ;; worker) echo "$REPLICAS_WORKER" ;; esac; }
docker() { [ "$1" = logs ] && printf '%s\n' "${LOGS[$2]:-}"; }

ok='{"level":30,"context":"Database","msg":"database role=sirat_app superuser=false"}'
owner='{"level":30,"context":"Database","msg":"database role=sirat superuser=true"}'
fails=0
expect() {
  local got=pass
  runtime_role || got=fail
  if [ "$got" = "$1" ]; then echo "  ok    $2"; else echo "  FAIL  $2: got $got, want $1"; fails=$((fails + 1)); fi
}

LOGS=([a1]="$ok" [a2]="$ok" [w1]="$ok")
expect pass "every API and worker replica on sirat_app"
LOGS=([a1]="$ok" [a2]="$owner" [w1]="$ok")
expect fail "one API replica connects as the owner (a superuser)"
LOGS=([a1]="$ok" [a2]="$ok" [w1]="no such line")
expect fail "the worker logged no role line"
LOGS=([a1]="$owner"$'\n'"$ok" [a2]="$ok" [w1]="$ok")
expect pass "restarted after the switch: the newest line counts"
LOGS=([a1]="$ok"$'\n'"$owner" [a2]="$ok" [w1]="$ok")
expect fail "switched back to the owner: the newest line counts"
LOGS=([a1]='database role=sirat_app_x superuser=false' [a2]="$ok" [w1]="$ok")
expect fail "a look-alike role name"
LOGS=([a1]='database role=sirat_app superuser=true' [a2]="$ok" [w1]="$ok")
expect fail "sirat_app made a superuser"
REPLICAS_WORKER=""
LOGS=([a1]="$ok" [a2]="$ok")
expect fail "no worker container"

[ "$fails" = 0 ] && echo "prelaunch-role: all cases pass" || { echo "prelaunch-role: $fails failed"; exit 1; }

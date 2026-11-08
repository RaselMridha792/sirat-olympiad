#!/usr/bin/env bash
# prelaunch-check.sh's two_factor_required() on a throwaway Postgres 17 (its own container, removed at the end): it
# passes only while settings.two_factor_required_roles names both admin and manager, or the row is missing (the API
# reads that as required); a value without either role, and a query that fails, fail. CI's development stack keeps
# the seed default, so this is where the failing cases are proven. Usage: bash scripts/test/prelaunch-2fa-requirement.test.sh
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
fn=$(sed -n '/^two_factor_required() {/,/^}/p' "$SRC/scripts/prelaunch-check.sh")
[ -n "$fn" ] || { echo "two_factor_required() not found in scripts/prelaunch-check.sh"; exit 1; }
eval "$fn"

NAME="sirat-prelaunch-2fa-test-$$"
trap 'docker rm -f "$NAME" > /dev/null 2>&1' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=throwaway-test-only postgres:17-alpine > /dev/null || exit 1
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1 && break
  sleep 1
done
sleep 1
# The same call shape as prelaunch-check.sh's pg(): one statement, tuples only, unaligned, errors stop it.
pg() { docker exec "$NAME" psql -h 127.0.0.1 -U postgres -d postgres -tAX -v ON_ERROR_STOP=1 -c "$1" 2> /dev/null; }
pg 'create table settings (key text primary key, value jsonb not null)' > /dev/null || { echo "setup failed"; exit 1; }

fails=0
expect() {
  local got=pass
  two_factor_required || got=fail
  if [ "$got" = "$1" ]; then echo "  ok    $2"; else echo "  FAIL  $2: got $got, want $1"; fails=$((fails + 1)); fi
}
set_row() {
  pg "delete from settings where key = 'two_factor_required_roles'" > /dev/null
  [ -z "$1" ] || pg "insert into settings values ('two_factor_required_roles', '$1'::jsonb)" > /dev/null
}

set_row ''
expect pass "no row: required (as the API reads it)"
set_row '["admin","manager"]'
expect pass "the default: admin and manager"
set_row '["manager","admin"]'
expect pass "both, in another order"
set_row '[]'
expect fail "switched off (none)"
set_row '["admin"]'
expect fail "admin only"
set_row '["manager"]'
expect fail "manager only"
pg 'insert into settings values ($$registration_open$$, $$false$$)' > /dev/null
set_row '[]'
expect fail "switched off, with other settings present"
pg 'drop table settings' > /dev/null
expect fail "the query fails (no settings table)"

[ "$fails" = 0 ] && echo "prelaunch-2fa-requirement: all cases pass" || { echo "prelaunch-2fa-requirement: $fails failed"; exit 1; }

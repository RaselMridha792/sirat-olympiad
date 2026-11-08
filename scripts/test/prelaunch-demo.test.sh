#!/usr/bin/env bash
# prelaunch-check.sh's no_demo_data() on a throwaway Postgres 17 (its own container, removed at the end): it passes
# only while no demo batch, registered row, demo account (marker or domain, any case), demo exam or demo announcement
# is left; a query that fails (no table) fails too. Usage: bash scripts/test/prelaunch-demo.test.sh
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
fn=$(sed -n '/^no_demo_data() {/,/^}/p' "$SRC/scripts/prelaunch-check.sh")
[ -n "$fn" ] || { echo "no_demo_data() not found in scripts/prelaunch-check.sh"; exit 1; }
eval "$fn"

NAME="sirat-prelaunch-demo-test-$$"
trap 'docker rm -f "$NAME" > /dev/null 2>&1' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=throwaway-test-only postgres:17-alpine > /dev/null || exit 1
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1 && break
  sleep 1
done
sleep 1
# The same call shape as prelaunch-check.sh's pg(): one statement, tuples only, unaligned, errors stop it.
pg() { docker exec "$NAME" psql -h 127.0.0.1 -U postgres -d postgres -tAX -v ON_ERROR_STOP=1 -c "$1" 2> /dev/null; }

fails=0
expect() {
  local got=pass
  no_demo_data || got=fail
  if [ "$got" = "$1" ]; then echo "  ok    $2"; else echo "  FAIL  $2: got $got, want $1"; fails=$((fails + 1)); fi
}

expect fail "no tables yet: the query fails"
pg "create table demo_batches (id int primary key);
    create table demo_records (table_name text, row_id text);
    create table users (id int primary key, email text not null, demo_batch_id int);
    create table exams (id int primary key, demo_batch_id int);
    create table announcements (id int primary key, demo_batch_id int);
    insert into users values (1, 'student@example.com', null);
    insert into exams values (1, null);
    insert into announcements values (1, null);" > /dev/null || { echo "setup failed"; exit 1; }
expect pass "real rows only"

case_row() {
  pg "$1" > /dev/null || { echo "  FAIL  setup: $2"; fails=$((fails + 1)); return; }
  expect fail "$2"
  pg "$3" > /dev/null
  expect pass "$2: removed again"
}
case_row "insert into demo_batches values (7)" "a batch" "delete from demo_batches"
case_row "insert into demo_records values ('users', '9')" "a registered row" "delete from demo_records"
case_row "insert into users values (9, 'x@example.com', 7)" "a user with the marker" "delete from users where id = 9"
case_row "insert into users values (9, 'Student-001@DEMO.sirat.invalid', null)" "a demo address, any case" \
  "delete from users where id = 9"
case_row "insert into exams values (9, 7)" "a demo exam" "delete from exams where id = 9"
case_row "insert into announcements values (9, 7)" "a demo announcement" "delete from announcements where id = 9"
pg "insert into users values (9, 'a@ci.invalid', null)" > /dev/null
expect pass "another .invalid domain is not demo data"

[ "$fails" = 0 ] && echo "prelaunch no_demo_data: all cases pass" || { echo "prelaunch no_demo_data: $fails failed"; exit 1; }

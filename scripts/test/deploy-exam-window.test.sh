#!/usr/bin/env bash
# deploy.sh's exam_window_open() on a throwaway Postgres 17 (its own container, removed at the end): a published real
# exam open within 30 minutes either side of now blocks a deploy; a demo exam (demo_batch_id set) never does, so loaded
# demo data cannot block every deploy; a database without the exams table, or from before the demo marker column,
# keeps working. Usage: bash scripts/test/deploy-exam-window.test.sh
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
fn=$(sed -n '/^exam_window_open() {/,/^}/p' "$SRC/scripts/deploy.sh")
[ -n "$fn" ] || { echo "exam_window_open() not found in scripts/deploy.sh"; exit 1; }
eval "$fn"

NAME="sirat-deploy-window-test-$$"
trap 'docker rm -f "$NAME" > /dev/null 2>&1' EXIT
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=throwaway-test-only postgres:17-alpine > /dev/null || exit 1
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres > /dev/null 2>&1 && break
  sleep 1
done
sleep 1
# The same call shape as deploy.sh's pg(): one statement, tuples only, unaligned, errors stop it.
pg() { docker exec "$NAME" psql -h 127.0.0.1 -U postgres -d postgres -tAX -v ON_ERROR_STOP=1 -c "$1" 2> /dev/null; }

fails=0
expect() {
  local got=closed
  exam_window_open && got=open
  if [ "$got" = "$1" ]; then echo "  ok    $2"; else echo "  FAIL  $2: got $got, want $1"; fails=$((fails + 1)); fi
}
exam() { # status, start offset, end offset, demo batch (or null)
  pg "insert into exams (status, window_start, window_end${4:+, demo_batch_id})
      values ('$1', now() + interval '$2', now() + interval '$3'${4:+, $4})" > /dev/null || {
    echo "  FAIL  setup"
    fails=$((fails + 1))
  }
}

expect closed "no exams table (before the first release)"
pg "create table exams (id serial primary key, status text not null, window_start timestamptz not null,
    window_end timestamptz not null)" > /dev/null || { echo "setup failed"; exit 1; }
exam published '-5 minutes' '20 minutes'
expect open "a real exam open now, on a database from before the demo marker column"
pg "alter table exams add column demo_batch_id uuid" > /dev/null
expect open "the same real exam with the marker column present"
pg "delete from exams" > /dev/null
exam published '-1 day' '30 days' "gen_random_uuid()"
expect closed "only a demo exam open (the demo practice exam): never blocks a deploy"
exam published '2 hours' '3 hours'
expect closed "a demo exam open and a real exam in two hours"
exam published '10 minutes' '1 hour'
expect open "a demo exam open and a real exam starting in 10 minutes"
pg "delete from exams where demo_batch_id is null" > /dev/null
exam published '-2 hours' '-20 minutes'
expect open "a real exam that ended 20 minutes ago (still within 30)"
pg "delete from exams where demo_batch_id is null" > /dev/null
exam draft '-5 minutes' '20 minutes'
expect closed "a draft real exam open now"

[ "$fails" = 0 ] && echo "deploy exam_window_open: all cases pass" || { echo "deploy exam_window_open: $fails failed"; exit 1; }

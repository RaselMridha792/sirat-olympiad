#!/usr/bin/env bash
# The exam simulation (loadtests/exam-simulation.js) on this machine, on throwaway containers only (E6; EXAM-PLAN
# 6.2). Provisional numbers that catch regressions; the real ones come from the VPS run (RULEBOOK §13).
#
#   bash loadtests/exam-local.sh [steady|surge|timeup]
#   env: USERS (300), DURATION exam minutes (3), QUESTIONS (30), RAMP (30 s), RATE (10/s), PORT (4200, the worker's
#        health on PORT+1), PG_PORT (54533), REDIS_PORT (54580 cache, +1 queue), LOAD_OUT (the output folder);
#        CHECKPOINT_MIN, CHECKPOINT_MAX and LEAVE_SHARE go to k6 as they are (exam-simulation.js)
#
# What it does: a Postgres (dev/test marker, the server's postgresql.conf with the dev sizes) and two Redis
# containers named sirat-exam-load-* on 127.0.0.1 (--rm: their data goes with them); migrations, the config seed, the
# load students and a new exam (loadtest-fixtures.ts); this checkout's API and worker built and started on the host
# with a throwaway settings file (no .env is read); k6 in a container. During a steady run it reads the database's
# write counter while the students only checkpoint. Afterwards it waits for the sweep and the scoring, then checks:
# every attempt has exactly one submission, the receipts k6 received equal the students' own submissions, and nothing
# is left in progress or unscored. Everything it started is stopped at the end. Announce it on a shared machine: it
# loads the CPU for the whole run.
set -euo pipefail
cd "$(dirname "$0")/.."

SCENARIO=${1:-steady}
case "$SCENARIO" in steady | surge | timeup) ;; *) echo "usage: $0 [steady|surge|timeup]" >&2; exit 2 ;; esac
USERS=${USERS:-300}
DURATION=${DURATION:-3}
QUESTIONS=${QUESTIONS:-30}
RAMP=${RAMP:-30}
RATE=${RATE:-10}
MIN_WORK=${MIN_WORK:-0.6}
PORT=${PORT:-4200}
HEALTH_PORT=$((PORT + 1))
PG_PORT=${PG_PORT:-54533}
REDIS_PORT=${REDIS_PORT:-54580}
K6_IMAGE=grafana/k6:1.0.0
P=sirat-exam-load
OUT=${LOAD_OUT:-$(mktemp -d)}
mkdir -p "$OUT"

dk() { MSYS_NO_PATHCONV=1 docker "$@"; }
hostpath() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
say() { echo "exam-load: $*"; }
for c in pg cache queue k6; do
  [ -z "$(dk ps -aq --filter "name=^$P-$c\$")" ] || { say "container $P-$c exists; remove it first" >&2; exit 2; }
done

PIDS=()
stop_pid() {
  local pid=$1 win=''
  win=$(cat "/proc/$pid/winpid" 2> /dev/null || true)
  kill "$pid" 2> /dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2> /dev/null || return 0; sleep 1; done
  [ -n "$win" ] && taskkill //F //PID "$win" > /dev/null 2>&1 || kill -9 "$pid" 2> /dev/null || true
}
cleanup() {
  for pid in "${PIDS[@]}"; do stop_pid "$pid"; done
  for c in k6 pg cache queue; do dk stop "$P-$c" > /dev/null 2>&1 || true; done
  rm -f "$OUT/load.env"
  say "logs and the k6 summary: $OUT"
}
trap cleanup EXIT

t0=$SECONDS
# Pulled first: a pull during the run would shift k6's start past the timers of the write check below.
dk pull -q "$K6_IMAGE" > /dev/null
say "build the API and worker"
pnpm --filter @sirat/shared build > "$OUT/build.log" 2>&1
pnpm --filter @sirat/api exec prisma generate >> "$OUT/build.log" 2>&1
pnpm --filter @sirat/api build >> "$OUT/build.log" 2>&1

say "containers $P-{pg,cache,queue} on 127.0.0.1:$PG_PORT, $REDIS_PORT, $((REDIS_PORT + 1))"
pgpw=$(hex 24)
dk run -d --rm --name "$P-pg" --cpus 2 --memory 2g -e POSTGRES_USER=load -e "POSTGRES_PASSWORD=$pgpw" \
  -e POSTGRES_DB=sirat_load -p "127.0.0.1:$PG_PORT:5432" \
  -v "$(hostpath "$PWD/infra/postgres/postgresql.conf"):/etc/postgresql/postgresql.conf:ro" postgres:17-alpine \
  postgres -c config_file=/etc/postgresql/postgresql.conf -c shared_buffers=256MB -c effective_cache_size=1GB \
  -c maintenance_work_mem=128MB -c work_mem=8MB -c sirat.environment=test > /dev/null
dk run -d --rm --name "$P-cache" --memory 512m -p "127.0.0.1:$REDIS_PORT:6379" redis:7-alpine \
  redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru --save '' --appendonly no > /dev/null
dk run -d --rm --name "$P-queue" --memory 512m -p "127.0.0.1:$((REDIS_PORT + 1)):6379" redis:7-alpine \
  redis-server --maxmemory 256mb --maxmemory-policy noeviction --save '' --appendonly no > /dev/null
for _ in $(seq 60); do
  dk exec "$P-pg" pg_isready -q -U load -d sirat_load -h 127.0.0.1 && break
  sleep 1
done
dk exec "$P-pg" pg_isready -q -U load -d sirat_load -h 127.0.0.1 || { say "postgres did not start" >&2; exit 1; }

# The run's own settings: random secrets, nothing from any .env.
db="postgresql://load:$pgpw@127.0.0.1:$PG_PORT/sirat_load"
umask 077
cat > "$OUT/load.env" << EOF
NODE_ENV=development
LOG_LEVEL=warn
PORT=$PORT
WORKER_HEALTH_PORT=$HEALTH_PORT
DATABASE_URL=$db
DIRECT_URL=$db
REDIS_CACHE_URL=redis://127.0.0.1:$REDIS_PORT
REDIS_QUEUE_URL=redis://127.0.0.1:$((REDIS_PORT + 1))
JWT_ACCESS_SECRET=$(hex 32)
COOKIE_SECURE=false
EMAIL_PROVIDER=mailpit
MAILPIT_URL=http://127.0.0.1:9
ALLOW_DEV_FIXTURES=yes-this-is-not-production
FIXTURE_PASSWORD=$(hex 16)
EOF
umask 022
unset pgpw db
set -a
# shellcheck disable=SC1091
. "$OUT/load.env"
set +a

say "migrations, the config seed, $USERS students and the exam"
pnpm --filter @sirat/api exec prisma migrate deploy > "$OUT/setup.log" 2>&1
pnpm --filter @sirat/api exec tsx prisma/seed.ts >> "$OUT/setup.log" 2>&1
case "$SCENARIO" in
  # The time-up burst: students start at most 5 minutes (and at most the exam time) before the window ends.
  timeup) lead=$((DURATION < 5 ? DURATION : 5)); window_in=$((lead + 1)) ;;
  *) window_in=$((DURATION + 30)) ;;
esac
fixtures() { pnpm --filter @sirat/api exec tsx prisma/fixtures/loadtest-fixtures.ts "$@"; }
fixtures --users "$USERS" --exam --questions "$QUESTIONS" --duration "$DURATION" --window-end-in "$window_in" \
  > "$OUT/fixtures.log" 2>&1
cat "$OUT/fixtures.log" >> "$OUT/setup.log"
EXAM_ID=$(sed -n 's/.*"examId":"\([0-9a-f-]*\)".*/\1/p' "$OUT/fixtures.log")
[ -n "$EXAM_ID" ] || { say "no exam id (see $OUT/setup.log)" >&2; exit 1; }
say "exam $EXAM_ID: $QUESTIONS questions, $DURATION min; setup took $((SECONDS - t0)) s"

(cd apps/api && exec node dist/main.js) > "$OUT/api.log" 2>&1 &
PIDS+=("$!")
(cd apps/api && exec node dist/worker.js) > "$OUT/worker.log" 2>&1 &
PIDS+=("$!")
for _ in $(seq 60); do
  curl -fsS "http://127.0.0.1:$PORT/api/ready" > /dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/ready" > /dev/null || { say "the API is not ready (see $OUT/api.log)" >&2; exit 1; }

# Rows inserted, updated and deleted so far, per table ("<table> <rows>").
writes() {
  dk exec "$P-pg" psql -U load -d sirat_load -tA -F ' ' \
    -c 'SELECT relname, n_tup_ins + n_tup_upd + n_tup_del FROM pg_stat_user_tables ORDER BY relname'
}

# Steady: after the last start (RAMP) and before the first possible submit (MIN_WORK of the exam time), students
# only checkpoint, which never writes to Postgres. Stats reach pg_stat within 10 s of a write, hence the margins.
watch_pid=''
if [ "$SCENARIO" = steady ]; then
  first=$((RAMP + 25))
  last=$(awk -v w="$MIN_WORK" -v d="$DURATION" 'BEGIN { printf "%d", w * d * 60 - 5 }')
  if [ $((last - first)) -ge 20 ]; then
    (
      sleep "$first"
      writes > "$OUT/writes-from.txt"
      sleep $((last - first))
      writes > "$OUT/writes-to.txt"
      echo "$first $last" > "$OUT/writes.txt"
    ) &
    watch_pid=$!
  else
    say "no checkpoint-only phase to measure (RAMP $RAMP s, exam $DURATION min)"
  fi
fi
cpu_pid=''
if command -v typeperf > /dev/null 2>&1; then
  typeperf '\Processor(_Total)\% Processor Time' -si 5 > "$OUT/cpu.csv" 2> /dev/null &
  cpu_pid=$!
  PIDS+=("$cpu_pid")
fi

say "k6 $SCENARIO: $USERS students against http://127.0.0.1:$PORT"
k6_status=0
PASSWORD=$FIXTURE_PASSWORD dk run --rm --name "$P-k6" --add-host host.docker.internal:host-gateway \
  -v "$(hostpath "$PWD/loadtests"):/scripts:ro" -v "$(hostpath "$OUT"):/out" \
  -e PASSWORD -e "BASE_URL=http://host.docker.internal:$PORT" -e "EXAM_ID=$EXAM_ID" -e "SCENARIO=$SCENARIO" \
  -e "USERS=$USERS" -e "RAMP=$RAMP" -e "RATE=$RATE" -e "MIN_WORK=$MIN_WORK" \
  -e CHECKPOINT_MIN -e CHECKPOINT_MAX -e LEAVE_SHARE \
  "$K6_IMAGE" run --quiet --summary-export /out/summary.json /scripts/exam-simulation.js > "$OUT/k6.log" 2>&1 ||
  k6_status=$?
[ -z "$cpu_pid" ] || stop_pid "$cpu_pid"
[ -z "$watch_pid" ] || wait "$watch_pid" || true
say "k6 exit $k6_status (99 = a threshold failed) after $((SECONDS - t0)) s"
sed -n '/THRESHOLDS/,$p' "$OUT/k6.log" > "$OUT/k6-summary.txt" || true
cat "$OUT/k6-summary.txt"

# Report fields as "in_progress submitted scored own server": attempts by status, the students' own submissions
# (submitted, time_up, violations) and the server's (the sweep).
fields() {
  node -e '
    const r = JSON.parse(process.argv[1] || "{}"), a = r.attempts || {}, s = r.submissions || {};
    const n = (o, k) => o[k] || 0;
    console.log([n(a, "in_progress"), n(a, "submitted"), n(a, "scored"),
      n(s, "submitted") + n(s, "time_up") + n(s, "violations"), n(s, "server_checkpoint") + n(s, "server_empty")].join(" "));
  ' "$1"
}
metric() {
  node -e 'const m = require(process.argv[1]).metrics[process.argv[2]]; console.log(m ? m.count || 0 : 0)' \
    "$(hostpath "$OUT/summary.json")" "$1" 2> /dev/null || echo 0
}

# The sweep finalizes the students who left once their time and the grace are over; the worker scores every
# submission. Up to 6 minutes.
say "waiting for the sweep and the scoring"
final='{}'
for _ in $(seq 72); do
  final=$(fixtures --report "$EXAM_ID" 2> /dev/null | sed -n '/"msg":"load report"/p')
  read -r open unscored _ _ _ <<< "$(fields "$final")"
  [ -n "$final" ] && [ "$open" = 0 ] && [ "$unscored" = 0 ] && break
  sleep 5
done
echo "$final" > "$OUT/report.json"
say "report: $final"
read -r open unscored scored own server <<< "$(fields "$final")"
receipts=$(metric receipts)
leftn=$(metric students_left)
startedn=$(metric attempts_started)

fails=0
verdict() {
  if [ "$1" = ok ]; then echo "  ok    $2"; else
    echo "  FAIL  $2"
    fails=$((fails + 1))
  fi
}
if [ "$k6_status" = 0 ]; then verdict ok "k6 thresholds (p95 < 500 ms, errors < 0.5 %, checks, every receipt)"
else verdict fail "k6 thresholds (exit $k6_status; $OUT/k6.log)"; fi
if [ "$scored" = "$startedn" ] && [ "$open" = 0 ] && [ "$unscored" = 0 ]; then
  verdict ok "every attempt k6 started is submitted and scored ($scored)"
else verdict fail "attempts: started $startedn, scored $scored, in progress $open, unscored $unscored"; fi
if [ "$own" = "$receipts" ]; then verdict ok "the students' own submissions equal the receipts k6 received ($own)"
else verdict fail "the students' own submissions $own, receipts $receipts"; fi
if [ "$server" = "$leftn" ]; then verdict ok "the sweep submitted every student who left ($server)"
else verdict fail "server submissions $server, students who left $leftn"; fi
if [ -s "$OUT/writes.txt" ]; then
  read -r f l < "$OUT/writes.txt"
  changed=$(awk 'NR == FNR { from[$1] = $2; next } $2 != from[$1] { printf "%s +%d ", $1, $2 - from[$1] }' \
    "$OUT/writes-from.txt" "$OUT/writes-to.txt")
  if [ -z "$changed" ]; then verdict ok "no database writes while the students only checkpointed ($f s to $l s)"
  else verdict fail "database writes from $f s to $l s: $changed"; fi
fi
if [ -s "$OUT/cpu.csv" ]; then
  say "PC CPU, every session's load included: $(grep -E '^"[0-9]' "$OUT/cpu.csv" | cut -d, -f2 | tr -d '"' | sort -n |
    awk '{ v[NR] = $1 } END { if (NR) printf "median %.0f %%, p90 %.0f %% (%d samples)", v[int((NR + 1) / 2)], v[int(NR * 0.9 + 0.5)], NR }')"
fi
say "$fails check(s) failed; $((SECONDS - t0)) s in all"
[ "$fails" = 0 ]

#!/usr/bin/env bash
# The exam simulation (loadtests/exam-simulation.js) on this machine, in its own compose project only (E6; EXAM-PLAN
# 6.2). Provisional numbers that catch regressions; the real ones come from the VPS run (RULEBOOK §13).
#
#   bash loadtests/exam-local.sh [steady|surge|timeup]
#   env: USERS (300), DURATION exam minutes (3), QUESTIONS (30), RAMP (30 s), RATE (10/s), MIN_WORK (0.6),
#        API_REPLICAS (2), LOAD_OUT (the output folder), KEEP_IMAGES=1 (keep the built images for the next run);
#        CHECKPOINT_MIN, CHECKPOINT_MAX and LEAVE_SHARE go to k6 as they are
#        NO_BUILD=1 LOAD_TAG=<tag>: use the existing sirat-*:<tag> images (never removed then), e.g. CI's :latest
#        SMOKE=1: correctness only (CI): no latency thresholds and no write window, only counted outcomes
#
# What it does:
#   - builds this checkout's migrate, api and worker images as sirat-*:exam-load (the build cache makes a rerun quick);
#   - starts project sirat-exam-load from infra/docker-compose.yml with loadtests/exam-load.compose.yml: Postgres,
#     PgBouncer, both Redis, migrate, the API replicas and the worker in production mode, on a throwaway settings file
#     (no .env is read); nothing is published;
#   - the load students and a new exam (apps/api/prisma/fixtures/loadtest-fixtures.ts), in a container that shares
#     Postgres's network: the migrate image with the clone's fixtures and src mounted read-only, so 127.0.0.1 is
#     this project's Postgres (the fixtures' local-URL guard and its test marker hold) and the host needs no node;
#   - k6 in a container on the project's network, straight to the API replicas;
#   - during a steady run, Postgres's write counters while the students only checkpoint;
#   - afterwards it waits for the sweep and the scoring, then checks: the k6 thresholds, every attempt submitted and
#     scored, the receipts k6 received equal the students' own submissions, the sweep submitted exactly the students
#     who left, no writes while the students only checkpointed.
# Everything it started is removed at the end (down -v), never project sirat. Announce it on a shared machine: it
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
export API_REPLICAS=${API_REPLICAS:-2}
K6_IMAGE=grafana/k6:1.0.0
P=sirat-exam-load
TAG=${LOAD_TAG:-exam-load}
NO_BUILD=${NO_BUILD:-0}
SMOKE=${SMOKE:-0}
[[ $TAG =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "LOAD_TAG: letters, digits, . _ - only" >&2; exit 2; }
OUT=${LOAD_OUT:-$(mktemp -d)}
mkdir -p "$OUT"

dk() { MSYS_NO_PATHCONV=1 docker "$@"; }
hostpath() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
say() { echo "exam-load: $*"; }
[ "$P" != sirat ] || exit 2
[ -z "$(dk ps -aq --filter "label=com.docker.compose.project=$P")" ] ||
  { say "project $P exists; remove it first (docker compose -p $P down -v)" >&2; exit 2; }

# The run's own settings: the example's names with random secrets, payments off, email to nowhere.
pw=$(hex 24)
umask 077
sed -e "s|change-me-fake|$pw|g" -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pw|" \
  -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(hex 32)|" -e "s|^POSTGRES_APP_PASSWORD=.*|POSTGRES_APP_PASSWORD=$(hex 32)|" \
  -e "s|^EMAIL_PROVIDER=.*|EMAIL_PROVIDER=mailpit|" -e "s|^EMAIL_FROM=.*|EMAIL_FROM=Sirat load <no-reply@load.invalid>|" \
  -e "s|^PAYSTATION_ENV=.*|PAYSTATION_ENV=|" -e "s|^SECURITY_ALERT_EMAIL=.*|SECURITY_ALERT_EMAIL=|" .env.example > "$OUT/load.env"
grep -q '^POSTGRES_APP_PASSWORD=' "$OUT/load.env" || printf 'POSTGRES_APP_PASSWORD=%s\n' "$(hex 32)" >> "$OUT/load.env"
printf 'MAILPIT_URL=http://127.0.0.1:9\nSIRAT_TAG=%s\n' "$TAG" >> "$OUT/load.env"
umask 022
LOAD_ENV_FILE=$(hostpath "$OUT/load.env")
export LOAD_ENV_FILE
DC=(docker compose -p "$P" --env-file "$OUT/load.env" -f infra/docker-compose.yml -f loadtests/exam-load.compose.yml)
dc() { "${DC[@]}" "$@"; }
pgval() { sed -n "s/^$1=//p" "$OUT/load.env"; }
FIXTURE_PASSWORD=$(hex 16)
umask 077
# For the fixtures' container: 127.0.0.1 there is this project's Postgres (it shares that container's network).
printf 'NODE_ENV=test\nALLOW_DEV_FIXTURES=yes-this-is-not-production\nFIXTURE_PASSWORD=%s\nDATABASE_URL=postgresql://%s:%s@127.0.0.1:5432/%s\n' \
  "$FIXTURE_PASSWORD" "$(pgval POSTGRES_USER)" "$pw" "$(pgval POSTGRES_DB)" > "$OUT/fixtures.env"
umask 022
unset pw

cleanup() {
  dc logs --no-color api worker > "$OUT/app.log" 2>&1 || true
  for c in $(dk ps -aq --filter "label=com.docker.compose.project=$P"); do
    [ "$(dk inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$c")" = "$P" ] && dk rm -f "$c" > /dev/null
  done
  dk rm -f "$P-k6" > /dev/null 2>&1 || true
  for v in $(dk volume ls -q --filter "label=com.docker.compose.project=$P"); do dk volume rm "$v" > /dev/null || true; done
  dk network rm "${P}_default" > /dev/null 2>&1 || true
  # Only images this run built; never ones it was given (NO_BUILD).
  [ "${KEEP_IMAGES:-0}" = 1 ] || [ "$NO_BUILD" = 1 ] ||
    for s in migrate api worker; do dk image rm -f "sirat-$s:$TAG" > /dev/null 2>&1 || true; done
  rm -f "$OUT/load.env" "$OUT/fixtures.env"
  say "logs and the k6 summary: $OUT"
}
trap cleanup EXIT

t0=$SECONDS
# Pulled first: a pull during the run would shift k6's start past the timers of the write check below.
dk pull -q "$K6_IMAGE" > /dev/null
if [ "$NO_BUILD" = 1 ]; then
  for s in migrate api worker; do
    dk image inspect "sirat-$s:$TAG" > /dev/null 2>&1 || { say "image sirat-$s:$TAG is missing (NO_BUILD)" >&2; exit 1; }
  done
  say "the existing sirat-{migrate,api,worker}:$TAG images, no build"
else
  say "build sirat-{migrate,api,worker}:$TAG"
  dc build migrate api worker > "$OUT/build.log" 2>&1 || { say "the build failed (see $OUT/build.log)" >&2; exit 1; }
  say "built in $((SECONDS - t0)) s"
fi
say "project $P: $API_REPLICAS API replicas$([ "$SMOKE" = 1 ] && echo ', smoke: counted outcomes only')"
dc up -d --wait postgres pgbouncer redis-cache redis-queue > "$OUT/setup.log" 2>&1
dc run --rm --no-deps -T migrate >> "$OUT/setup.log" 2>&1

case "$SCENARIO" in
  # The time-up burst: students start at most 5 minutes (and at most the exam time) before the window ends.
  timeup) lead=$((DURATION < 5 ? DURATION : 5)); window_in=$((lead + 1)) ;;
  *) window_in=$((DURATION + 30)) ;;
esac
fixtures() {
  local pg
  pg=$(dk ps -q --filter "label=com.docker.compose.project=$P" --filter "label=com.docker.compose.service=postgres")
  [ -n "$pg" ] || { say "this project's Postgres is not running" >&2; return 1; }
  dk run --rm --network "container:$pg" --env-file "$(hostpath "$OUT/fixtures.env")" \
    -v "$(hostpath "$PWD/apps/api/prisma/fixtures"):/repo/apps/api/prisma/fixtures:ro" \
    -v "$(hostpath "$PWD/apps/api/src"):/repo/apps/api/src:ro" \
    "sirat-migrate:$TAG" node_modules/.bin/tsx prisma/fixtures/loadtest-fixtures.ts "$@"
}
say "$USERS students and the exam"
fixtures --users "$USERS" --exam --questions "$QUESTIONS" --duration "$DURATION" --window-end-in "$window_in" \
  > "$OUT/fixtures.log" 2>&1 || { say "the fixtures failed (see $OUT/fixtures.log)" >&2; exit 1; }
EXAM_ID=$(sed -n 's/.*"examId":"\([0-9a-f-]*\)".*/\1/p' "$OUT/fixtures.log")
[ -n "$EXAM_ID" ] || { say "no exam id (see $OUT/fixtures.log)" >&2; exit 1; }
dc up -d --wait --no-deps api worker >> "$OUT/setup.log" 2>&1 || { say "api or worker did not start (see $OUT/setup.log)" >&2; exit 1; }
say "exam $EXAM_ID: $QUESTIONS questions, $DURATION min; ready after $((SECONDS - t0)) s"

# Rows inserted, updated and deleted so far, per table ("<table> <rows>").
writes() {
  # shellcheck disable=SC2016
  dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F " " -c "$1"' sh \
    'SELECT relname, n_tup_ins + n_tup_upd + n_tup_del FROM pg_stat_user_tables ORDER BY relname'
}

# Steady: after the last start (RAMP) and before the first possible submit (MIN_WORK of the exam time), students
# only checkpoint, which never writes to Postgres. Stats reach pg_stat within 10 s of a write, hence the margins.
watch_pid=''
# Not in a smoke run: its timers would make a wall-time assert (SMOKE counts outcomes only).
if [ "$SCENARIO" = steady ] && [ "$SMOKE" != 1 ]; then
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
fi
dstats() {
  local ids
  mapfile -t ids < <(dk ps -q --filter "label=com.docker.compose.project=$P")
  dk stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' "${ids[@]}"
}
( while sleep 15; do dstats >> "$OUT/docker-stats.txt" 2> /dev/null || true; done ) &
stats_pid=$!

say "k6 $SCENARIO: $USERS students against http://api:4000 on ${P}_default"
k6_status=0
# k6's image runs as its own user; on a Linux host the output folder belongs to whoever runs this, so k6 runs as that
# user, or it could not write its summary (Docker Desktop hides this on Windows).
PASSWORD=$FIXTURE_PASSWORD dk run --rm --name "$P-k6" --network "${P}_default" --user "$(id -u):$(id -g)" \
  -v "$(hostpath "$PWD/loadtests"):/scripts:ro" -v "$(hostpath "$OUT"):/out" \
  -e PASSWORD -e BASE_URL=http://api:4000 -e "EXAM_ID=$EXAM_ID" -e "SCENARIO=$SCENARIO" \
  -e "USERS=$USERS" -e "RAMP=$RAMP" -e "RATE=$RATE" -e "MIN_WORK=$MIN_WORK" \
  -e CHECKPOINT_MIN -e CHECKPOINT_MAX -e LEAVE_SHARE -e "SMOKE=$SMOKE" \
  "$K6_IMAGE" run --quiet --summary-export /out/summary.json /scripts/exam-simulation.js > "$OUT/k6.log" 2>&1 ||
  k6_status=$?
kill "$stats_pid" 2> /dev/null || true
if [ -n "$cpu_pid" ]; then # typeperf is a Windows program: stop it by its Windows pid if kill does not
  win=$(cat "/proc/$cpu_pid/winpid" 2> /dev/null || true)
  kill "$cpu_pid" 2> /dev/null || true
  sleep 1
  if kill -0 "$cpu_pid" 2> /dev/null && [ -n "$win" ]; then taskkill //F //PID "$win" > /dev/null 2>&1 || true; fi
fi
[ -z "$watch_pid" ] || wait "$watch_pid" || true
say "k6 exit $k6_status (99 = a threshold failed) after $((SECONDS - t0)) s"
# Without its summary every count below would read 0 and compare zeros: say so and stop instead.
if [ ! -s "$OUT/summary.json" ]; then
  say "no k6 summary at $OUT/summary.json: k6 did not write it; its log ends with:" >&2
  tail -n 20 "$OUT/k6.log" >&2
  exit 1
fi
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
  # An unreadable summary stops the run (set -e) rather than reading as zeros.
  node -e 'const m = require(process.argv[1]).metrics[process.argv[2]]; console.log(m ? m.count || 0 : 0)' \
    "$(hostpath "$OUT/summary.json")" "$1"
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
limits=$([ "$SMOKE" = 1 ] && echo 'errors < 0.5 %, checks, every receipt; smoke: no latency limit' ||
  echo 'p95 < 500 ms, errors < 0.5 %, checks, every receipt')
if [ "$k6_status" = 0 ]; then verdict ok "k6 thresholds ($limits)"
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
if [ -s "$OUT/docker-stats.txt" ]; then
  say "peak CPU per container (docker stats, 100 % = one core): $(awk '{ sub(/-[0-9]+$/, "", $1); sub(/^'"$P"'-/, "", $1);
    c = $2 + 0; if (c > m[$1]) m[$1] = c } END { for (k in m) printf "%s %.0f%%  ", k, m[k] }' "$OUT/docker-stats.txt")"
fi
say "$fails check(s) failed; $((SECONDS - t0)) s in all"
[ "$fails" = 0 ]

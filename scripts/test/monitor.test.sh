#!/usr/bin/env bash
# Tests for scripts/monitor.sh (LAUNCH-PLAN §6, L11) on faked commands: docker (ps, logs, the ops-check and ops-alert
# calls), df, curl (the heartbeat), openssl, timedatectl, and sleep (it swaps the /proc/stat fixture between the two
# CPU samples). No Docker and no network. Run it through scripts/test/run-monitor-test.sh, or with bash where flock,
# timeout and GNU date exist.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASSED=0
FAILED=0
result() { if [ "$1" -eq 0 ]; then PASSED=$((PASSED + 1)); echo "  ok    $2"; else FAILED=$((FAILED + 1)); echo "  FAIL  $2"; sed 's/^/        /' "$T/out.log" | tail -n 5; fi; }
ok_if() { if "$@"; then echo 0; else echo 1; fi; }

mkdir -p "$T/bin" "$T/proc" "$T/logs" "$T/lib"
NOW="$(date -u +%s)"

# ---- fixtures ----
cat > "$T/logs/nginx" <<'LOG'
2026-11-01T01:50:00+00:00 203.0.113.7 edge=172.68.1.2 "GET /api/health HTTP/1.1" 200 15 rt=0.003 urt="0.002" us="200" rid=a1 "Mozilla/5.0 (X11)"
2026-11-01T01:50:01+00:00 203.0.113.8 edge=172.68.1.2 "POST /api/auth/login HTTP/1.1" 502 157 rt=1.500 urt="0.002, 1.498" us="502, 502" rid=b2 "curl/8.5"
2026-11-01T01:50:02+00:00 203.0.113.9 edge=172.68.1.2 "GET /dashboard HTTP/2.0" 200 5000 rt=0.250 urt="0.249" us="200" rid=c3 "Mozilla/5.0"
2026-11-01T01:50:03+00:00 203.0.113.9 edge=- "GET /api/exams HTTP/2.0" 429 100 rt=0.000 urt="-" us="-" rid=d4 "Mozilla/5.0"
nginx: a line that is not an access line
LOG
cat > "$T/logs/api" <<'LOG'
{"level":50,"req":{"method":"GET"},"res":{"statusCode":500},"msg":"request errored"}
{"level":30,"res":{"statusCode":200},"msg":"request completed"}
{"level":50,"res":{"statusCode":503},"msg":"request errored"}
LOG
cat > "$T/logs/web" <<'LOG'
 ⨯ Error: something broke { digest: '1234567' }
 ✓ Ready
LOG
printf 'cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 1 1 1\n' > "$T/proc/stat"
printf 'cpu  250 0 150 900 0 0 0 0 0 0\ncpu0 1 1 1 1\n' > "$T/proc/stat.next"
printf 'MemTotal:       8000000 kB\nMemFree:  100 kB\nMemAvailable:   2000000 kB\nSwapTotal:      1048576 kB\nSwapFree:        843776 kB\n' > "$T/proc/meminfo"
printf 'created_at=%s\nsha256=%s\n' "$(date -u -d "@$((NOW - 3 * 3600 - 60))" +%Y-%m-%dT%H:%M:%SZ)" "$(printf '0%.0s' {1..64})" > "$T/lib/last-backup"
touch "$T/cert.pem"

# ---- fakes ----
cat > "$T/bin/docker" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$CALLS"
case "$*" in
  *" ps "*) printf 'api running healthy\nweb running healthy\nworker running unhealthy\nnginx running \nmigrate exited \npostgres exited \n' ;;
  *" logs "*) cat "$LOGS/${*: -1}" ;;
  *ops-check.js*)
    cat > "$OPS_INPUT"
    [ -n "${FAKE_OPS_OUT:-}" ] && printf '%b' "$FAKE_OPS_OUT"
    exit "${FAKE_OPS_EXIT:-0}" ;;
  *ops-alert.js*) echo "$*" >> "$ALERTS" ;;
esac
SH
cat > "$T/bin/df" <<'SH'
#!/bin/sh
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
case "$2" in /) echo "/dev/a 100 55 45 55% /" ;; *) echo "/dev/b 100 83 17 83% $2" ;; esac
SH
cat > "$T/bin/curl" <<'SH'
#!/bin/sh
echo "$*" >> "$PINGS"
SH
cat > "$T/bin/openssl" <<SH
#!/bin/sh
echo "notAfter=$(date -u -d "@$((NOW + 30 * 86400 + 3600))" '+%b %e %H:%M:%S %Y GMT')"
SH
cat > "$T/bin/timedatectl" <<'SH'
#!/bin/sh
echo yes
SH
cat > "$T/bin/sleep" <<'SH'
#!/bin/sh
[ -f "$PROC_DIR/stat.next" ] && cp "$PROC_DIR/stat.next" "$PROC_DIR/stat.now" && cp "$PROC_DIR/stat" "$PROC_DIR/stat.first" && cp "$PROC_DIR/stat.next" "$PROC_DIR/stat"
exit 0
SH
chmod +x "$T/bin/"*

config() {
  cat > "$T/monitor.env" <<EOF
MONITOR_PROJECT=sirat-monitor-test
MONITOR_HEARTBEAT_URL=https://hc.test/ping/mon
MONITOR_STATE_FILE=$T/lib/monitor-state.json
MONITOR_DEPLOY_LOCK=$T/lib/deploy.lock
MONITOR_BACKUP_STATUS=$T/lib/last-backup
MONITOR_CERT_FILE=$T/cert.pem
MONITOR_DISK_PATHS=/ /tmp
MONITOR_PROC=$T/proc
EOF
  for line in "$@"; do printf '%s\n' "$line" >> "$T/monitor.env"; done
  chmod 600 "$T/monitor.env"
}
reset() { # the CPU fixture back to its first sample, and empty logs of calls
  [ -f "$T/proc/stat.first" ] && cp "$T/proc/stat.first" "$T/proc/stat"
  : > "$T/pings.log"; : > "$T/calls.log"; : > "$T/alerts.log"; rm -f "$T/ops-input.json"
}
run_monitor() {
  SIRAT_MONITOR_ENV="$T/monitor.env" PATH="$T/bin:$PATH" PINGS="$T/pings.log" CALLS="$T/calls.log" \
    ALERTS="$T/alerts.log" OPS_INPUT="$T/ops-input.json" LOGS="$T/logs" PROC_DIR="$T/proc" NOW="$NOW" \
    bash "$ROOT/scripts/monitor.sh" "$@" > "$T/out.log" 2>&1
}
fact() { sed -n "s/.*\"$1\":\([^,}]*\).*/\1/p" "$T/ops-input.json"; }
CLEAN='OPS critical= warn= alerts=0\nSTATE {"streaks":{},"alerts":{},"lastRunAt":1}\n'

echo "monitor tests"

# 1. A dry run: the facts, nothing else.
config
reset
status=0; FAKE_OPS_OUT="$CLEAN" run_monitor --dry-run || status=$?
ok=1
[ "$status" -eq 0 ] && [ "$(fact diskUsedPercent)" = 83 ] && [ "$(fact cpuBusyPercent)" = 67 ] &&
  [ "$(fact memoryUsedPercent)" = 75 ] && [ "$(fact swapUsedMb)" = 200 ] && [ "$(fact containersBad)" = 2 ] && ok=0
result "$ok" "host facts: the fullest disk, CPU from two samples, memory from MemAvailable, swap, bad services"
ok=1
[ "$(fact requests)" = 4 ] && [ "$(fact responses5xx)" = 1 ] && [ "$(fact apiP95Ms)" = 1500 ] &&
  [ "$(fact webRenderErrors)" = 1 ] && [ "$(fact api5xxLogged)" = 2 ] && ok=0
result "$ok" "the nginx log (a retried 502, nginx's own 429 with \"-\"), API 5xx and web render errors"
ok=1
[ "$(fact backupAgeHours)" = 3 ] && [[ "$(fact certificateDaysLeft)" =~ ^(29|30)$ ]] && [ "$(fact timeSynced)" = true ] &&
  ok=0
result "$ok" "the backup age from backup.sh's status file, the certificate and time sync"
ok=1
grep -q 'exec -T api node dist/cli/ops-check.js --dry-run' "$T/calls.log" && [ ! -s "$T/pings.log" ] &&
  [ ! -e "$T/lib/monitor-state.json" ] && grep -q 'compose -p sirat-monitor-test' "$T/calls.log" && ok=0
result "$ok" "a dry run passes --dry-run, pings nothing, keeps no state, and names the compose project"

# 2. A clean run.
reset
status=0; FAKE_OPS_OUT="$CLEAN" run_monitor || status=$?
ok=1
[ "$status" -eq 0 ] && [ "$(cat "$T/pings.log")" = '-fsS -m 10 --retry 3 -o /dev/null --data-raw ok https://hc.test/ping/mon' ] &&
  grep -q '"lastRunAt":1' "$T/lib/monitor-state.json" && ok=0
result "$ok" "with no critical state: one success ping, and the state is kept"
reset
FAKE_OPS_OUT="$CLEAN" run_monitor || true
result "$(ok_if grep -q '"state":{"streaks":{},"alerts":{},"lastRunAt":1}' "$T/ops-input.json")" "the next run hands the kept state to ops-check"

# 3. A critical state.
reset
status=0; FAKE_OPS_OUT='OPS critical=disk,workers warn=swap alerts=2\nSTATE {"streaks":{},"alerts":{},"lastRunAt":2}\n' run_monitor || status=$?
ok=1
[ "$status" -eq 0 ] && [ "$(wc -l < "$T/pings.log")" -eq 1 ] &&
  grep -q -- '--data-raw critical: disk,workers https://hc.test/ping/mon/fail$' "$T/pings.log" &&
  grep -q 'critical=disk,workers warn=swap' "$T/out.log" && ok=0
result "$ok" "a critical state pings /fail with the check names only, never the success ping"

# 4. ops-check cannot run.
reset
cp "$T/lib/monitor-state.json" "$T/state.before"
status=0; FAKE_OPS_EXIT=1 run_monitor || status=$?
ok=1
[ "$status" -eq 0 ] && grep -q -- '--data-raw critical: monitor https://hc.test/ping/mon/fail$' "$T/pings.log" &&
  grep -q 'ops-alert.js --kind ops.monitor_failed' "$T/alerts.log" && cmp -s "$T/state.before" "$T/lib/monitor-state.json" &&
  ok=0
result "$ok" "ops-check failing counts as critical (monitor): /fail, a best-effort ops alert, the state unchanged"

# 5. During a deploy.
reset
touch "$T/lib/deploy.lock"
flock "$T/lib/deploy.lock" -c 'sleep 4' &
holder=$!
sleep 1
status=0; FAKE_OPS_OUT='OPS critical=containers warn= alerts=1\nSTATE {"streaks":{},"alerts":{},"lastRunAt":3}\n' run_monitor || status=$?
wait "$holder"
ok=1
[ "$status" -eq 0 ] && [ ! -s "$T/pings.log" ] && grep -q '/fail held back' "$T/out.log" && ok=0
result "$ok" "while deploy.sh holds its lock, /fail is held back"
reset
status=0; FAKE_OPS_OUT='OPS critical=containers warn= alerts=0\nSTATE {"streaks":{},"alerts":{},"lastRunAt":4}\n' run_monitor || status=$?
result "$(ok_if grep -q 'ping/mon/fail$' "$T/pings.log")" "after the deploy, the same state pings /fail"

# 6. The digest and the configuration.
reset
status=0; FAKE_OPS_OUT='DIGEST sent\n' run_monitor --digest || status=$?
ok=1
[ "$status" -eq 0 ] && grep -q 'ops-check.js --digest' "$T/calls.log" && grep -q '"diskUsedPercent":83' "$T/ops-input.json" &&
  grep -q 'DIGEST sent' "$T/out.log" && ok=0
result "$ok" "--digest hands the host facts to ops-check --digest"
config
chmod 644 "$T/monitor.env"
status=0; run_monitor || status=$?
ok=1
[ "$status" -ne 0 ] && grep -q 'readable by its owner only' "$T/out.log" && ok=0
result "$ok" "a config that others can read is refused"
config "MONITOR_PROJECT="
status=0; run_monitor || status=$?
ok=1
[ "$status" -ne 0 ] && grep -q 'must name the compose project' "$T/out.log" && ok=0
result "$ok" "a config without a project is refused"

echo "monitor tests: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]

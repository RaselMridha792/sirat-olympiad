#!/usr/bin/env bash
# Server checks (LAUNCH-PLAN §6, L11). Cron runs it every 5 minutes, and with --digest at 08:00 Asia/Dhaka (L12
# installs the lines):
#
#   monitor.sh             collect the host facts, run ops-check in the api container (which raises the alerts),
#                          keep the state, ping the heartbeat
#   monitor.sh --dry-run   the same facts and checks, but no alert, no ping and no state change; prints the facts
#   monitor.sh --digest    the daily digest email (ops-check --digest)
#
# Configuration: the git-ignored .env.monitor in the clone (SIRAT_MONITOR_ENV names another file), mode 600, KEY=VALUE
# lines read, never run as shell. Names: infra/monitor/monitor.env.example. Every compose call passes -p.
#
# The heartbeat (outside service) gets a success ping only when no check is critical; otherwise /fail with the check
# names (never values). ops-check failing to run counts as critical (`monitor`). While deploy.sh holds its lock, /fail
# is held back (a deploy restarts containers on purpose). Exit 0 unless the script itself cannot run.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${SIRAT_MONITOR_ENV:-$ROOT/.env.monitor}"
MODE=run
case "${1:-}" in
  '') ;;
  --dry-run) MODE=dry ;;
  --digest) MODE=digest ;;
  *) echo "usage: monitor.sh [--dry-run | --digest]" >&2; exit 2 ;;
esac

fail() { echo "monitor: $*" >&2; exit 1; }

# ---- configuration: KEY=VALUE lines only ----
[ -f "$CONFIG" ] || fail "no config file at $CONFIG (see infra/monitor/monitor.env.example)"
case "$(stat -c '%a' "$CONFIG")" in
  600 | 400) ;;
  *) fail "$CONFIG must be readable by its owner only (chmod 600)" ;;
esac
declare -A CFG=()
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in '' | \#*) continue ;; esac
  [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || fail "unreadable line in $CONFIG"
  value="${BASH_REMATCH[2]}"
  value="${value%\"}"
  value="${value#\"}"
  CFG["${BASH_REMATCH[1]}"]="$value"
done < "$CONFIG"
cfg() { printf '%s' "${CFG[$1]:-${2:-}}"; }

PROJECT="$(cfg MONITOR_PROJECT)"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "MONITOR_PROJECT must name the compose project (e.g. sirat)"
HEARTBEAT="$(cfg MONITOR_HEARTBEAT_URL)"
STATE_FILE="$(cfg MONITOR_STATE_FILE /var/lib/sirat/monitor-state.json)"
DEPLOY_LOCK="$(cfg MONITOR_DEPLOY_LOCK /var/lib/sirat/deploy.lock)"
BACKUP_STATUS="$(cfg MONITOR_BACKUP_STATUS /var/lib/sirat/last-backup)"
CERT_FILE="$(cfg MONITOR_CERT_FILE infra/nginx/certs/origin.pem)"
read -r -a DISK_PATHS <<< "$(cfg MONITOR_DISK_PATHS '/ /var/lib/docker')"
PROC="$(cfg MONITOR_PROC /proc)"
CPU_SAMPLE="$(cfg MONITOR_CPU_SAMPLE_SECONDS 1)"
read -r -a COMPOSE_FILES <<< "$(cfg MONITOR_COMPOSE_FILES infra/docker-compose.yml)"
read -r -a ENV_FILES <<< "$(cfg MONITOR_COMPOSE_ENV_FILES .env)"
case "$CERT_FILE" in /*) ;; *) CERT_FILE="$ROOT/$CERT_FILE" ;; esac

DC=(docker compose -p "$PROJECT")
for f in "${ENV_FILES[@]}"; do case "$f" in /*) DC+=(--env-file "$f") ;; *) DC+=(--env-file "$ROOT/$f") ;; esac; done
for f in "${COMPOSE_FILES[@]}"; do case "$f" in /*) DC+=(-f "$f") ;; *) DC+=(-f "$ROOT/$f") ;; esac; done

num_or_null() { if [[ "${1:-}" =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then printf '%s' "$1"; else printf 'null'; fi; }
NOW="$(date -u +%s)"

# ---- host facts ----
disk_used_percent() {
  local p v max=''
  for p in "${DISK_PATHS[@]}"; do
    [ -e "$p" ] || continue
    v="$(df -P "$p" 2>/dev/null | awk 'NR == 2 { gsub("%", "", $5); print $5 }')"
    [[ "$v" =~ ^[0-9]+$ ]] || continue
    if [ -z "$max" ] || [ "$v" -gt "$max" ]; then max="$v"; fi
  done
  printf '%s' "$max"
}

cpu_sample() { awk '$1 == "cpu" { idle = $5 + $6; total = 0; for (i = 2; i <= NF; i++) total += $i; print total, idle; exit }' "$PROC/stat"; }
cpu_busy_percent() {
  [ -r "$PROC/stat" ] || return 0
  local a b
  a="$(cpu_sample)"
  sleep "$CPU_SAMPLE"
  b="$(cpu_sample)"
  awk -v a="$a" -v b="$b" 'BEGIN { split(a, x, " "); split(b, y, " "); dt = y[1] - x[1]; di = y[2] - x[2];
    if (dt > 0) printf "%d", (100 * (dt - di) / dt) + 0.5 }'
}

meminfo() { awk -v key="$1:" '$1 == key { print $2; exit }' "$PROC/meminfo" 2>/dev/null; }
memory_used_percent() {
  local total avail
  total="$(meminfo MemTotal)"
  avail="$(meminfo MemAvailable)"
  [[ "$total" =~ ^[0-9]+$ && "$avail" =~ ^[0-9]+$ && "$total" -gt 0 ]] || return 0
  printf '%d' $(((100 * (total - avail) + total / 2) / total))
}
swap_used_mb() {
  local total free
  total="$(meminfo SwapTotal)"
  free="$(meminfo SwapFree)"
  [[ "$total" =~ ^[0-9]+$ && "$free" =~ ^[0-9]+$ ]] || return 0
  printf '%d' $(((total - free) / 1024))
}

containers_bad() { # services not running or unhealthy (the one-off migrate job is not a service)
  "${DC[@]}" ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null |
    awk '$1 != "migrate" && ($2 != "running" || $3 == "unhealthy") { n++ } END { print n + 0 }'
}

# nginx's access log of the last 5 minutes (log_format sirat, infra/nginx/nginx.conf): requests, 5xx answers, and the
# API's p95 request time in ms. Split on double quotes, so plain awk (mawk) reads it.
nginx_facts() {
  "${DC[@]}" logs --since 5m --no-color --no-log-prefix nginx 2>/dev/null |
    awk -F'"' -v times="$1" '
      $1 ~ /^[0-9][0-9][0-9][0-9]-/ && NF >= 8 {
        split($2, req, " "); split($3, rest, " ")
        status = rest[1]; rt = rest[3]; sub(/^rt=/, "", rt)
        requests++
        if (status ~ /^5/) errors++
        if (req[2] ~ /^\/api\// && rt ~ /^[0-9.]+$/) print rt * 1000 > times
      }
      END { print requests + 0, errors + 0 }'
}
p95_ms() { # $1 = a file of request times
  [ -s "$1" ] || return 0
  sort -n "$1" | awk '{ v[NR] = $1 } END { i = int(NR * 0.95 + 0.999); if (i < 1) i = 1; printf "%d", v[i] + 0.5 }'
}
log_count() { # $1 = service, $2 = an extended regex
  "${DC[@]}" logs --since 5m --no-color --no-log-prefix "$1" 2>/dev/null | grep -cE "$2" || true
}

certificate_days_left() {
  [ -r "$CERT_FILE" ] || return 0
  local end
  end="$(openssl x509 -enddate -noout -in "$CERT_FILE" 2>/dev/null | sed -n 's/^notAfter=//p')"
  [ -n "$end" ] || return 0
  printf '%d' $((($(date -u -d "$end" +%s) - NOW) / 86400))
}

backup_age_hours() { # backup.sh writes created_at=... after each upload that worked (root-owned, world-readable)
  [ -r "$BACKUP_STATUS" ] || return 0
  local created
  created="$(sed -n 's/^created_at=\([0-9TZ:-]*\)$/\1/p' "$BACKUP_STATUS" | sed -n 1p)"
  [[ "$created" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 0
  printf '%d' $(((NOW - $(date -u -d "$created" +%s)) / 3600))
}

time_synced() {
  local v
  v="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)"
  case "$v" in yes) printf 'true' ;; no) printf 'false' ;; *) printf 'null' ;; esac
}

host_facts_json() {
  local times nginx requests errors
  times="$(mktemp)"
  nginx="$(nginx_facts "$times")"
  requests="${nginx%% *}"
  errors="${nginx##* }"
  printf '{"diskUsedPercent":%s,"cpuBusyPercent":%s,"memoryUsedPercent":%s,"swapUsedMb":%s,"containersBad":%s,' \
    "$(num_or_null "$(disk_used_percent)")" "$(num_or_null "$(cpu_busy_percent)")" \
    "$(num_or_null "$(memory_used_percent)")" "$(num_or_null "$(swap_used_mb)")" "$(num_or_null "$(containers_bad)")"
  printf '"requests":%s,"responses5xx":%s,"apiP95Ms":%s,"webRenderErrors":%s,"api5xxLogged":%s,' \
    "$(num_or_null "$requests")" "$(num_or_null "$errors")" "$(num_or_null "$(p95_ms "$times")")" \
    "$(num_or_null "$(log_count web 'digest')")" "$(num_or_null "$(log_count api '"statusCode":5[0-9][0-9]')")"
  printf '"certificateDaysLeft":%s,"backupAgeHours":%s,"timeSynced":%s}' \
    "$(num_or_null "$(certificate_days_left)")" "$(num_or_null "$(backup_age_hours)")" "$(time_synced)"
  rm -f "$times"
}

# ---- heartbeat ----
ping_heartbeat() { # $1 = '' or 'fail', $2 = the body (check names only)
  [ -n "$HEARTBEAT" ] || return 0
  local url="$HEARTBEAT"
  [ "${1:-}" = fail ] && url="${HEARTBEAT%/}/fail"
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-ok}" "$url" || echo "monitor: heartbeat ping failed" >&2
}
deploy_running() { [ -e "$DEPLOY_LOCK" ] && ! flock -n "$DEPLOY_LOCK" true 2>/dev/null; }

HOST="$(host_facts_json)"

if [ "$MODE" = digest ]; then
  printf '{"host":%s}' "$HOST" | timeout 120 "${DC[@]}" exec -T api node dist/cli/ops-check.js --digest
  exit $?
fi

STATE='null'
if [ -s "$STATE_FILE" ] && [ "$(head -c 1 "$STATE_FILE")" = '{' ]; then STATE="$(cat "$STATE_FILE")"; fi
ARGS=()
[ "$MODE" = dry ] && ARGS+=(--dry-run)
status=0
OUT="$(printf '{"host":%s,"state":%s}' "$HOST" "$STATE" |
  timeout 120 "${DC[@]}" exec -T api node dist/cli/ops-check.js "${ARGS[@]}" 2>/dev/null)" || status=$?
SUMMARY="$(sed -n 's/^OPS //p' <<< "$OUT" | sed -n 1p)"

if [ "$status" -ne 0 ] || [ -z "$SUMMARY" ]; then
  CRITICAL=monitor
  WARN=''
  if [ "$MODE" = run ]; then # best effort: the API is probably the reason ops-check could not run
    timeout 60 "${DC[@]}" exec -T api node dist/cli/ops-alert.js --kind ops.monitor_failed > /dev/null 2>&1 || true
  fi
else
  CRITICAL="$(printf '%s' "$SUMMARY" | sed -n 's/^critical=\([a-z_,]*\) .*/\1/p')"
  WARN="$(printf '%s' "$SUMMARY" | sed -n 's/.* warn=\([a-z_,]*\) .*/\1/p')"
  NEXT_STATE="$(sed -n 's/^STATE //p' <<< "$OUT" | sed -n 1p)"
  if [ "$MODE" = run ] && [ -n "$NEXT_STATE" ]; then
    mkdir -p "$(dirname "$STATE_FILE")"
    printf '%s\n' "$NEXT_STATE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  fi
fi

if [ "$MODE" = dry ]; then
  printf 'host facts: %s\n' "$HOST"
elif [ -z "$CRITICAL" ]; then
  ping_heartbeat '' ok
elif deploy_running; then
  echo "monitor: critical (${CRITICAL}) during a deploy: /fail held back"
else
  ping_heartbeat fail "critical: ${CRITICAL}"
fi
echo "monitor: critical=${CRITICAL:-none} warn=${WARN:-none}$([ "$MODE" = dry ] && printf ' (dry run)')"

#!/usr/bin/env bash
# Encrypted off-server database backup (LAUNCH-PLAN §4 L6; RULEBOOK §6, §15).
#
#   backup.sh                    dump, check, encrypt, upload, keep the newest local copies, ping the heartbeat
#   backup.sh --accept-smaller   the same, once, accepting a dump much smaller than the last one (by hand only, after
#                                a deliberate big delete; logged; the timer never passes it)
#   backup.sh --verify           check the newest local copy against its manifest (sha256) and its age
#
# Run as root by sirat-backup.service (its timer, and deploy.sh before migrate) or by hand. Configuration comes only
# from /etc/sirat/backup.env (root, 0600; SIRAT_BACKUP_ENV names another file for tests), never from the app's .env,
# which reaches every API replica. Names: infra/backup/backup.env.example. Exit status: 0 only when every step worked.
#
# A run: lock (one at a time; deploy.sh waits on the same lock) -> pg_dump -Fc inside the postgres container
# (credentials stay in the container) -> read the whole archive back, counting the rows of every table and the
# applied migrations from the same snapshot -> refuse a dump much smaller than the last one -> encrypt with age to the
# public keys in the recipients file -> manifest -> store locally -> upload with rclone into tier prefixes (hourly/
# always; daily/ for the first run of the Asia/Dhaka day at or after 03:00; weekly/ for that run on a Sunday; dump first,
# manifest last) -> keep the newest local copies -> heartbeat.
# A failure: the heartbeat gets /fail, an ops alert is raised through the API (ops-alert, best effort: the heartbeat
# does not depend on the app), and the exit status is non-zero. Before the store step no new copy appears; a
# failed upload keeps the local encrypted copy (stored first). A run killed mid-dump leaves its partial plain dump in an
# owner-only .work.* directory, which the next run removes.
# The manifest's fields (created_at, sha256, tables, migrations) are read by restore-drill.sh and ops-check: keep them.
set -euo pipefail
umask 077   # dumps hold minors' personal data: owner-only (RULEBOOK §15)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${SIRAT_BACKUP_ENV:-/etc/sirat/backup.env}"
MODE=run
ACCEPT_SMALLER=0
for arg in "$@"; do
  case "$arg" in
    --verify) MODE=verify ;;
    --accept-smaller) ACCEPT_SMALLER=1 ;;
    *) echo "usage: backup.sh [--accept-smaller | --verify]" >&2; exit 2 ;;
  esac
done
if [ "$MODE" = verify ] && [ "$ACCEPT_SMALLER" -eq 1 ]; then
  echo "usage: backup.sh [--accept-smaller | --verify]" >&2
  exit 2
fi

fail() { echo "backup: $*" >&2; exit 1; }

# The clock. SIRAT_BACKUP_NOW (epoch seconds) is for tests only; the timer and deploy.sh never set it.
NOW="${SIRAT_BACKUP_NOW:-$(date -u +%s)}"
[[ "$NOW" =~ ^[0-9]+$ ]] || fail "SIRAT_BACKUP_NOW must be epoch seconds"
# Asia/Dhaka is UTC+6 all year (no daylight saving since 2009), so no time zone database is needed.
DHAKA=$((NOW + 6 * 3600))
DHAKA_DATE="$(date -u -d "@$DHAKA" +%F)"
DHAKA_HOUR="$(date -u -d "@$DHAKA" +%H)"
DHAKA_WEEKDAY="$(date -u -d "@$DHAKA" +%u)" # 7 = Sunday

# ---- configuration: KEY=VALUE lines only, never executed as shell ----
[ -f "$CONFIG" ] || fail "no config file at $CONFIG (see infra/backup/backup.env.example)"
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

PROJECT="$(cfg BACKUP_PROJECT)"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "BACKUP_PROJECT must name the compose project (e.g. sirat)"
read -r -a COMPOSE_FILES <<< "$(cfg BACKUP_COMPOSE_FILES infra/docker-compose.yml)"
COMPOSE_ENV_FILE="$(cfg BACKUP_COMPOSE_ENV_FILE .env)"
DIR="$(cfg BACKUP_DIR /var/backups/sirat)"
KEEP="$(cfg BACKUP_KEEP_LOCAL 3)"
LOCK="$(cfg BACKUP_LOCK /var/lib/sirat/backup.lock)"
LOCK_WAIT="$(cfg BACKUP_LOCK_WAIT_SECONDS 900)"
RECIPIENTS="$(cfg BACKUP_RECIPIENTS infra/backup/recipients.txt)"
REMOTE="$(cfg BACKUP_REMOTE)"
HEARTBEAT="$(cfg BACKUP_HEARTBEAT_URL)"
MIN_SIZE_PERCENT="$(cfg BACKUP_MIN_SIZE_PERCENT 50)"
MAX_AGE_HOURS="$(cfg BACKUP_MAX_AGE_HOURS 26)"
PG_LOCK_WAIT="$(cfg BACKUP_PG_LOCK_WAIT 60s)"
for n in "$KEEP" "$LOCK_WAIT" "$MIN_SIZE_PERCENT" "$MAX_AGE_HOURS"; do
  [[ "$n" =~ ^[0-9]+$ ]] || fail "a number setting is not a whole number"
done
[ "$KEEP" -ge 1 ] || fail "BACKUP_KEEP_LOCAL must be at least 1"
[[ "$PG_LOCK_WAIT" =~ ^[0-9]+(ms|s|min)?$ ]] || fail "BACKUP_PG_LOCK_WAIT must look like 60s"
case "$RECIPIENTS" in /*) ;; *) RECIPIENTS="$ROOT/$RECIPIENTS" ;; esac
case "$COMPOSE_ENV_FILE" in /*) ;; *) COMPOSE_ENV_FILE="$ROOT/$COMPOSE_ENV_FILE" ;; esac
if [ -n "${CFG[RCLONE_CONFIG]:-}" ]; then export RCLONE_CONFIG="${CFG[RCLONE_CONFIG]}"; fi

DC=(docker compose -p "$PROJECT" --env-file "$COMPOSE_ENV_FILE")
for f in "${COMPOSE_FILES[@]}"; do
  case "$f" in /*) DC+=(-f "$f") ;; *) DC+=(-f "$ROOT/$f") ;; esac
done

# ---- heartbeat: success after a verified upload, /fail with the failed step's name (never values) ----
ping_heartbeat() { # $1 = '' or 'fail', $2 = a word for the heartbeat log
  [ -n "$HEARTBEAT" ] || return 0
  local url="$HEARTBEAT"
  [ "${1:-}" = fail ] && url="${HEARTBEAT%/}/fail"
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-ok}" "$url" || echo "backup: heartbeat ping failed" >&2
}

# ---- ops alert (L10): the operator email through the API, best effort ----
# Details are numbers only (ops-alert refuses text), so the step goes as its number. If the API cannot raise it (the
# api container down is a likely moment for a failed backup), the run still fails loudly: the heartbeat's /fail does
# not depend on the app, and the exit status stays non-zero.
declare -A STEP_NUMBER=([start]=0 [lock]=1 [prepare]=2 [dump]=3 [check]=4 [size]=5 [encrypt]=6 [manifest]=7
  [store]=8 [upload]=9 [prune]=10 [finish]=11 [verify]=12)
raise_ops_alert() {
  timeout 60 "${DC[@]}" exec -T api node dist/cli/ops-alert.js \
    --kind ops.backup_failed --meta "step=${STEP_NUMBER[$STEP]:-99}" > /dev/null 2>&1 ||
    echo "backup: the ops alert could not be raised through the API (the heartbeat's /fail went out)" >&2
}

STEP=start
WORK=
on_exit() {
  local status=$?
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
  if [ "$status" -ne 0 ]; then
    echo "backup: FAILED at step '$STEP'" >&2
    ping_heartbeat fail "$STEP"
    raise_ops_alert
  fi
  exit "$status"
}
trap on_exit EXIT

newest_manifest() { { find "$DIR" -maxdepth 1 -name 'sirat-*.manifest.json' 2>/dev/null || true; } | sort | tail -n 1; }
manifest_field() { # $1 = manifest, $2 = a top-level field (two-space indent, one per line)
  sed -n "s/^  \"$2\": \"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}$/\1/p" "$1" | head -n 1
}

# ---- --verify: the newest local copy is intact and recent ----
if [ "$MODE" = verify ]; then
  STEP=verify
  manifest="$(newest_manifest)"
  [ -n "$manifest" ] || fail "no backup in $DIR"
  file="$DIR/$(manifest_field "$manifest" file)"
  [ -f "$file" ] || fail "the newest manifest names a missing file"
  [ "$(manifest_field "$manifest" sha256)" = "$(sha256sum "$file" | cut -d' ' -f1)" ] ||
    fail "the newest copy does not match its manifest (sha256)"
  head -c 64 "$file" | grep -q '^age-encryption.org/v1' || fail "the newest copy is not an age file"
  created="$(manifest_field "$manifest" created_at)"
  [[ "$created" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    fail "the newest manifest has no valid created_at"
  age_s=$((NOW - $(date -u -d "$created" +%s)))
  [ "$age_s" -le $((MAX_AGE_HOURS * 3600)) ] || fail "the newest copy is older than ${MAX_AGE_HOURS} h"
  echo "backup: verified $(basename "$file") ($((age_s / 60)) min old)"
  exit 0
fi

# ---- one run at a time; deploy.sh (L9) waits on the same lock ----
STEP=lock
mkdir -p "$(dirname "$LOCK")"
if [ ! -e "$LOCK" ]; then touch "$LOCK" && chmod 644 "$LOCK"; fi # readable, so deploy can wait on it
exec 9<"$LOCK"
flock -w "$LOCK_WAIT" 9 || fail "another backup is still running after ${LOCK_WAIT} s"

STEP=prepare
for tool in docker age sha256sum flock timeout; do command -v "$tool" >/dev/null || fail "missing tool: $tool"; done
[ -n "$REMOTE" ] || fail "BACKUP_REMOTE is empty (an rclone destination, or 'none' for a local-only run)"
[ "$REMOTE" = none ] || command -v rclone >/dev/null || fail "missing tool: rclone"
[ -f "$RECIPIENTS" ] || fail "no recipients file at $RECIPIENTS"
grep -Eq '^(age1[0-9a-z]+|ssh-(ed25519|rsa) )' "$RECIPIENTS" || fail "no age public key in $RECIPIENTS"
mkdir -p "$DIR" && chmod 700 "$DIR"
rm -rf "$DIR"/.work.* # left by a run that was killed (we hold the lock, so none is running)
WORK="$(mktemp -d "$DIR/.work.XXXXXX")"
STAMP="$(date -u -d "@$NOW" +%Y%m%dT%H%M%SZ)"
CREATED_AT="$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ)"
NAME="sirat-$STAMP"

# ---- dump: credentials are read inside the container, never on this shell or its history ----
STEP=dump
# shellcheck disable=SC2016
"${DC[@]}" exec -T -e PG_LOCK_WAIT="$PG_LOCK_WAIT" postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --lock-wait-timeout="$PG_LOCK_WAIT"' > "$WORK/dump"

# ---- read the whole archive back (a truncated dump fails here) and count from the same snapshot ----
STEP=check
"${DC[@]}" exec -T postgres pg_restore --data-only -f - < "$WORK/dump" | awk -v out="$WORK/counts" '
  /^COPY [^ ]+ \(.*\) FROM stdin;$/ {
    table = $2; sub(/^public\./, "", table); gsub(/"/, "", table); rows = 0; inside = 1
    mig = (table == "_prisma_migrations"); nameCol = 0; doneCol = 0; backCol = 0
    if (mig) {
      cols = $0; sub(/^COPY [^ ]+ \(/, "", cols); sub(/\) FROM stdin;$/, "", cols)
      n = split(cols, c, ", ")
      for (i = 1; i <= n; i++) {
        if (c[i] == "migration_name") nameCol = i
        if (c[i] == "finished_at") doneCol = i
        if (c[i] == "rolled_back_at") backCol = i
      }
    }
    next
  }
  inside && $0 == "\\." { print "T " table " " rows > out; inside = 0; next }
  inside {
    rows++
    if (mig && nameCol && doneCol) {
      split($0, f, "\t")
      if (f[doneCol] != "\\N" && (backCol == 0 || f[backCol] == "\\N")) print "M " f[nameCol] > out
    }
  }
'
[ -s "$WORK/counts" ] || fail "the dump holds no table data"
if grep -Ev '^(T [A-Za-z0-9_]+ [0-9]+|M [A-Za-z0-9_]+)$' "$WORK/counts" >/dev/null; then
  fail "an unexpected table or migration name in the dump"
fi

STEP=size
DUMP_BYTES="$(stat -c '%s' "$WORK/dump")"
last="$(newest_manifest)"
if [ -n "$last" ]; then
  last_bytes="$(manifest_field "$last" dump_bytes)"
  if [[ "$last_bytes" =~ ^[0-9]+$ ]] && [ $((DUMP_BYTES * 100)) -lt $((last_bytes * MIN_SIZE_PERCENT)) ]; then
    if [ "$ACCEPT_SMALLER" -eq 1 ]; then
      echo "backup: WARNING: --accept-smaller: accepted a dump of $DUMP_BYTES bytes after one of $last_bytes (by hand)" >&2
    else
      fail "the dump is much smaller than the last one ($DUMP_BYTES < ${MIN_SIZE_PERCENT}% of $last_bytes bytes;" \
        "after a deliberate big delete, run it once by hand with --accept-smaller)"
    fi
  fi
fi

# ---- encrypt to the public keys; the private keys never come near this server ----
STEP=encrypt
age -R "$RECIPIENTS" -o "$WORK/$NAME.dump.age" "$WORK/dump"
rm -f "$WORK/dump"
SHA256="$(sha256sum "$WORK/$NAME.dump.age" | cut -d' ' -f1)"
AGE_BYTES="$(stat -c '%s' "$WORK/$NAME.dump.age")"

STEP=manifest
{
  printf '{\n'
  printf '  "format": 1,\n'
  printf '  "file": "%s",\n' "$NAME.dump.age"
  printf '  "created_at": "%s",\n' "$CREATED_AT"
  printf '  "sha256": "%s",\n' "$SHA256"
  printf '  "encrypted_bytes": %s,\n' "$AGE_BYTES"
  printf '  "dump_bytes": %s,\n' "$DUMP_BYTES"
  printf '  "tables": {'
  awk '$1 == "T" { printf "%s\n    \"%s\": %s", (n++ ? "," : ""), $2, $3 } END { if (n) printf "\n  " }' "$WORK/counts"
  printf '},\n'
  printf '  "migrations": ['
  awk '$1 == "M" { printf "%s\n    \"%s\"", (n++ ? "," : ""), $2 } END { if (n) printf "\n  " }' "$WORK/counts"
  printf ']\n'
  printf '}\n'
} > "$WORK/$NAME.manifest.json"

# ---- keep it locally (the manifest last: a manifest always names a complete file) ----
STEP=store
mv "$WORK/$NAME.dump.age" "$DIR/$NAME.dump.age"
mv "$WORK/$NAME.manifest.json" "$DIR/$NAME.manifest.json"

# ---- off the server (a put-only key: no listing, reading back or deleting; the bucket keeps versions) ----
# Tier prefixes let the bucket's lifecycle keep hourly copies 2 days, daily 8 and weekly 35 (RUNBOOK §5, owner Q1).
# The daily copy is the first run of the Asia/Dhaka day at or after 03:00, so a failed 03:00 run is made up by the
# next one; on a Sunday that copy is also the weekly one. .last-daily remembers the day it was uploaded for.
STEP=upload
TIERS=(hourly)
if [ "$((10#$DHAKA_HOUR))" -ge 3 ] && [ "$(cat "$DIR/.last-daily" 2>/dev/null || true)" != "$DHAKA_DATE" ]; then
  TIERS+=(daily)
  if [ "$DHAKA_WEEKDAY" = 7 ]; then TIERS+=(weekly); fi
fi
if [ "$REMOTE" = none ]; then
  echo "backup: WARNING: BACKUP_REMOTE=none: this copy is NOT off the server" >&2
  TIERS=()
else
  for tier in "${TIERS[@]}"; do
    for f in "$NAME.dump.age" "$NAME.manifest.json"; do
      rclone copyto "$DIR/$f" "${REMOTE%/}/$tier/$f" --no-check-dest --s3-no-check-bucket --s3-no-head \
        --retries 3 --low-level-retries 5 --contimeout 30s --timeout 10m
    done
  done
  if [[ " ${TIERS[*]} " == *" daily "* ]]; then printf '%s\n' "$DHAKA_DATE" > "$DIR/.last-daily"; fi
fi

# ---- keep the newest local copies ----
STEP=prune
find "$DIR" -maxdepth 1 -name 'sirat-*.manifest.json' | sort | head -n -"$KEEP" | while read -r old; do
  rm -f "${old%.manifest.json}.dump.age" "$old"
done

STEP=finish
if [ "$REMOTE" != none ]; then ping_heartbeat '' ok; fi
where="uploaded to $REMOTE (${TIERS[*]})"
if [ "$REMOTE" = none ]; then where="kept locally only"; fi
echo "backup: $NAME.dump.age ($AGE_BYTES bytes, sha256 ${SHA256:0:12}...) $where"

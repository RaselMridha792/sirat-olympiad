#!/usr/bin/env bash
# The restore drill (L7, LAUNCH-PLAN section 5; RUNBOOK section 5): a copy restored into the isolated project
# sirat-drill, checked, then wiped. Run it on another machine than the server, as a user in the docker group, from a
# clone. It never touches project sirat.
#
#   scripts/restore-drill.sh --age <copy.dump.age> --manifest <copy.manifest.json> --identity <age key file>
#   scripts/restore-drill.sh --dump <file.dump>          a decrypted dump (CI's round trip, a dev database copy)
#   options: --tag <image tag> (default latest; the images must exist, the drill never builds)
#            --keep (leave the drill up for more checks)  |  scripts/restore-drill.sh --wipe (remove it)
#   RESTORE_DRILL_WORK=<dir>  keep the drill's settings there (the caller removes them), for more commands with --keep
#
#   1. the copy's sha256 against its manifest, then decrypted (into an owner-only work directory)
#   2. the drill: its own volumes, throwaway secrets, payments off, email only to Mailpit; it refuses to start if
#      compose would bind any port beyond 127.0.0.1
#   3. scripts/restore.sh --mode rebuild into its empty database, then the checks: the row counts against the
#      manifest, the triggers, sirat_app's grants and default privileges, statement_timeout 10s, the audit log refusing
#      a change, and one login as sirat_app
#   4. the wipe (down -v, only after checking each container's project label), and the measured restore time
set -euo pipefail
cd "$(dirname "$0")/.."
P=sirat-drill
COMPOSE='infra/docker-compose.yml infra/backup/drill.compose.yml'
fail() { echo "restore-drill: $*" >&2; exit 1; }
say() { echo "restore-drill: $*"; }

AGE='' MANIFEST='' IDENTITY='' DUMP='' TAG=latest KEEP=0 WIPE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --age) AGE="${2:-}"; shift ;;
    --manifest) MANIFEST="${2:-}"; shift ;;
    --identity) IDENTITY="${2:-}"; shift ;;
    --dump) DUMP="${2:-}"; shift ;;
    --tag) TAG="${2:-}"; shift ;;
    --keep) KEEP=1 ;;
    --wipe) WIPE=1 ;;
    *) fail "unknown argument $1 (see the header of this script)" ;;
  esac
  shift
done
[[ "$TAG" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "--tag looks wrong"

# The wipe: only containers that carry this project's label, never project sirat.
wipe() {
  [ "$P" != sirat ] || fail "refusing to wipe project sirat"
  local c
  for c in $(docker ps -aq --filter "label=com.docker.compose.project=$P"); do
    [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c")" = "$P" ] || fail "a container without the $P label"
  done
  docker compose -p "$P" down -v --remove-orphans > /dev/null 2>&1 || true
  for c in $(docker ps -aq --filter "label=com.docker.compose.project=$P"); do docker rm -f "$c" > /dev/null; done
  for v in $(docker volume ls -q --filter "label=com.docker.compose.project=$P"); do docker volume rm "$v" > /dev/null; done
  say "wiped project $P (containers, volumes and network)"
}
if [ "$WIPE" = 1 ]; then wipe; exit 0; fi

[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$P")" ] || fail "project $P already exists: scripts/restore-drill.sh --wipe first"
for r in migrate api worker web; do
  docker image inspect "sirat-$r:$TAG" > /dev/null 2>&1 || fail "no image sirat-$r:$TAG here (build or pull it first; the drill never builds)"
done
if [ -n "${RESTORE_DRILL_WORK:-}" ]; then
  work=$RESTORE_DRILL_WORK
  mkdir -p "$work" && chmod 700 "$work"
  cleanup_work() { :; }
else
  work=$(umask 077 && mktemp -d)
  cleanup_work() { rm -rf "$work"; }
fi
trap cleanup_work EXIT

# ---- 1. the copy ----
if [ -n "$AGE" ]; then
  [ -f "$AGE" ] && [ -f "$MANIFEST" ] && [ -f "$IDENTITY" ] || fail "--age needs --manifest and --identity files"
  want=$(sed -n 's/^  "sha256": "\([0-9a-f]*\)",*$/\1/p' "$MANIFEST")
  [ "$want" = "$(sha256sum "$AGE" | cut -d' ' -f1)" ] || fail "the copy does not match its manifest (sha256)"
  age -d -i "$IDENTITY" -o "$work/dump" "$AGE" || fail "could not decrypt the copy with that key"
  DUMP="$work/dump"
  say "the copy matches its manifest and decrypts"
fi
[ -n "$DUMP" ] && [ -f "$DUMP" ] || fail "give --age (with --manifest and --identity) or --dump"

# ---- 2. the drill, with throwaway secrets ----
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
pw=$(hex 24)
sed -e "s|^APP_URL=.*|APP_URL=http://127.0.0.1:18180|" -e "s|change-me-fake|$pw|g" -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pw|" \
  -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(hex 32)|" -e "s|^POSTGRES_APP_PASSWORD=.*|POSTGRES_APP_PASSWORD=$(hex 32)|" \
  -e "s|^EMAIL_PROVIDER=.*|EMAIL_PROVIDER=mailpit|" -e "s|^EMAIL_FROM=.*|EMAIL_FROM=Sirat drill <no-reply@drill.invalid>|" \
  -e "s|^PAYSTATION_ENV=.*|PAYSTATION_ENV=|" -e "s|^SECURITY_ALERT_EMAIL=.*|SECURITY_ALERT_EMAIL=|" .env.example > "$work/drill.env"
grep -q '^POSTGRES_APP_PASSWORD=' "$work/drill.env" || printf 'POSTGRES_APP_PASSWORD=%s\n' "$(hex 32)" >> "$work/drill.env"
printf 'MAILPIT_URL=http://mailpit:8025\n' >> "$work/drill.env"
printf 'SIRAT_TAG=%s\n' "$TAG" > "$work/release.env"
unset pw
# The API and worker read this file instead of the clone's .env (infra/backup/drill.compose.yml).
DRILL_ENV_FILE="$work/drill.env"
if command -v cygpath > /dev/null 2>&1; then DRILL_ENV_FILE=$(cygpath -m "$DRILL_ENV_FILE"); fi
export DRILL_ENV_FILE
DC=(docker compose -p "$P" --env-file "$work/drill.env" --env-file "$work/release.env")
for f in $COMPOSE; do DC+=(-f "$f"); done
dc() { "${DC[@]}" "$@"; }

config=$(dc config --format json)
wide=$(jq -r '[.services[] | (.ports // [])[] | select((.host_ip // "") != "127.0.0.1")] | length' <<< "$config")
[ "$wide" = 0 ] || fail "compose would bind $wide port(s) beyond 127.0.0.1: refused"
# The app containers must read the drill's settings, never the clone's .env: compose folds env_file into each
# service's environment, so the drill's own (throwaway) JWT secret must be the one they get. Compared, not printed.
mine=$(sed -n 's/^JWT_ACCESS_SECRET=//p' "$work/drill.env")
same=$(jq -r --arg mine "$mine" '[.services.api, .services.worker | (.environment.JWT_ACCESS_SECRET == $mine)] | all' <<< "$config")
[ "$same" = true ] || fail "the api or worker would not read the drill's own settings: refused"
unset mine
trap 'cleanup_work; [ "$KEEP" = 1 ] || wipe' EXIT
dc up -d --no-build --wait --wait-timeout 180 postgres pgbouncer redis-cache redis-queue mailpit > /dev/null
dc up -d --no-deps --no-build nginx > /dev/null
say "project $P up: its own volumes, ports on 127.0.0.1 only"

# ---- 3. the restore and the checks ----
t0=$SECONDS
envs=(--env-file "$work/drill.env" --env-file "$work/release.env")
scripts/restore.sh "$DUMP" --project "$P" --mode rebuild --compose "$COMPOSE" "${envs[@]}" --confirm "$P" --no-maintenance
restore_seconds=$((SECONDS - t0))

# shellcheck disable=SC2016 # the quotes are the container shell's
q() { dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAX -v ON_ERROR_STOP=1 -c "$1"' sh "$1"; }
fails=0
ok() { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }
check() { local what=$1; shift; if "$@" > /dev/null 2>&1; then ok "$what"; else bad "$what"; fi; }

if [ -n "$MANIFEST" ] && [ -f "$MANIFEST" ]; then
  counts_match() {
    local t want got
    while IFS=$'\t' read -r t want; do
      case "$t" in sessions | auth_tokens) continue ;; esac # cleared on purpose by the restore
      got=$(q "select count(*) from \"$t\"")
      [ "$got" = "$want" ] || { echo "    $t: $got rows, the manifest says $want"; return 1; }
    done < <(jq -r '.tables | to_entries[] | "\(.key)\t\(.value)"' "$MANIFEST")
  }
  check "every table's row count matches the manifest" counts_match
else
  echo "  n/a   the row counts (no manifest with --dump)"
fi
check "the triggers came back (audit_logs_no_update_delete among them)" test "$(q "select count(*) from pg_trigger where not tgisinternal and tgname = 'audit_logs_no_update_delete'")" = 1
check "sirat_app may read and write the app tables" test "$(q "select has_table_privilege('sirat_app', 'users', 'SELECT,INSERT,UPDATE')")" = t
check "sirat_app has no rights on _prisma_migrations" test "$(q "select has_table_privilege('sirat_app', '_prisma_migrations', 'SELECT')")" = f
check "default privileges for new tables are in place" test "$(q "select count(*) from pg_default_acl")" -gt 0
# shellcheck disable=SC2016
check "statement_timeout is 10s in a new session" test "$(dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAX -c "SHOW statement_timeout"')" = 10s
audit_refuses() {
  [ "$(q "select count(*) from audit_logs")" -gt 0 ] || { echo "    (no audit row to try)"; return 0; }
  ! q "BEGIN; DELETE FROM audit_logs WHERE id = (SELECT id FROM audit_logs LIMIT 1); ROLLBACK"
}
check "the audit log refuses a delete" audit_refuses
# shellcheck disable=SC2016
check "one login as sirat_app" dc exec -T -e "PGPASSWORD=$(sed -n 's/^POSTGRES_APP_PASSWORD=//p' "$work/drill.env")" postgres \
  sh -c 'psql -h 127.0.0.1 -U sirat_app -d "$POSTGRES_DB" -tAX -c "select 1"'

say "pg_restore and the checks: restore.sh took ${restore_seconds} s in all; $fails check(s) failed"
if [ "$KEEP" = 1 ]; then say "kept up (--keep): http://127.0.0.1:18180, Mailpit http://127.0.0.1:18125; scripts/restore-drill.sh --wipe removes it"; fi
[ "$fails" = 0 ]

#!/usr/bin/env bash
# DESTRUCTIVE: restores a decrypted dump (L7, LAUNCH-PLAN section 5; RUNBOOK section 5). Drill it first
# (scripts/restore-drill.sh) on another machine.
#
#   scripts/restore.sh <file.dump> --project <name> [--mode rebuild|beside] [options]
#
#   --mode rebuild   (default) into the EMPTY database of a fresh data volume: a rebuilt server. No --clean, so an
#                    existing database is never overwritten (it refuses one that has tables).
#   --mode beside    the server is still up: into <db>_restore_<stamp>, checked, then the names are swapped. The old
#                    database stays as <db>_old_<stamp>, for payments newer than the dump.
#   --compose "<files>"   compose files from the clone root (default: infra/docker-compose.yml)
#   --env-file <file>     the env files compose reads (repeatable; default: .env, then /var/lib/sirat/release.env)
#   --confirm <name>      the project name, instead of typing it (the drill)
#   --allow-dev           accept a server marked sirat.environment (development); refused otherwise
#   --no-maintenance      leave the maintenance switch alone (the drill, which has no visitors)
#
# Order: read the whole archive; say what it will act on and ask for the project name; maintenance on; stop web, api
# and worker (nginx keeps serving the maintenance page); make sure the runtime role exists (roles are not in a dump);
# restore in one transaction; clear sessions and tokens (everyone logs in again); migrate (the runtime role's
# timeouts, CONNECT and login come back); check the timeouts, grants and migrations; flush the cache; start the app;
# check it through nginx's internal listener. Maintenance stays on for a person to check, then switch off. Credentials
# stay inside the postgres container; nothing secret is printed.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "restore: $*" >&2; exit 1; }
say() { echo "restore: $*"; }

FILE=''
PROJECT=''
MODE=rebuild
COMPOSE='infra/docker-compose.yml'
ENV_FILES=()
CONFIRM=''
ALLOW_DEV=0
MAINT=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift ;;
    --mode) MODE="${2:-}"; shift ;;
    --compose) COMPOSE="${2:-}"; shift ;;
    --env-file) ENV_FILES+=("${2:-}"); shift ;;
    --confirm) CONFIRM="${2:-}"; shift ;;
    --allow-dev) ALLOW_DEV=1 ;;
    --no-maintenance) MAINT=0 ;;
    -*) fail "unknown option $1" ;;
    *) [ -z "$FILE" ] || fail "one dump file only"; FILE=$1 ;;
  esac
  shift
done
[ -n "$FILE" ] && [ -f "$FILE" ] || fail "usage: scripts/restore.sh <file.dump> --project <name> [--mode rebuild|beside]"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "--project must name the compose project (e.g. sirat)"
case "$MODE" in rebuild | beside) ;; *) fail "--mode is rebuild or beside" ;; esac
if [ "${#ENV_FILES[@]}" = 0 ]; then
  ENV_FILES=(.env)
  [ -f /var/lib/sirat/release.env ] && ENV_FILES+=(/var/lib/sirat/release.env)
fi
DC=(docker compose -p "$PROJECT")
for f in "${ENV_FILES[@]}"; do DC+=(--env-file "$f"); done
for f in $COMPOSE; do DC+=(-f "$f"); done
dc() { "${DC[@]}" "$@"; }
# SQL in the postgres container, as the owner, on a named database (credentials stay in the container).
# shellcheck disable=SC2016 # the quotes are the container shell's
sql() { dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "${1:-$POSTGRES_DB}" -tAX -v ON_ERROR_STOP=1 -c "$2"' sh "$1" "$2"; }
# shellcheck disable=SC2016
DB=$(dc exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')
[ -n "$DB" ] || fail "the postgres container of project $PROJECT is not running"

# ---- 1. the whole archive must read, before anything changes ----
started=$SECONDS
dc exec -T postgres pg_restore -f /dev/null < "$FILE" || fail "the dump is unreadable or truncated: $FILE (nothing changed)"

# ---- 2. what it will act on, and the typed project name ----
marker=$(sql "$DB" "select coalesce(current_setting('sirat.environment', true), '')")
tables=$(sql "$DB" "select count(*) from pg_tables where schemaname = 'public'")
say "project: $PROJECT; database: $DB ($tables tables now); server marker: ${marker:-none}; mode: $MODE"
[ -z "$marker" ] || [ "$ALLOW_DEV" = 1 ] || fail "this server is marked '$marker' (development): refused without --allow-dev"
if [ "$MODE" = rebuild ] && [ "$tables" != 0 ]; then
  fail "database $DB is not empty: a rebuild needs a fresh volume (or use --mode beside, which keeps the old database)"
fi
if [ -n "$CONFIRM" ]; then
  [ "$CONFIRM" = "$PROJECT" ] || fail "--confirm does not match the project"
else
  read -r -p "Type the project name ($PROJECT) to restore into it: " typed
  [ "$typed" = "$PROJECT" ] || fail "not confirmed; nothing changed"
fi

# ---- 3. traffic off, writers stopped ----
if [ "$MAINT" = 1 ]; then scripts/maintenance.sh on; fi
dc stop api worker web > /dev/null 2>&1 || true
say "web, api and worker stopped$([ "$MAINT" = 1 ] && echo '; nginx shows the maintenance page')"

# ---- 4. the runtime role first: a dump carries grants to it, never the role ----
dc run --rm --no-deps -T migrate node_modules/.bin/tsx prisma/runtime-role.ts --ensure

# ---- 5. the restore, in one transaction ----
target=$DB
stamp=$(date -u +%Y%m%d%H%M%S)
if [ "$MODE" = beside ]; then
  target="${DB}_restore_$stamp"
  sql postgres "CREATE DATABASE \"$target\"" > /dev/null
fi
t0=$SECONDS
# shellcheck disable=SC2016
dc exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --single-transaction --exit-on-error' sh "$target" < "$FILE" ||
  fail "pg_restore failed: nothing was restored (one transaction)$([ "$MODE" = beside ] && echo "; $target is left empty for inspection")"
restore_seconds=$((SECONDS - t0))
say "restored into $target in ${restore_seconds} s"
[ "$(sql "$target" "select count(*) from _prisma_migrations where finished_at is not null")" -gt 0 ] ||
  fail "the restored database has no applied migrations: not a Sirat dump"

if [ "$MODE" = beside ]; then
  old="${DB}_old_$stamp"
  sql postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$DB', '$target') AND pid <> pg_backend_pid()" > /dev/null
  sql postgres "ALTER DATABASE \"$DB\" RENAME TO \"$old\"" > /dev/null
  sql postgres "ALTER DATABASE \"$target\" RENAME TO \"$DB\"" > /dev/null
  # Pooled server connections still point at the old database: restart PgBouncer so none is reused.
  dc restart pgbouncer > /dev/null
  say "swapped: $DB is the restored copy; the old database is kept as $old"
fi

# ---- 6. sessions and tokens are not carried over: everyone logs in again ----
sql "$DB" "DELETE FROM sessions; DELETE FROM auth_tokens" > /dev/null

# ---- 7. migrate: migrations, the runtime role's timeouts, CONNECT and login, the config seed ----
out=$(dc run --rm --no-deps -T migrate 2>&1) || { printf '%s\n' "$out" | tail -n 20 >&2; fail "migrate failed after the restore"; }
grep -q 'config seed done' <<< "$out" || fail "migrate did not finish its seed"

# ---- 8. checks on the restored database ----
# shellcheck disable=SC2016
fresh_timeout=$(dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAX -c "SHOW statement_timeout"')
[ "$fresh_timeout" = 10s ] || fail "statement_timeout in a new session is '$fresh_timeout', not 10s"
[ "$(sql "$DB" "select has_table_privilege('sirat_app', 'users', 'SELECT')")" = t ] || fail "sirat_app cannot read users"
[ "$(sql "$DB" "select has_database_privilege('sirat_app', current_database(), 'CONNECT')")" = t ] || fail "sirat_app cannot connect"
grep -q 'Database schema is up to date' <<< "$(dc run --rm --no-deps -T migrate node_modules/.bin/prisma migrate status 2>&1)" ||
  fail "prisma migrate status is not up to date"
say "checks: statement_timeout 10s in a new session, sirat_app's grants and CONNECT, migrations up to date"

# ---- 9. the cache, the app, the internal listener ----
dc exec -T redis-cache redis-cli FLUSHALL > /dev/null
dc up -d --no-deps --no-build --wait --wait-timeout 300 api worker web > /dev/null
# The restarted containers may have new addresses, and nginx keeps a resolved one for up to 10 s (resolver valid=10s):
# as deploy.sh's settle, three good rounds in a row (the API and the home page) before judging, at most 30 s.
inner() { dc exec -T nginx curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:8081$1" || true; }
end=$((SECONDS + ${RESTORE_SETTLE_SECONDS:-30}))
good=0
while :; do
  ready=$(dc exec -T nginx curl -s -m 10 -w ' %{http_code}' http://127.0.0.1:8081/api/ready || true)
  home=$(inner /)
  if [ "$ready" = '{"status":"ready"} 200' ] && [ "$home" = 200 ]; then good=$((good + 1)); else good=0; fi
  if [ "$good" -ge 3 ] || [ "$SECONDS" -ge "$end" ]; then break; fi
  sleep 2
done
[ "$good" -ge 3 ] ||
  fail "the app does not answer through the internal listener: /api/ready ${ready##* }, the home page $home"

say "RESTORED project $PROJECT from $(basename "$FILE"): ${restore_seconds} s for pg_restore, $((SECONDS - started)) s in all"
cat << EOF
restore: now, by hand (RUNBOOK section 5):
  - check the app through the internal listener, then: scripts/maintenance.sh off$([ "$MAINT" = 1 ] || echo ' (not switched on here)')
  - rotate JWT_ACCESS_SECRET in .env, then recreate api and worker (old access tokens stop working)
  - compare payments since the dump time minus 1 h with a PayStation export (section 11)
EOF
[ "$MODE" = rebuild ] || echo "  - the old database stays as ${DB}_old_$stamp: drop it once nothing more is needed from it"

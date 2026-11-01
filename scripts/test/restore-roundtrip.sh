#!/usr/bin/env bash
# L7's round trip, inside run-restore-roundtrip.sh's tools container (as root; not to be run on its own). A source in
# its own project (sirat-drill-src: Postgres and Redis only, throwaway settings): migrations, admin A, a dump, admin B.
# Then restore-drill.sh restores the dump into sirat-drill (--keep): A logs in (204), B does not (401). Then
# restore.sh --mode beside restores it again over the running drill: the names are swapped, the old database is kept,
# and the logins answer the same. Everything is wiped at the end.
set -euo pipefail
: "${CLONE_DIR:?}" "${OUT:?}" "${TAG:?}"
cd "$CLONE_DIR"
S=sirat-drill-src
fails=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; fails=$((fails + 1)); }
check() { local what=$1; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

cleanup() {
  docker compose -p "$S" down -v > /dev/null 2>&1 || true
  bash scripts/restore-drill.sh --wipe > /dev/null 2>&1 || true
}
trap cleanup EXIT

# ---- the source ----
pw=$(hex 24)
sed -e "s|change-me-fake|$pw|g" -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pw|" \
  -e "s|@pgbouncer:6432/\([a-z_]*\)?[^ ]*|@postgres:5432/\1|" -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(hex 32)|" \
  -e "s|^POSTGRES_APP_PASSWORD=.*|POSTGRES_APP_PASSWORD=$(hex 32)|" \
  -e "s|^EMAIL_PROVIDER=.*|EMAIL_PROVIDER=mailpit|" -e "s|^PAYSTATION_ENV=.*|PAYSTATION_ENV=|" .env.example > "$OUT/src.env"
printf 'MAILPIT_URL=http://mailpit:8025\nSIRAT_TAG=%s\n' "$TAG" >> "$OUT/src.env"
unset pw
export DRILL_ENV_FILE="$OUT/src.env"
SDC=(docker compose -p "$S" --env-file "$OUT/src.env" -f infra/docker-compose.yml -f infra/backup/drill.compose.yml)
# PgBouncer too: the create-admin CLI runs in the api image, which reaches Postgres as sirat_app through it (L8).
"${SDC[@]}" up -d --no-build --wait postgres pgbouncer redis-cache redis-queue > /dev/null
out=$("${SDC[@]}" run --rm --no-deps -T migrate 2>&1) || { echo "$out" | tail -n 20; exit 1; }
admin() { # admin <letter> <password>
  printf '%s\n' "$2" | "${SDC[@]}" run --rm --no-deps -T api node dist/cli/create-admin.js --password-stdin \
    --email "drill-$1@restore.invalid" --name "Drill $1" 2>&1
}
pa=$(hex 16)
pb=$(hex 16)
check "admin A created in the source" grep -q 'Admin created' <<< "$(admin a "$pa")"
# shellcheck disable=SC2016 # the quotes are the container shell's
"${SDC[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT/src.dump"
check "the dump was taken (A only)" test -s "$OUT/src.dump"
check "admin B created after the dump" grep -q 'Admin created' <<< "$(admin b "$pb")"
"${SDC[@]}" down -v > /dev/null 2>&1
unset DRILL_ENV_FILE

# ---- the drill: rebuild ----
t0=$SECONDS
s=0
RESTORE_DRILL_WORK="$OUT/drill" bash scripts/restore-drill.sh --dump "$OUT/src.dump" --tag "$TAG" --keep > "$OUT/drill.log" 2>&1 || s=$?
sed 's/^/        | /' "$OUT/drill.log" | tail -n 22
check "restore-drill.sh: the restore and every check pass ($((SECONDS - t0)) s in all)" test "$s" = 0
docker network connect sirat-drill_default "$(hostname)"
login() { # login <letter> <password>: the HTTP status of POST /api/auth/login through the drill's nginx
  curl -s -m 15 -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -H 'x-requested-with: sirat-web' \
    --data "{\"email\":\"drill-$1@restore.invalid\",\"password\":\"$2\"}" http://nginx/api/auth/login
}
check "A logs in on the restored copy (204)" test "$(login a "$pa")" = 204
check "B, created after the dump, does not (401)" test "$(login b "$pb")" = 401

# ---- beside: over the running drill, names swapped, the old database kept ----
export DRILL_ENV_FILE="$OUT/drill/drill.env"
args=(--env-file "$OUT/drill/drill.env" --env-file "$OUT/drill/release.env")
DDC=(docker compose -p sirat-drill "${args[@]}" -f infra/docker-compose.yml -f infra/backup/drill.compose.yml)
# shellcheck disable=SC2016 # the quotes are the container shell's
db=$("${DDC[@]}" exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')
s=0
bash scripts/restore.sh "$OUT/src.dump" --project sirat-drill --mode beside --compose "infra/docker-compose.yml infra/backup/drill.compose.yml" \
  "${args[@]}" --confirm sirat-drill --no-maintenance > "$OUT/beside.log" 2>&1 || s=$?
sed 's/^/        | /' "$OUT/beside.log" | tail -n 8
check "restore.sh --mode beside over the running drill" test "$s" = 0
# shellcheck disable=SC2016
olds=$("${DDC[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -tAX -c "$1"' sh   "select count(*) from pg_database where datname like '${db}_old_%'")
check "the old database is kept beside it" test "$olds" = 1
check "A still logs in (204)" test "$(login a "$pa")" = 204
check "B still does not (401)" test "$(login b "$pb")" = 401

echo "restore round trip: $fails failed"
[ "$fails" = 0 ]

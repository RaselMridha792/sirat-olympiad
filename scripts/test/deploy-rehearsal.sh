#!/usr/bin/env bash
# The L9 deploy rehearsal's steps (LAUNCH-PLAN section 2). Runs inside run-deploy-rehearsal.sh's tools container, as
# root; deploy.sh and git run as the user `deploy`. Not to be run on its own.
#   setup: a bare "origin" (main and this checkout's HEAD), the clone, commits B-E on branch `rehearsal`, throwaway
#          secrets, a self-signed certificate for sirat-rh.test, .env.deploy in rehearsal mode
#   0. preflight refusals: root, .env mode, an exported DATABASE_URL, a dirty tree
#   1. --first, then release A          2. release B (a migration) under a request loop
#   3. the RUNBOOK's scale, create-admin and worker commands: release B's images, no build
#   4. C, whose API fails at boot: rolled back to B by itself, timed
#   5. D, a failing migration: no app container restarted; then the RUNBOOK's resolve
#   6. E, a PgBouncer pool change: "data-service change pending"
#   7. maintenance on and off, checked through the internal listener
#   8. maintenance on, --rollback to A; then maintenance off and the public smoke
#   9. B again: the failed releases' images are pruned
#   10. without rehearsal mode, C is refused as not on origin/main; an open exam window refuses a deploy
#   the data containers never restarted
# The RUNBOOK's command lines and the SQL for the container's shell are quoted literally on purpose.
# shellcheck disable=SC2016
set -euo pipefail
: "${CLONE_DIR:?}" "${OUT:?}"
P=sirat-rh
STATE=/var/lib/sirat-rh
HOST=sirat-rh.test
failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
check() { local what=$1; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }
note() { echo "        $*"; }

as_deploy() { su-exec deploy env HOME=/home/deploy "$@"; }
in_clone() { (cd "$CLONE_DIR" && as_deploy "$@"); }
git_c() { in_clone git "$@"; }
DC=(docker compose -p "$P" --env-file "$CLONE_DIR/.env" --env-file "$STATE/release.env"
  -f "$CLONE_DIR/infra/docker-compose.yml" -f "$CLONE_DIR/infra/deploy/rehearsal.compose.yml")
dc() { in_clone "${DC[@]}" "$@"; }
DEPLOY_N=0
deploy() { # deploy <args>: output in $OUT/last.log (and in full in $OUT/deploy-<n>.log), status returned
  local s=0
  DEPLOY_N=$((DEPLOY_N + 1))
  in_clone bash scripts/deploy.sh "$@" > "$OUT/last.log" 2>&1 || s=$?
  cp "$OUT/last.log" "$OUT/deploy-$DEPLOY_N.log"
  sed 's/^/        | /' "$OUT/last.log" | tail -n 12
  return "$s"
}
said() { grep -qF -- "$1" "$OUT/last.log"; }
live() { sed -n 's/^SIRAT_TAG=//p' "$STATE/release.env"; }
images_of() { # the image of every running api, worker and web container, one per line, sorted
  local s
  for s in api worker web; do
    for c in $(docker ps -q --filter "label=com.docker.compose.project=$P" --filter "label=com.docker.compose.service=$s"); do
      docker inspect -f '{{.Config.Image}}' "$c"
    done
  done | sort -u
}
all_on() { # all_on <sha>: every app container runs that release
  [ "$(images_of)" = "$(printf 'sirat-api:%s\nsirat-web:%s\nsirat-worker:%s\n' "$1" "$1" "$1" | sort)" ]
}
app_state() { docker ps -q --filter "label=com.docker.compose.project=$P" | sort | xargs -r docker inspect -f '{{.Name}} {{.State.StartedAt}}' | grep -vE 'postgres|pgbouncer|redis|mailpit|nginx' || true; }
data_state() { docker ps -q --filter "label=com.docker.compose.project=$P" | xargs -r docker inspect -f '{{.Name}} {{.State.StartedAt}}' | grep -E 'postgres|pgbouncer|redis' | sort; }
image_ids() { docker image ls --format '{{.ID}}' | sort -u; }
pg() { dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAX -v ON_ERROR_STOP=1 -c "$1"' sh "$1"; }

# ---------------- setup ----------------
echo "setup"
gid=$(stat -c %g /var/run/docker.sock)
adduser -D -s /bin/bash deploy > /dev/null
if [ "$gid" = 0 ]; then addgroup deploy root; else addgroup -g "$gid" dockersock 2> /dev/null || true; addgroup deploy "$(getent group "$gid" | cut -d: -f1)"; fi
mkdir -p "$STATE" "$(dirname "$CLONE_DIR")"
chown deploy "$STATE" "$(dirname "$CLONE_DIR")"
as_deploy git init -q --bare /home/deploy/origin.git
as_deploy git -C /home/deploy/origin.git fetch -q /work/in/rh.bundle 'HEAD:refs/heads/rh-base' 'refs/remotes/origin/main:refs/heads/main'
as_deploy git clone -q -b rh-base /home/deploy/origin.git "$CLONE_DIR"
git_c switch -q -c rehearsal
commit() { git_c add -A && git_c -c user.name=rehearsal -c user.email=rehearsal@local.invalid commit -q -m "$1" && git_c rev-parse HEAD; }
A=$(git_c rev-parse HEAD)
M_OK=20991231000000_rehearsal_probe
M_BAD=20991231000001_rehearsal_fails
in_clone mkdir -p "apps/api/prisma/migrations/$M_OK"
in_clone sh -c "printf 'CREATE TABLE rehearsal_probe (id integer PRIMARY KEY);\n' > apps/api/prisma/migrations/$M_OK/migration.sql"
B=$(commit "rehearsal B: a migration")
in_clone sh -c "printf '%s\n' \"throw new Error('rehearsal C: the API fails at boot');\" | cat - apps/api/src/main.ts > /tmp/main.ts && cp /tmp/main.ts apps/api/src/main.ts"
C=$(commit "rehearsal C: the API fails at boot")
git_c checkout -q "$B" -- apps/api/src/main.ts
in_clone mkdir -p "apps/api/prisma/migrations/$M_BAD"
in_clone sh -c "printf 'SELECT 1 / 0;\n' > apps/api/prisma/migrations/$M_BAD/migration.sql"
D=$(commit "rehearsal D: a failing migration")
in_clone rm -rf "apps/api/prisma/migrations/$M_BAD"
in_clone sed -i "s/DEFAULT_POOL_SIZE: '40'/DEFAULT_POOL_SIZE: '41'/" infra/docker-compose.yml
E=$(commit "rehearsal E: a PgBouncer pool change")
printf '%s\n' "$A" "$B" "$C" "$D" "$E" > "$OUT/shas"
# --first starts the data services from the clone's commit, which must be the first release's (A).
git_c checkout -q --detach "$A"
note "A=${A:0:7} B=${B:0:7} C=${C:0:7} D=${D:0:7} E=${E:0:7}"

# Throwaway secrets, never printed; a self-signed certificate the tools container trusts.
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
pw=$(hex 24)
apppw=$(hex 32)
jwt=$(hex 32)
sed -e "s|^APP_URL=.*|APP_URL=https://$HOST|" -e "s|change-me-fake|$pw|g" -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pw|" \
  -e "s|^POSTGRES_APP_PASSWORD=.*|POSTGRES_APP_PASSWORD=$apppw|" \
  -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$jwt|" -e "s|^EMAIL_PROVIDER=.*|EMAIL_PROVIDER=mailpit|" \
  -e "s|^EMAIL_FROM=.*|EMAIL_FROM=Sirat rehearsal <no-reply@$HOST>|" -e "s|^PAYSTATION_ENV=.*|PAYSTATION_ENV=|" \
  -e "s|^SECURITY_ALERT_EMAIL=.*|SECURITY_ALERT_EMAIL=|" "$CLONE_DIR/.env.example" > /tmp/rh.env
printf 'MAILPIT_URL=http://mailpit:8025\n' >> /tmp/rh.env
install -o deploy -m 600 /tmp/rh.env "$CLONE_DIR/.env"
rm -f /tmp/rh.env
unset pw apppw jwt
in_clone openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 2 -subj "/CN=$HOST" \
  -addext "subjectAltName=DNS:$HOST" -keyout infra/nginx/certs/origin.key -out infra/nginx/certs/origin.pem 2> /dev/null
cp "$CLONE_DIR/infra/nginx/certs/origin.pem" /usr/local/share/ca-certificates/sirat-rh.crt
update-ca-certificates > /dev/null 2>&1
cat > /tmp/rh.deploy <<EOF
DEPLOY_PROJECT=$P
DEPLOY_COMPOSE_FILES=infra/docker-compose.yml infra/deploy/rehearsal.compose.yml
DEPLOY_RELEASE_DIR=$STATE
DEPLOY_PUBLIC_URL=https://$HOST
DEPLOY_BACKUP_CMD=echo backup >> $STATE/backups.log
DEPLOY_MIN_FREE_GB=5
DEPLOY_WAIT_SECONDS=300
DEPLOY_REHEARSAL=1
DEPLOY_REHEARSAL_BRANCH=rehearsal
EOF
install -o deploy -m 600 /tmp/rh.deploy "$CLONE_DIR/.env.deploy"
rm -f /tmp/rh.deploy
backups() { [ -f "$STATE/backups.log" ] && wc -l < "$STATE/backups.log" || echo 0; }

# ---------------- 0. preflight refusals (before anything exists) ----------------
echo "0. preflight refusals"
s=0; (cd "$CLONE_DIR" && env HOME=/root bash scripts/deploy.sh "$A") > "$OUT/last.log" 2>&1 || s=$?
check "as root: refused" test "$s" -ne 0 -a -n "$(grep -F 'do not run as root' "$OUT/last.log")"
in_clone chmod 644 .env
s=0; deploy "$A" > /dev/null || s=$?
check ".env not 600: refused" test "$s" -ne 0 -a -n "$(grep -F '.env must be mode 600' "$OUT/last.log")"
in_clone chmod 600 .env
s=0; (cd "$CLONE_DIR" && su-exec deploy env HOME=/home/deploy DATABASE_URL=postgresql://x@elsewhere/x bash scripts/deploy.sh "$A") > "$OUT/last.log" 2>&1 || s=$?
check "an exported DATABASE_URL: refused" test "$s" -ne 0 -a -n "$(grep -F 'DATABASE_URL is exported' "$OUT/last.log")"
in_clone sh -c 'echo "local change" >> README.md'
s=0; deploy "$A" > /dev/null || s=$?
check "a dirty tree: refused" test "$s" -ne 0 -a -n "$(grep -F 'local changes' "$OUT/last.log")"
git_c checkout -q -- README.md
s=0; deploy "$A" > /dev/null || s=$?
check "before --first: refused (no data services)" test "$s" -ne 0 -a -n "$(grep -F 'is not running' "$OUT/last.log")"

# ---------------- 1. first start, release A ----------------
echo "1. first start and release A"
s=0; deploy --first || s=$?
check "--first starts the data services and nginx" test "$s" = 0
check "--first names the commit to deploy first" said "deploy this same commit first: scripts/deploy.sh $A"
docker network connect "${P}_default" "$(hostname)"
dc up -d --no-deps mailpit > /dev/null 2>&1
DATA0=$(data_state)
s=0; deploy --first || s=$?
check "--first again: refused (a data container exists)" test "$s" -ne 0 -a -n "$(grep -F 'already exists' "$OUT/last.log")"
started=$SECONDS
s=0; deploy "$A" || s=$?
check "release A deploys ($((SECONDS - started)) s)" test "$s" = 0
check "release A is live, on every app container" all_on "$A"
all_on "$A" || { echo "  release A is not live: stopping here"; exit 1; }
check "the first release took no backup" test "$(backups)" = 0
check "the public URL answers (healthcheck.sh)" in_clone scripts/healthcheck.sh "https://$HOST"

# ---------------- 2. release B under a request loop ----------------
echo "2. release B (a migration) under a request loop"
: > "$OUT/loop.log"
(while :; do
  c1=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "https://$HOST/api/health" || echo 000)
  c2=$(curl -s -m 5 -o "$OUT/page.html" -w '%{http_code}' "https://$HOST/" || echo 000)
  page=other
  grep -q 'data-sirat-page="maintenance"' "$OUT/page.html" 2> /dev/null && page=maintenance
  printf '%s %s %s %s\n' "$(date +%s.%N | cut -c1-14)" "$c1" "$c2" "$page" >> "$OUT/loop.log"
  sleep 0.2
done) &
LOOP=$!
started=$SECONDS
s=0; deploy "$B" || s=$?
took=$((SECONDS - started))
sleep 3
kill "$LOOP" 2> /dev/null || true
wait "$LOOP" 2> /dev/null || true
check "release B deploys under load (${took} s)" test "$s" = 0
check "release B is live, on every app container" all_on "$B"
all_on "$B" || { echo "  release B is not live: stopping here"; exit 1; }
check "B adds a migration: one backup first" test "$(backups)" = 1
check "the migration is applied" test "$(pg "select count(*) from _prisma_migrations where migration_name = '$M_OK' and finished_at is not null")" = 1
total=$(wc -l < "$OUT/loop.log")
api_bad=$(awk '$2 != 200' "$OUT/loop.log" | wc -l)
gap=$(awk '$2 != 200 {if (!f) f = $1; l = $1} END {if (f) printf "%.1f", l - f; else print 0}' "$OUT/loop.log")
raw=$(awk '$3 != 200 && $4 != "maintenance"' "$OUT/loop.log" | wc -l)
note "request loop: $total rounds; the API answered non-200 in $api_bad of them, over ${gap} s (the deploy gap, owner question Q4)"
check "during the gap every page got the maintenance page, never a bare error" test "$raw" = 0

# ---------------- 3. the RUNBOOK's commands on the live release ----------------
echo "3. the RUNBOOK's commands, exactly as written apart from \$DC"
SCALE='$DC up -d --no-deps --no-build --no-recreate --scale api=<n> api'
WORKER='$DC up -d --no-deps --no-build worker'
ADMIN='$DC run --rm --no-deps api node dist/cli/create-admin.js --email ops@example.org --name "Ops Admin"'
for line in "$SCALE" "$WORKER" "$ADMIN"; do
  check "the RUNBOOK has: ${line:0:70}" grep -qF -- "$line" "$CLONE_DIR/docs/RUNBOOK.md"
done
ids0=$(image_ids)
run_dc_line() { in_clone bash -c "DC='${DC[*]}'; ${1//<n>/3}" > "$OUT/cmd.log" 2>&1; }
check "scale: three API replicas" run_dc_line "$SCALE"
check "worker: the command runs" run_dc_line "$WORKER"
# create-admin types the password at a hidden prompt; with no terminal here, --password-stdin (its other input).
pw=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
printf '%s\n%s\n' "$pw" "$pw" > /tmp/admin.pw
(cd "$CLONE_DIR" && su-exec deploy env HOME=/home/deploy "${DC[@]}" run --rm --no-deps -T api node dist/cli/create-admin.js \
  --password-stdin --email ops@rehearsal.invalid --name 'Ops Admin') < /tmp/admin.pw > "$OUT/admin.log" 2>&1 || true
rm -f /tmp/admin.pw
unset pw
check "create-admin (--password-stdin: no terminal here)" grep -q 'Admin created' "$OUT/admin.log"
check "every app container runs release B" all_on "$B"
check "three API replicas" test "$(docker ps -q --filter "label=com.docker.compose.project=$P" --filter label=com.docker.compose.service=api | wc -l)" = 3
check "no build started (no new image)" test "$(image_ids)" = "$ids0"
check "\$DC resolves the live release's four images" test "$(dc config --images | grep -c ":$B\$")" = 4

# ---------------- 4. a release whose API fails at boot ----------------
echo "4. release C: the API fails at boot"
started=$SECONDS
s=0; deploy "$C" || s=$?
took=$((SECONDS - started))
check "C fails and rolls back by itself (${took} s in all)" test "$s" -ne 0
check "it says it rolled back to B" said "ROLLED BACK to $B"
check "it says migrations stay applied" said 'MIGRATIONS STAY APPLIED'
check "B is still the live release" test "$(live)" = "$B"
check "every app container runs B again" all_on "$B"
check "C adds no migration: no backup" test "$(backups)" = 1
check "the scale command gives B" run_dc_line "$SCALE"
check "and every app container runs B" all_on "$B"

# ---------------- 5. a failing migration ----------------
echo "5. release D: a failing migration"
apps0=$(app_state)
s=0; deploy "$D" || s=$?
check "D stops at migrate" test "$s" -ne 0 -a -n "$(grep -F 'migrate failed' "$OUT/last.log")"
check "the migrate output names the failure" grep -qE "$M_BAD|P3018|division by zero" "$OUT/last.log"
check "a backup ran first (D adds a migration)" test "$(backups)" = 2
check "no app container restarted" test "$(app_state)" = "$apps0"
check "B is still the live release" test "$(live)" = "$B"
check "the clone is back on B" test "$(git_c rev-parse HEAD)" = "$B"
check "the RUNBOOK's resolve marks it rolled back" bash -c \
  "cd '$CLONE_DIR' && su-exec deploy env SIRAT_TAG=$D ${DC[*]} run --rm --no-deps migrate node_modules/.bin/prisma migrate resolve --rolled-back $M_BAD > /dev/null 2>&1"
check "and the RUNBOOK has that resolve command" grep -qF 'SIRAT_TAG=<failed sha> $DC run --rm --no-deps migrate node_modules/.bin/prisma migrate resolve --rolled-back <migration_name>' "$CLONE_DIR/docs/RUNBOOK.md"

# ---------------- 6. a data-service change ----------------
echo "6. release E: a PgBouncer pool change"
apps0=$(app_state)
ids0=$(image_ids)
s=0; deploy "$E" || s=$?
check "E is refused" test "$s" -ne 0
check "with the exact message" said 'data-service change pending: apply it as its own step'
check "nothing built, nothing restarted" test "$(image_ids)" = "$ids0" -a "$(app_state)" = "$apps0"
check "the clone is back on B" test "$(git_c rev-parse HEAD)" = "$B"

# ---------------- 7. maintenance on and off ----------------
echo "7. maintenance on and off"
inner() { dc exec -T nginx curl -s -m 10 -w ' %{http_code}' "http://127.0.0.1:8081$1"; }
in_clone scripts/maintenance.sh on > /dev/null
check "on: the internal listener still serves /api/ready" test "$(inner /api/ready)" = '{"status":"ready"} 200'
check "on: the public /api/ready is the MAINTENANCE answer" grep -q '"code":"MAINTENANCE"' <<< "$(curl -s "https://$HOST/api/ready")"
check "on: the public /healthz answers" test "$(curl -s https://$HOST/healthz)" = ok
in_clone scripts/maintenance.sh off > /dev/null
check "off: the public /api/ready answers 200" test "$(curl -s -o /dev/null -w '%{http_code}' https://$HOST/api/ready)" = 200

# ---------------- 8. a rollback during maintenance ----------------
echo "8. maintenance on, --rollback"
in_clone scripts/maintenance.sh on > /dev/null
s=0; deploy --rollback || s=$?
check "--rollback succeeds through the internal listener" test "$s" = 0
check "it rolled back to A" said "ROLLED BACK to $A"
check "it names the public check as pending" said 'public check pending until maintenance is off'
check "A is live, on every app container" all_on "$A"
check "the release file has A and no previous" test "$(live)" = "$A" -a -z "$(sed -n 's/^SIRAT_PREVIOUS_TAG=//p' "$STATE/release.env")"
in_clone scripts/maintenance.sh off > /dev/null
check "after maintenance off, the public smoke passes" in_clone scripts/healthcheck.sh "https://$HOST"
check "A runs on the newer schema (migrations stay applied)" test "$(pg "select to_regclass('public.rehearsal_probe') is not null")" = t

# ---------------- 9. B again: pruning ----------------
echo "9. release B again: the failed releases' images go"
s=0; deploy "$B" || s=$?
check "B deploys again (its images are cached)" test "$s" = 0
check "B is live" all_on "$B"
tags=$(docker image ls --format '{{.Repository}}:{{.Tag}}')
check "C's and D's images are removed" test -z "$(grep -E ":($C|$D)\$" <<< "$tags" || true)"
check "A's and B's images stay" test "$(grep -cE ":($A|$B)\$" <<< "$tags")" = 8

# ---------------- 10. the CI gate and an exam window ----------------
echo "10. the CI gate and an exam window"
in_clone sh -c "sed 's/^DEPLOY_REHEARSAL=1$/DEPLOY_REHEARSAL=0/' .env.deploy > /home/deploy/prod.env && chmod 600 /home/deploy/prod.env"
s=0; (cd "$CLONE_DIR" && su-exec deploy env HOME=/home/deploy SIRAT_DEPLOY_ENV=/home/deploy/prod.env bash scripts/deploy.sh "$C") > "$OUT/last.log" 2>&1 || s=$?
check "without rehearsal mode, C is refused as not on origin/main" test "$s" -ne 0 -a -n "$(grep -F 'is not on origin/main' "$OUT/last.log")"
pg "insert into exams (id, title, window_start, window_end, duration_minutes, questions_per_attempt, status, published_at) values (gen_random_uuid(), 'rehearsal window', now() - interval '5 minutes', now() + interval '20 minutes', 10, 1, 'published', now() - interval '10 minutes')" > /dev/null
s=0; deploy "$A" > /dev/null || s=$?
check "an exam window open now: a deploy is refused" test "$s" -ne 0 -a -n "$(grep -F 'exam window is open' "$OUT/last.log")"
pg "delete from exams where title = 'rehearsal window'" > /dev/null || note "could not delete the test exam (a throwaway database)"

check "the data containers never restarted" test "$(data_state)" = "$DATA0"

echo "deploy rehearsal: $failures failed"
[ "$failures" = 0 ]

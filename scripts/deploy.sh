#!/usr/bin/env bash
# Deploy and rollback (L9, LAUNCH-PLAN section 2, RUNBOOK section 2). Run as the `deploy` user from the clone.
#
#   scripts/deploy.sh --first       once on a fresh host: the data services and nginx (never recreates a data service)
#   scripts/deploy.sh <sha>         a release: preflight, build, backup if it adds migrations, migrate, start, smoke;
#                                   on a failure after the switch it rolls back to the live release by itself
#   scripts/deploy.sh --rollback    back to the previous release, with no build
#
# Images are tagged sirat-<service>:<sha>. The live release is SIRAT_TAG in the release file (DEPLOY_RELEASE_DIR,
# /var/lib/sirat/release.env), which the VPS `$DC` reads as its second --env-file, so every command run by hand uses
# the live images. Every compose call names the project (-p); data services are never started or recreated here.
# Configuration: .env.deploy in the clone (git-ignored, chmod 600; names in infra/deploy/deploy.env.example).
# It prints no secret: .env values are compared, never shown.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "deploy: $*" >&2; exit 1; }
say() { echo "deploy: $*"; }

MODE=deploy
TARGET=''
case "${1:-}" in
  --first) MODE=first ;;
  --rollback) MODE=rollback ;;
  '' | -*) echo "usage: scripts/deploy.sh <sha> | --first | --rollback" >&2; exit 2 ;;
  *) TARGET=$1 ;;
esac
[ "$#" -le 1 ] || { echo "usage: scripts/deploy.sh <sha> | --first | --rollback" >&2; exit 2; }

# ---- configuration: KEY=VALUE lines only ----
CONFIG="${SIRAT_DEPLOY_ENV:-$ROOT/.env.deploy}"
[ -f "$CONFIG" ] || fail "no config file at $CONFIG (see infra/deploy/deploy.env.example)"
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

PROJECT="$(cfg DEPLOY_PROJECT)"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "DEPLOY_PROJECT must name the compose project (e.g. sirat)"
REHEARSAL="$(cfg DEPLOY_REHEARSAL 0)"
REHEARSAL_BRANCH="$(cfg DEPLOY_REHEARSAL_BRANCH rehearsal)"
STATE="$(cfg DEPLOY_RELEASE_DIR /var/lib/sirat)"
read -r -a COMPOSE_FILES <<< "$(cfg DEPLOY_COMPOSE_FILES infra/docker-compose.yml)"
BACKUP_CMD="$(cfg DEPLOY_BACKUP_CMD 'sudo -n systemctl start sirat-backup.service')"
REPO="$(cfg DEPLOY_GITHUB_REPO RaselMridha792/sirat-olympiad)"
TOKEN="$(cfg DEPLOY_GITHUB_TOKEN)"
MIN_FREE_GB="$(cfg DEPLOY_MIN_FREE_GB 10)"
KEEP="$(cfg DEPLOY_KEEP_RELEASES 3)"
WAIT="$(cfg DEPLOY_WAIT_SECONDS 240)"
SETTLE="$(cfg DEPLOY_SETTLE_SECONDS 30)"
for n in "$MIN_FREE_GB" "$KEEP" "$WAIT" "$SETTLE"; do [[ "$n" =~ ^[0-9]+$ ]] || fail "a number setting is not a whole number"; done
[ "$KEEP" -ge 2 ] || fail "DEPLOY_KEEP_RELEASES must be at least 2 (a rollback needs the previous images)"
case "$REHEARSAL" in
  0) ;;
  1) [ "$PROJECT" != sirat ] || fail "rehearsal mode is refused for project sirat" ;;
  *) fail "DEPLOY_REHEARSAL must be 0 or 1" ;;
esac
[ "$REHEARSAL" = 1 ] && echo "deploy: REHEARSAL MODE (project $PROJECT): commits of branch $REHEARSAL_BRANCH are accepted; the CI gate is skipped"

RELEASE_FILE="$STATE/release.env"
LOG_FILE="$STATE/releases.log"
LOCK_FILE="$STATE/deploy.lock"
DATA=(postgres pgbouncer redis-cache redis-queue)
APPS=(api worker web)
IMAGES=(migrate api worker web)

DC=(docker compose -p "$PROJECT" --env-file "$ROOT/.env" --env-file "$RELEASE_FILE")
for f in "${COMPOSE_FILES[@]}"; do
  case "$f" in /*) DC+=(-f "$f") ;; *) DC+=(-f "$ROOT/$f") ;; esac
done
dc() { "${DC[@]}" "$@"; }
# A compose call for one release's images (the shell value beats the release file).
dc_at() { local tag=$1; shift; SIRAT_TAG="$tag" "${DC[@]}" "$@"; }

# ---- preflight shared by every mode ----
[ "$(id -u)" != 0 ] || fail "do not run as root: run as the deploy user"
for tool in docker git curl flock jq; do command -v "$tool" >/dev/null || fail "missing tool: $tool"; done
[ -f .env ] || fail "no .env in $ROOT"
[ "$(stat -c '%a' .env)" = 600 ] || fail ".env must be mode 600 (chmod 600 .env)"
# Exported values beat the files compose reads: a stray one would point the stack elsewhere.
for v in DATABASE_URL DIRECT_URL POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_APP_PASSWORD SIRAT_TAG; do
  [ -z "${!v+x}" ] || fail "$v is exported in this shell: unset it first (compose must read .env and the release file)"
done
if grep -q '^COMPOSE_' <<< "$(compgen -e)"; then fail "COMPOSE_* variables are exported in this shell: unset them first"; fi
mkdir -p "$STATE"
[ -f "$RELEASE_FILE" ] || printf '# Written by scripts/deploy.sh: the live release.\n' > "$RELEASE_FILE"
touch "$LOG_FILE"
exec 8> "$LOCK_FILE"
flock -n 8 || fail "another deploy is running ($LOCK_FILE)"

envval() { # a .env value, for comparisons only (never printed)
  local v
  v=$(grep -E "^$1=" .env | tail -1 | cut -d= -f2-) || true
  v="${v%\"}"
  printf '%s' "${v#\"}"
}
release_val() { grep -E "^$1=" "$RELEASE_FILE" | tail -1 | cut -d= -f2- || true; }
LIVE="$(release_val SIRAT_TAG)"
PREVIOUS="$(release_val SIRAT_PREVIOUS_TAG)"

container_of() { dc ps -q "$1" 2>/dev/null | sed -n 1p; }
# SQL inside the postgres container; credentials stay there (as backup.sh). The quotes are the container shell's.
# shellcheck disable=SC2016
pg() {
  dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAX -v ON_ERROR_STOP=1 -c "$1"' sh "$1"
}

record() { # record <sha> <what>
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$LOG_FILE"
}
write_release() { # write_release <live> <previous>
  local tmp="$RELEASE_FILE.tmp"
  { printf '# Written by scripts/deploy.sh: the live release. The VPS compose command reads it as its second --env-file.\n'
    printf 'SIRAT_TAG=%s\n' "$1"
    printf 'SIRAT_PREVIOUS_TAG=%s\n' "$2"
  } > "$tmp"
  mv -f "$tmp" "$RELEASE_FILE"
}

# ---- first start ----
if [ "$MODE" = first ]; then
  for s in "${DATA[@]}"; do
    if [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$s")" ]; then
      fail "a $s container of project $PROJECT already exists: --first is only for a fresh host (it never recreates a data service)"
    fi
  done
  for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_APP_PASSWORD DIRECT_URL JWT_ACCESS_SECRET APP_URL; do
    [ -n "$(envval "$key")" ] || fail ".env has no value for $key"
  done
  for f in infra/nginx/certs/origin.pem infra/nginx/certs/origin.key; do
    [ -s "$f" ] || fail "no $f (RUNBOOK section 15, the origin certificate)"
  done
  # The data services take their settings from this commit's compose file, and a deploy refuses any difference: the
  # first release must be this same commit.
  head=$(git rev-parse HEAD)
  say "first start of project $PROJECT from $head: the data services, then nginx"
  dc up -d --no-build --wait --wait-timeout "$WAIT" "${DATA[@]}"
  dc up -d --no-deps --no-build nginx
  record "$head" first-start
  say "first start done; deploy this same commit first: scripts/deploy.sh $head"
  exit 0
fi

# ---- preflight for a release or a rollback ----
[ -z "$(git status --porcelain)" ] || fail "the clone has local changes: a deploy builds exactly the commit (git status)"
free_gb=$(df -P -BG "$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /)" 2>/dev/null | awk 'NR==2 {gsub("G", "", $4); print $4}')
[ "${free_gb:-0}" -ge "$MIN_FREE_GB" ] || fail "only ${free_gb:-?} GB free for Docker (needs $MIN_FREE_GB): docker image prune first"

for s in "${DATA[@]}"; do
  cid=$(container_of "$s")
  [ -n "$cid" ] || fail "$s of project $PROJECT is not running: data services start with --first or by hand, never by a deploy"
  [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid")" = healthy ] || fail "$s is not healthy"
done
marker=$(pg "select coalesce(current_setting('sirat.environment', true), '')") || fail "cannot query Postgres"
[ -z "$marker" ] || fail "this Postgres carries the development marker (sirat.environment): never deploy to a dev stack"

# Exam windows: published exams open within 30 minutes either side of now. A database without the exams table (before
# the first release) has none.
exam_window_open() {
  [ "$(pg "select to_regclass('public.exams') is not null")" = t ] || return 1
  [ "$(pg "select count(*) from exams where status = 'published' and window_start < now() + interval '30 minutes' and window_end > now() - interval '30 minutes'")" != 0 ]
}
registration_open() {
  [ "$(pg "select to_regclass('public.settings') is not null")" = t ] || return 1
  [ "$(pg "select value::text from settings where key = 'registration_open'")" = true ]
}

# Data services must be exactly what this commit's compose file describes: a change is its own step, never a deploy's.
data_unchanged() {
  local s cid running wanted
  for s in "${DATA[@]}"; do
    cid=$(container_of "$s")
    running=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$cid")
    wanted=$(dc config --hash "$s" | awk '{print $2}')
    if [ "$running" != "$wanted" ]; then
      echo "deploy: data-service change pending: apply it as its own step ($s)" >&2
      if [ -z "$LIVE" ]; then
        echo "deploy: (no release yet: the first release must be the commit --first ran on, $(awk '$3 == "first-start" {c = $2} END {print c}' "$LOG_FILE"))" >&2
      fi
      return 1
    fi
  done
}

# ---- smoke: the internal listener, the public URL (by the maintenance state), PayStation, worker, migrations ----
inner() { # inner <path>: "<status> <body>" through nginx's internal listener
  dc exec -T nginx curl -s -m 10 -w '\n%{http_code}' "http://127.0.0.1:8081$1" | awk '{lines[NR]=$0} END {printf "%s", lines[NR]; for (i = 1; i < NR; i++) printf " %s", lines[i]}'
}
PUBLIC_PENDING=0
# Each failed check prints its line now and is kept, so an automatic rollback can repeat it at the end.
SMOKE_FAILS=()
bad() { echo "deploy: smoke: $*" >&2; SMOKE_FAILS+=("$*"); ok=0; } # ok: smoke's own variable
# Recreated containers get new addresses (Docker may even give an old one to another container), and nginx re-resolves
# its upstreams only every 10 s (resolver valid=10s): right after a switch it can still send requests to the old ones and
# answer 502. Found by the rehearsal. Wait until the internal listener answers three rounds in a row, then judge.
settle() {
  local end=$((SECONDS + SETTLE)) good=0 ready home
  while [ "$good" -lt 3 ]; do
    ready=$(inner /api/ready)
    home=$(inner /)
    if [ "$ready" = '200 {"status":"ready"}' ] && [ "${home%% *}" = 200 ]; then good=$((good + 1)); else good=0; fi
    [ "$good" -ge 3 ] && break
    [ "$SECONDS" -lt "$end" ] || break # the checks below report what is still wrong
    sleep 2
  done
}
smoke() { # smoke <tag>
  local tag=$1 ok=1 out cid line want
  settle
  out=$(inner /api/ready); [ "$out" = '200 {"status":"ready"}' ] || bad "/api/ready through the internal listener: ${out%% *}"
  out=$(inner /api/health); [ "${out%% *}" = 200 ] || bad "/api/health through the internal listener: ${out%% *}"
  out=$(inner /); [ "${out%% *}" = 200 ] || bad "the home page through the internal listener: ${out%% *}"

  local public
  public="$(cfg DEPLOY_PUBLIC_URL "$(envval APP_URL)")"
  PUBLIC_PENDING=0
  if grep -q '^maintenance: on' <<< "$(scripts/maintenance.sh status)"; then
    PUBLIC_PENDING=1
    out=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$public/healthz")
    [ "$out" = 200 ] || bad "public /healthz during maintenance: $out"
    out=$(curl -s -m 10 -w ' %{http_code}' "$public/api/ready")
    [[ "$out" == *'"code":"MAINTENANCE"'*' 503' ]] || bad "public /api/ready during maintenance is not the MAINTENANCE answer"
    say "smoke: maintenance is on: the public app check waits for maintenance off (scripts/maintenance.sh off, then scripts/healthcheck.sh $public)"
  else
    scripts/healthcheck.sh "$public" || bad "the public healthcheck ($public)"
  fi

  # Every API replica's PayStation boot line must match this .env (values compared, never printed).
  local pay_env label prefix
  pay_env=$(envval PAYSTATION_ENV)
  label=$(envval PAYSTATION_ACCOUNT_LABEL)
  prefix=$(envval PAYSTATION_INVOICE_PREFIX)
  for cid in $(dc ps -q api); do
    [ "$(docker inspect -f '{{.Config.Image}}' "$cid")" = "sirat-api:$tag" ] || bad "an api container does not run sirat-api:$tag"
    logs=$(docker logs "$cid" 2>&1 || true)
    line=$(grep -E 'PayStation (env=|disabled)' <<< "$logs" | sed -n 1p || true)
    if [ -n "$pay_env" ]; then
      for want in "env=$pay_env " "callback=https://" "ipn=https://"; do
        [[ "$line" == *"$want"* ]] || bad "an API's PayStation boot line does not match .env (${want%%=*})"
      done
      [ -z "$label" ] || [[ "$line" == *"account=$label "* ]] || bad "an API's PayStation account label does not match .env"
      [ -z "$prefix" ] || [[ "$line" == *"invoicePrefix=$prefix "* ]] || bad "an API's PayStation invoice prefix does not match .env"
    else
      [[ "$line" == *'PayStation disabled'* ]] || bad "PAYSTATION_ENV is blank but an API's boot line does not say disabled"
      grep -q 'payments are DISABLED' <<< "$logs" || bad "an API did not warn that payments are DISABLED"
      if registration_open; then bad "payments are disabled while registration_open is true"; fi
    fi
  done

  cid=$(container_of worker)
  [ -n "$cid" ] && [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid")" = healthy ] ||
    bad "the worker is not healthy"
  # Nothing pending and nothing failed. After a rollback the database may hold newer migrations than this release
  # knows ("missing from the local migrations directory"): expected, since migrations stay applied.
  out=$(dc_at "$tag" run --rm --no-deps migrate node_modules/.bin/prisma migrate status 2>&1 || true)
  if ! grep -q 'Database schema is up to date' <<< "$out" &&
    { grep -qiE 'not yet been applied|have failed|failed migration' <<< "$out" || ! grep -q 'missing from the local migrations directory' <<< "$out"; }; then
    tail -n 8 <<< "$out" >&2
    bad "prisma migrate status shows pending or failed migrations"
  fi
  [ "$ok" = 1 ]
}

# nginx sees the new files through its folder mount; a changed template or entrypoint hook needs a recreate.
nginx_follow() { # nginx_follow <from> <to>
  if [ -n "$1" ] && git diff --quiet "$1" "$2" -- infra/nginx; then return 0; fi
  if [ -z "$1" ] || ! git diff --quiet "$1" "$2" -- infra/nginx/sites infra/nginx/entrypoint; then
    dc up -d --no-deps --no-build --force-recreate nginx
  else
    dc exec -T nginx nginx -c /etc/nginx/sirat/nginx.conf -t -q && dc exec -T nginx nginx -c /etc/nginx/sirat/nginx.conf -s reload
  fi
}

switch_to() { # switch_to <tag>: the app containers on that release's images (no build)
  git checkout -q --detach "$1"
  dc_at "$1" up -d --no-deps --no-build --wait --wait-timeout "$WAIT" "${APPS[@]}"
}

# The last DEPLOY_KEEP_RELEASES releases keep their images; older tags that this script built are removed (never a
# volume, never `latest`, never a tag it did not record).
prune_images() {
  local keep tag repo
  # The newest first, each once, the first $KEEP of them (awk reads to the end: no early exit under pipefail).
  keep=$( (awk '$3 == "deployed" || $3 == "rolled-back-to" {print $2}' "$LOG_FILE"; release_val SIRAT_TAG; release_val SIRAT_PREVIOUS_TAG) |
    tac | awk -v k="$KEEP" 'NF && !seen[$0]++ && ++n <= k')
  while read -r tag; do
    grep -qx "$tag" <<< "$keep" && continue
    for repo in "${IMAGES[@]}"; do docker image rm -f "sirat-$repo:$tag" > /dev/null 2>&1 || true; done
  done < <(awk '$2 ~ /^[0-9a-f]{40}$/ {print $2}' "$LOG_FILE" | sort -u)
}

# ---- rollback by hand ----
if [ "$MODE" = rollback ]; then
  [ -n "$PREVIOUS" ] || fail "no previous release recorded in $RELEASE_FILE"
  for repo in "${IMAGES[@]}"; do
    docker image inspect "sirat-$repo:$PREVIOUS" > /dev/null 2>&1 || fail "the images of $PREVIOUS are gone (sirat-$repo): rebuild them with a deploy instead"
  done
  if exam_window_open; then say "WARNING: an exam window is open within 30 minutes: rolling back anyway (a rollback is the incident fix)"; fi
  say "rolling back from ${LIVE:-none} to $PREVIOUS (no build)"
  from=$(git rev-parse HEAD)
  switch_to "$PREVIOUS" || fail "the app containers of $PREVIOUS did not become healthy: see $(basename "$0") output and \$DC ps"
  # The containers run PREVIOUS now: the release file says so before the smoke, so it never names what is not running.
  before=$(awk -v t="$PREVIOUS" '($3 == "deployed" || $3 == "rolled-back-to") && $2 != t {p = $2} $2 == t && ($3 == "deployed" || $3 == "rolled-back-to") {exit} END {print p}' "$LOG_FILE")
  write_release "$PREVIOUS" "$before"
  record "$PREVIOUS" rolled-back-to
  nginx_follow "$from" "$PREVIOUS"
  smoke "$PREVIOUS" || fail "rolled back to $PREVIOUS (the release file says so), but its smoke failed: act now (RUNBOOK section 2)"
  say "ROLLED BACK to $PREVIOUS. Migrations stay applied: the database keeps the newer schema."
  [ "$PUBLIC_PENDING" = 0 ] || say "public check pending until maintenance is off"
  exit 0
fi

# ---- a release ----
[[ "$TARGET" =~ ^[0-9a-f]{7,40}$ ]] || fail "give a commit SHA (7 to 40 hex characters)"
if [ "$REHEARSAL" = 1 ]; then
  SHA=$(git rev-parse --verify -q "$TARGET^{commit}") || fail "unknown commit $TARGET"
  git merge-base --is-ancestor "$SHA" "$REHEARSAL_BRANCH" || fail "$TARGET is not on branch $REHEARSAL_BRANCH"
else
  git fetch -q origin main || fail "git fetch origin main failed"
  SHA=$(git rev-parse --verify -q "$TARGET^{commit}") || fail "unknown commit $TARGET"
  git merge-base --is-ancestor "$SHA" origin/main || fail "$TARGET is not on origin/main: deploy only what main has"
  [ -n "$TOKEN" ] || fail "the CI check needs DEPLOY_GITHUB_TOKEN (read-only) in $CONFIG"
  conclusion=$(curl -fsS -m 20 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/actions/workflows/ci.yml/runs?head_sha=$SHA&branch=main&event=push&per_page=5" |
    jq -r --arg sha "$SHA" '[.workflow_runs[] | select(.head_sha == $sha)][0].conclusion // "none"') ||
    fail "could not read the CI result from GitHub"
  [ "$conclusion" = success ] || fail "CI on main for $SHA is '$conclusion': deploy only a commit whose CI run passed"
fi
[ "$SHA" != "$LIVE" ] || fail "$SHA is already the live release"
if exam_window_open; then fail "an exam window is open within 30 minutes: no deploy (RULEBOOK; a critical fix goes through the owner)"; fi
say "deploying $SHA over ${LIVE:-nothing yet} (project $PROJECT)"
record "$SHA" started

back_to_live() { [ -n "$LIVE" ] && git checkout -q --detach "$LIVE" || true; }
git checkout -q --detach "$SHA"
data_unchanged || { back_to_live; record "$SHA" refused; exit 1; }

say "building sirat-{${IMAGES[*]// /,}}:$SHA while the live release serves"
dc_at "$SHA" build "${IMAGES[@]}" || { back_to_live; record "$SHA" build-failed; fail "build failed: nothing changed"; }

if [ -z "$LIVE" ]; then
  say "first release: no backup (no data yet)"
elif ! git diff --quiet "$LIVE" "$SHA" -- apps/api/prisma/migrations; then
  say "the release adds migrations: a backup first"
  bash -c "$BACKUP_CMD" || { back_to_live; record "$SHA" backup-failed; fail "the backup failed: no migration ran, the live release keeps serving"; }
fi

say "migrate (the live API keeps serving)"
if ! out=$(dc_at "$SHA" run --rm --no-deps migrate 2>&1) || ! grep -q 'config seed done' <<< "$out"; then
  printf '%s\n' "$out" | tail -n 25 >&2
  back_to_live
  record "$SHA" migrate-failed
  fail "migrate failed: the live API keeps serving; RUNBOOK section 2, Migration failed"
fi

rollback_after_switch() { # rollback_after_switch <why>
  # Kept before the rollback's own output buries them: the failed checks and the app containers' states.
  local why=$1 failed=("${SMOKE_FAILS[@]}") state
  state=$(dc ps -a --format '{{.Service}} {{.State}} {{.Health}}' "${APPS[@]}" 2> /dev/null || true)
  explain() {
    local f
    echo "deploy: why $SHA failed: $why" >&2
    for f in "${failed[@]}"; do echo "deploy:   - $f" >&2; done
    [ -z "$state" ] || while IFS= read -r f; do echo "deploy:   app container: $f" >&2; done <<< "$state"
  }
  echo "deploy: FAILED after the switch ($why): rolling back to ${LIVE:-nothing}" >&2
  record "$SHA" failed
  if [ -z "$LIVE" ]; then
    scripts/maintenance.sh on > /dev/null
    explain
    fail "the first release failed: maintenance is ON; fix it and deploy again"
  fi
  local started=$SECONDS
  if switch_to "$LIVE" && nginx_follow "$SHA" "$LIVE" && smoke "$LIVE"; then
    record "$LIVE" rolled-back-to
    echo "deploy: ROLLED BACK to $LIVE in $((SECONDS - started)) s." >&2
  else
    echo "deploy: THE ROLLBACK TO $LIVE ALSO FAILED: act now (RUNBOOK section 2)" >&2
  fi
  echo "deploy: !!! MIGRATIONS STAY APPLIED: the database keeps $SHA's migrations; $LIVE runs on that schema !!!" >&2
  explain
  exit 1
}

say "starting the app containers on $SHA"
dc_at "$SHA" up -d --no-deps --no-build --wait --wait-timeout "$WAIT" "${APPS[@]}" || rollback_after_switch "a container did not become healthy"
nginx_follow "$LIVE" "$SHA" || rollback_after_switch "nginx did not take the new configuration"
smoke "$SHA" || rollback_after_switch "smoke"

write_release "$SHA" "$LIVE"
record "$SHA" deployed
prune_images
say "DEPLOYED $SHA (previous: ${LIVE:-none})"
[ "$PUBLIC_PENDING" = 0 ] || say "public check pending until maintenance is off"

#!/usr/bin/env bash
# The pre-launch checks (L12, LAUNCH-PLAN section 7; RUNBOOK section 9), as the deploy user from the clone. Each line is
# PASS, FAIL, N/A (a VPS-only check with --local) or MANUAL (a person checks it); never a value. Exit 1 on any FAIL.
#
#   scripts/prelaunch-check.sh [--local] [--registration open|closed]
#
#   --local         marks the checks that only make sense on the VPS N/A (the live merchant, SES, off-server backups,
#                   real client IPs through Cloudflare, time sync, swap), so it also runs in the rehearsal and in CI
#   --registration  what `registration_open` must be (default: closed; the owner opens registration after the
#                   go/no-go through the audited admin setting)
#
# The project, compose files, release directory and public URL come from .env.deploy (scripts/deploy.sh's settings).
# The single-quoted checks run in a child shell or in the postgres container, which expand them.
# shellcheck disable=SC2016
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

LOCAL=0
REGISTRATION=closed
while [ "$#" -gt 0 ]; do
  case "$1" in
    --local) LOCAL=1 ;;
    --registration)
      REGISTRATION="${2:-}"
      shift
      ;;
    *)
      echo "usage: scripts/prelaunch-check.sh [--local] [--registration open|closed]" >&2
      exit 2
      ;;
  esac
  shift
done
case "$REGISTRATION" in open | closed) ;; *) echo "prelaunch-check: --registration is open or closed" >&2; exit 2 ;; esac

FAILS=0
pass() { echo "PASS    $1"; }
fail() { echo "FAIL    $1"; FAILS=$((FAILS + 1)); }
na() { echo "N/A     $1 (on the VPS only)"; }
manual() { echo "MANUAL  $1"; }
check() { local what=$1; shift; if "$@" > /dev/null 2>&1; then pass "$what"; else fail "$what"; fi; }
vps() { local what=$1; shift; if [ "$LOCAL" = 1 ]; then na "$what"; else check "$what" "$@"; fi; }

# ---- settings (read, never printed) ----
declare -A CFG=()
if [ -f .env.deploy ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || continue
    value="${BASH_REMATCH[2]}"
    value="${value%\"}"
    CFG["${BASH_REMATCH[1]}"]="${value#\"}"
  done < .env.deploy
fi
cfg() { printf '%s' "${CFG[$1]:-${2:-}}"; }
envval() {
  local v
  v=$(grep -E "^$1=" .env 2> /dev/null | tail -n 1 | cut -d= -f2-)
  v="${v%\"}"
  printf '%s' "${v#\"}"
}
PROJECT="$(cfg DEPLOY_PROJECT sirat)"
STATE="$(cfg DEPLOY_RELEASE_DIR /var/lib/sirat)"
PUBLIC="$(cfg DEPLOY_PUBLIC_URL "$(envval APP_URL)")"
read -r -a FILES <<< "$(cfg DEPLOY_COMPOSE_FILES infra/docker-compose.yml)"
DC=(docker compose -p "$PROJECT" --env-file "$ROOT/.env")
[ -f "$STATE/release.env" ] && DC+=(--env-file "$STATE/release.env")
for f in "${FILES[@]}"; do DC+=(-f "$ROOT/$f"); done
dc() { "${DC[@]}" "$@"; }
TAG=$(sed -n 's/^SIRAT_TAG=//p' "$STATE/release.env" 2> /dev/null)
pg() { dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAX -v ON_ERROR_STOP=1 -c "$1"' sh "$1" 2> /dev/null; }
containers() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" "$@"; }
service_ids() { containers --filter "label=com.docker.compose.service=$1"; }

echo "prelaunch-check: project $PROJECT$([ "$LOCAL" = 1 ] && echo ', --local')"

# ---- the host and its settings ----
only_nginx_publishes() {
  local c name ports
  for c in $(containers); do
    name=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$c")
    ports=$(docker inspect -f '{{range $p, $b := .NetworkSettings.Ports}}{{if $b}}{{$p}} {{end}}{{end}}' "$c")
    [ -z "$ports" ] || [ "$name" = nginx ] || return 1
  done
}
check "only nginx publishes ports" only_nginx_publishes
check ".env is mode 600" test "$(stat -c '%a' .env 2> /dev/null)" = 600
check "APP_URL is https" bash -c '[[ "$1" == https://* ]]' _ "$(envval APP_URL)"
check "COOKIE_SECURE is not false" test "$(envval COOKIE_SECURE)" != false
check "the API connects as a runtime role, not the database owner" bash -c \
  '[ -n "$1" ] && [ "$1" != "$2" ]' _ "$(envval DATABASE_URL | sed -n 's|^postgresql://\([^:@]*\).*|\1|p')" "$(envval POSTGRES_USER)"
# Admin two-factor login (RUNBOOK section 22): the API refuses to boot in production without the key, and every
# enrolled admin's secret is sealed with it. The format only (as the API parses it); the value is never printed.
totp_key_ok() { [[ "$(envval TOTP_ENCRYPTION_KEY)" =~ ^([0-9a-fA-F]{64}|[A-Za-z0-9+/_-]{43}=?)$ ]]; }
check "TOTP_ENCRYPTION_KEY is set: 32 random bytes, base64 or 64 hex (admin 2FA)" totp_key_ok
check "no development marker on Postgres" test -z "$(pg "select coalesce(current_setting('sirat.environment', true), '')")"
check "no Mailpit in the project" test -z "$(service_ids mailpit)"

# ---- the release ----
check "a release is recorded" test -n "$TAG"
on_release() {
  local s c
  [ -n "$TAG" ] || return 1
  for s in api worker web; do
    [ -n "$(service_ids "$s")" ] || return 1
    for c in $(service_ids "$s"); do [ "$(docker inspect -f '{{.Config.Image}}' "$c")" = "sirat-$s:$TAG" ] || return 1; done
  done
}
check "every app container runs the recorded release" on_release
check "migrations are up to date" bash -c 'grep -q "Database schema is up to date" <<< "$("$@" run --rm --no-deps migrate node_modules/.bin/prisma migrate status 2>&1)"' _ "${DC[@]}"
check "the worker is healthy" test "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$(service_ids worker | sed -n 1p)" 2> /dev/null)" = healthy

# Each API replica's PayStation boot line, compared with .env (values never printed).
paystation_live() {
  local c line
  [ -n "$(service_ids api)" ] || return 1
  for c in $(service_ids api); do
    line=$(grep -E 'PayStation (env=|disabled)' <<< "$(docker logs "$c" 2>&1)" | sed -n 1p)
    [[ "$line" == *"env=live "* && "$line" == *"callback=https://"* && "$line" == *"ipn=https://"* ]] || return 1
    [[ "$line" == *"account=$(envval PAYSTATION_ACCOUNT_LABEL) "* && "$line" == *"invoicePrefix=$(envval PAYSTATION_INVOICE_PREFIX) "* ]] || return 1
    ! grep -q 'payments are DISABLED' <<< "$(docker logs "$c" 2>&1)" || return 1
  done
}
vps "every API's PayStation boot line: live, the client's account and prefix, https callback and IPN" paystation_live
# Each API replica's boot line: admin two-factor login is enforced (two-factor.config.ts).
two_factor_on() {
  local c
  [ -n "$(service_ids api)" ] || return 1
  for c in $(service_ids api); do
    grep -q 'two-factor=on' <<< "$(docker logs "$c" 2>&1)" || return 1
  done
}
check "every API logs two-factor=on (admin 2FA enforced)" two_factor_on
manual "paystation:selfcheck exits 0 on the VPS (RUNBOOK section 9)"

# ---- a clean production database ----
check "no fixture users" test "$(pg "select count(*) from users where email like '%@fixtures.invalid'")" = 0
check "no test invoices (all carry the .env invoice prefix)" test "$(pg "select count(*) from payments where invoice_number not like '$(envval PAYSTATION_INVOICE_PREFIX | tr -cd 'A-Z0-9')%'")" = 0
check "no published exam yet" test "$(pg "select count(*) from exams where status = 'published'")" = 0
check "the registration fee is 400 BDT (40000 paisa)" test "$(pg "select value::text from settings where key = 'registration_fee_minor'")" = 40000
want=false
[ "$REGISTRATION" = open ] && want=true
check "registration_open is $want" test "$(pg "select value::text from settings where key = 'registration_open'")" = "$want"

# ---- backups, email, the page, the edge ----
backup_fresh() {
  local created
  created=$(sed -n 's/^created_at=//p' "$STATE/last-backup" 2> /dev/null)
  [ -n "$created" ] && [ $(($(date -u +%s) - $(date -u -d "$created" +%s))) -le $((26 * 3600)) ]
}
vps "the newest off-server backup is under 26 h old" backup_fresh
vps "email goes through SES (EMAIL_PROVIDER=ses)" test "$(envval EMAIL_PROVIDER)" = ses
check "the page CSP is sent" bash -c 'grep -qiE "^content-security-policy(-report-only)?:" <<< "$(curl -s -m 10 -o /dev/null -D - "$1/")"' _ "$PUBLIC"

# Access-log lines of the last hour that came through a Cloudflare edge must show a real client address: not the
# edge, and not a Docker, private, loopback or Pseudo IPv4 (240.0.0.0/4) address. The monitors make some such lines.
real_client_ips() {
  local since lines
  since=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M)
  lines=$(dc logs --no-log-prefix --since 1h nginx 2> /dev/null | awk -v s="$since" '$1 >= s && $3 ~ /^edge=/' |
    awk '{sub("edge=", "", $3); print $2, $3}' | awk '$1 != $2')
  [ -n "$lines" ] || return 1
  ! grep -qE '^(10\.|127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|24[0-9]\.|25[0-5]\.)' <<< "$lines"
}
vps "real client IPs in the access log (through Cloudflare)" real_client_ips
cf_list_fresh() {
  local d
  d=$(sed -n 's/.*Generated \([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\).*/\1/p' infra/nginx/cloudflare-realip.conf | sed -n 1p)
  [ -n "$d" ] && [ $(($(date -u +%s) - $(date -u -d "$d" +%s))) -le $((90 * 86400)) ]
}
check "the Cloudflare IP list is under 90 days old (RUNBOOK section 10)" cf_list_fresh
# A2's trusted load-test generators: nginx takes any client address from them while a loadtest-realip*.conf exists, and
# nothing removes it at its expiry. A k6 run ends with `scripts/loadtest-generators.sh off`; none may be on at launch.
check "no trusted load-test generators (scripts/loadtest-generators.sh off)" \
  test -z "$(bash scripts/loadtest-generators-left.sh)"

# ---- the host ----
disk_ok() {
  local p used
  for p in / "$(docker info --format '{{.DockerRootDir}}' 2> /dev/null || echo /)"; do
    used=$(df -P "$p" | awk 'NR == 2 {gsub("%", "", $5); print $5}')
    [ "${used:-100}" -lt 80 ] || return 1
  done
}
check "disk under 80% used" disk_ok
vps "swap is on" test -n "$(swapon --show --noheadings 2> /dev/null)"
vps "the clock is synchronised" test "$(timedatectl show -p NTPSynchronized --value 2> /dev/null)" = yes

for m in "Cloudflare: SSL Full (strict), the settings in RUNBOOK section 15" \
  "an outside port scan shows only 22, 80 and 443" \
  "a fake alert was received (RUNBOOK section 7)" \
  "the last restore drill passed" \
  "the contacts in RUNBOOK section 8 are filled in"; do
  manual "$m"
done

echo "prelaunch-check: $FAILS failed"
[ "$FAILS" = 0 ]

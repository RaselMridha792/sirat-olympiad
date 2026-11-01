#!/usr/bin/env bash
# The load-test staging stack on the VPS (E6's kit; RULEBOOK §13, LAUNCH-PLAN L14; RUNBOOK section 19). Project
# sirat-staging, from the deployed release's images (never a build), with its own volumes, throwaway settings and
# payments on the fake. Never project sirat, never the production database or its secrets. Run from the clone.
#
#   scripts/load-staging.sh up [--tag <sha>] [--users N]       the stack, migrations, N load students (default 2000)
#   scripts/load-staging.sh up --registration [--tag <sha>]    the same with payments' fake PayStation and
#                                                              registration open, for the registration surge
#   scripts/load-staging.sh exam [--questions 30] [--duration 30] [--window-end-in 60]   a new published exam
#   scripts/load-staging.sh report <examId>                    attempts, submissions, overdue attempts, writes
#   scripts/load-staging.sh k6 exam|registration [k6 options]  k6 in a container on staging's network
#   sudo scripts/load-staging.sh window --ips <ip>[,<ip>...] [--minutes 90] [--no-trusted]
#                       lets only those addresses (at most 4) reach STAGING_PORT (default 8088) while it runs in the
#                       foreground, and trusts their CF-Connecting-IP (A2's scripts/loadtest-generators.sh); it closes
#                       on Ctrl-C, on a lost session, on any error and when the minutes are over; a systemd timer
#                       closes it too if this script is killed
#   sudo scripts/load-staging.sh close                         removes the allow-list now (the timer runs it too)
#   scripts/load-staging.sh status                             the stack, the allow-list (as root) and its timer
#   scripts/load-staging.sh down                               the stack and its data, removed (refused while open)
#   --dry-run, before the command: prints every command that would change something, runs none of them (CI)
#
# The generator machines run k6 with the settings in $STAGING_DIR/k6.env (the throwaway load password, the address
# and the exam id; mode 600): loadtests/README.md, "On the VPS".
set -euo pipefail
cd "$(dirname "$0")/.."

P=sirat-staging
STAGING_DIR=${STAGING_DIR:-/var/lib/sirat/staging}
RELEASE_FILE=${RELEASE_FILE:-/var/lib/sirat/release.env}
STAGING_PORT=${STAGING_PORT:-8088}
TIMER=sirat-staging-close
MARK=sirat-staging-allow
export STAGING_PORT

fail() { echo "load-staging: $*" >&2; exit 1; }
say() { echo "load-staging: $*"; }
DRY=0
if [ "${1:-}" = --dry-run ]; then DRY=1; shift; fi
# Every command that changes something goes through run: in a dry run it is only printed.
run() {
  if [ "$DRY" = 1 ]; then printf '+'; printf ' %q' "$@"; printf '\n'; else "$@"; fi
}
[ "$P" != sirat ] || fail "never project sirat"
hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
is_root() { [ "$(id -u)" = 0 ]; }

STAGING_ENV_FILE="$STAGING_DIR/staging.env"
export STAGING_ENV_FILE
FAKE_COMPOSE=infra/fake-paystation.compose.yml
DC=(docker compose -p "$P" --env-file "$STAGING_ENV_FILE" --env-file "$STAGING_DIR/release.env"
  -f infra/docker-compose.yml -f loadtests/staging.compose.yml)
# A registration staging (up --registration) adds payments' fake PayStation; the file remembers it for later commands.
registration_mode() { [ -f "$STAGING_DIR/registration" ]; }
if registration_mode; then DC+=(-f "$FAKE_COMPOSE"); fi
dc() { run "${DC[@]}" "$@"; }
K6_IMAGE=grafana/k6:1.0.0
project_containers() { docker ps -aq --filter "label=com.docker.compose.project=$P"; }
envval() { sed -n "s/^$1=//p" "$2" | tail -n 1; }

# ---- the firewall: DOCKER-USER rules marked with a comment, one per address ----
ext_if() { ip -4 route show default | awk 'NR == 1 { print $5 }'; }
rules() { iptables -S DOCKER-USER 2> /dev/null | grep -F -- "--comment $MARK" || true; }
close_rules() {
  local rule
  while read -r rule; do
    [ -n "$rule" ] || continue
    # "-A DOCKER-USER ..." becomes "-D DOCKER-USER ..."; the words are iptables' own output, never user text.
    # shellcheck disable=SC2086
    run iptables -D ${rule#-A } || echo "load-staging: could not remove: $rule" >&2
  done <<< "$(rules)"
  run systemctl stop "$TIMER.timer" > /dev/null 2>&1 || true
}
# A2's trusted-generator switch runs as the clone's owner (deploy), never as root.
as_owner() {
  local owner
  owner=$(stat -c %U . 2> /dev/null || echo deploy)
  if is_root && [ "$owner" != root ]; then runuser -u "$owner" -- "$@"; else "$@"; fi
}
staging_nginx_reload() {
  [ "$DRY" = 1 ] || { [ -f "$STAGING_ENV_FILE" ] && [ -n "$(project_containers)" ]; } || return 0
  dc exec -T nginx nginx -c /etc/nginx/sirat/nginx.conf -t > /dev/null 2>&1 &&
    dc exec -T nginx nginx -c /etc/nginx/sirat/nginx.conf -s reload > /dev/null 2>&1 ||
    echo "load-staging: staging's nginx did not reload" >&2
}
trusted_off() {
  [ -x scripts/loadtest-generators.sh ] || [ "$DRY" = 1 ] || return 0
  run as_owner scripts/loadtest-generators.sh off > /dev/null || echo "load-staging: the trusted generators did not switch off" >&2
  staging_nginx_reload
}
valid_ip() {
  local a b c d
  [[ $1 =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  a=${BASH_REMATCH[1]} b=${BASH_REMATCH[2]} c=${BASH_REMATCH[3]} d=${BASH_REMATCH[4]}
  for n in "$a" "$b" "$c" "$d"; do [ "$n" -le 255 ] || return 1; done
  # Not a network, a private or loopback range, or everyone: single public generator addresses only.
  [ "$a" != 0 ] && [ "$a" != 10 ] && [ "$a" != 127 ] && [ "$a" -lt 224 ] || return 1
  ! { [ "$a" = 192 ] && [ "$b" = 168 ]; } && ! { [ "$a" = 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ]; }
}

# ---- the load fixtures, in a container that shares staging Postgres's network: 127.0.0.1 there is that server ----
fixtures() {
  local tag pg
  tag=${TAG:-$(envval SIRAT_TAG "$STAGING_DIR/release.env" 2> /dev/null || true)}
  [ -n "$tag" ] || [ "$DRY" = 1 ] || fail "staging is not up (no release file in $STAGING_DIR)"
  pg=$(docker ps -q --filter "label=com.docker.compose.project=$P" --filter "label=com.docker.compose.service=postgres")
  [ "$DRY" = 1 ] || [ -n "$pg" ] || fail "staging Postgres is not running (up first)"
  run docker run --rm --network "container:${pg:-<postgres>}" --env-file "$STAGING_DIR/fixtures.env" \
    -v "$PWD/apps/api/prisma/fixtures:/repo/apps/api/prisma/fixtures:ro" \
    -v "$PWD/apps/api/src:/repo/apps/api/src:ro" \
    "sirat-migrate:$tag" node_modules/.bin/tsx prisma/fixtures/loadtest-fixtures.ts "$@"
}

int_arg() { # int_arg <name> <value> <min> <max>
  [[ $2 =~ ^[0-9]+$ ]] && [ "$2" -ge "$3" ] && [ "$2" -le "$4" ] || fail "$1 must be a whole number from $3 to $4"
  printf '%s' "$2"
}

cmd=${1:-}
[ -n "$cmd" ] || { sed -n '2,/^set -euo/{/^#/p}' "$0"; exit 2; }
shift

case "$cmd" in
  up)
    tag='' users='' registration=0
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --tag) tag=${2:-}; shift ;;
        --users) users=$(int_arg --users "${2:-}" 0 20000); shift ;;
        --registration) registration=1 ;;
        *) fail "unknown option $1" ;;
      esac
      shift
    done
    # The registration surge needs no load students (it registers its own); the exam simulation does.
    [ -n "$users" ] || users=$([ "$registration" = 1 ] && echo 0 || echo 2000)
    if [ "$registration" = 1 ]; then
      [ -f "$FAKE_COMPOSE" ] || fail "$FAKE_COMPOSE is missing (payments' fake PayStation)"
      DC+=(-f "$FAKE_COMPOSE")
    fi
    [ -n "$tag" ] || tag=$(envval SIRAT_TAG "$RELEASE_FILE" 2> /dev/null || true)
    [[ $tag =~ ^[A-Za-z0-9._-]{1,64}$ ]] || fail "no release tag: give --tag or deploy first ($RELEASE_FILE)"
    TAG=$tag
    if [ "$DRY" = 0 ]; then
      [ -z "$(project_containers)" ] || fail "project $P exists: scripts/load-staging.sh down first"
      for s in migrate api worker web; do
        docker image inspect "sirat-$s:$tag" > /dev/null 2>&1 || fail "image sirat-$s:$tag is missing (the drill never builds; deploy that release first)"
      done
      # Without the guard, the staging port would be open to everyone from the start.
      systemctl is-active --quiet sirat-docker-user || fail "the DOCKER-USER guard (sirat-docker-user) is not active"
    fi
    say "project $P from sirat-*:$tag, $users load students; settings in $STAGING_DIR (mode 700)"
    run install -d -m 700 "$STAGING_DIR"
    pw=$(hex 24)
    fixture_pw=$(hex 16)
    # The exam simulation runs in production mode (Secure cookies; k6 keeps them itself). The registration surge runs
    # in development mode (payments' fake requires it) with payments' k6 script, whose cookie jar does not send Secure
    # cookies over plain http: its resume cookie must not be Secure. The API refuses that in production.
    secure=$([ "$registration" = 1 ] && echo false || echo true)
    if [ "$DRY" = 0 ]; then
      umask 077
      sed -e "s|^APP_URL=.*|APP_URL=http://localhost:$STAGING_PORT|" -e "s|change-me-fake|$pw|g" \
        -e "s|^COOKIE_SECURE=.*|COOKIE_SECURE=$secure|" \
        -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pw|" -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(hex 32)|" \
        -e "s|^POSTGRES_APP_PASSWORD=.*|POSTGRES_APP_PASSWORD=$(hex 32)|" -e "s|^EMAIL_PROVIDER=.*|EMAIL_PROVIDER=mailpit|" \
        -e "s|^EMAIL_FROM=.*|EMAIL_FROM=Sirat staging <no-reply@staging.invalid>|" -e "s|^PAYSTATION_ENV=.*|PAYSTATION_ENV=|" \
        -e "s|^SECURITY_ALERT_EMAIL=.*|SECURITY_ALERT_EMAIL=|" .env.example > "$STAGING_ENV_FILE"
      grep -q '^POSTGRES_APP_PASSWORD=' "$STAGING_ENV_FILE" || printf 'POSTGRES_APP_PASSWORD=%s\n' "$(hex 32)" >> "$STAGING_ENV_FILE"
      grep -q '^COOKIE_SECURE=' "$STAGING_ENV_FILE" || printf 'COOKIE_SECURE=%s\n' "$secure" >> "$STAGING_ENV_FILE"
      printf 'MAILPIT_URL=http://127.0.0.1:9\n' >> "$STAGING_ENV_FILE"
      printf 'SIRAT_TAG=%s\n' "$tag" > "$STAGING_DIR/release.env"
      printf 'NODE_ENV=test\nALLOW_DEV_FIXTURES=yes-this-is-not-production\nFIXTURE_PASSWORD=%s\nDATABASE_URL=postgresql://%s:%s@127.0.0.1:5432/%s\n' \
        "$fixture_pw" "$(envval POSTGRES_USER "$STAGING_ENV_FILE")" "$pw" "$(envval POSTGRES_DB "$STAGING_ENV_FILE")" \
        > "$STAGING_DIR/fixtures.env"
      addr=$(ip -4 -o addr show dev "$(ext_if)" 2> /dev/null | awk '{ split($4, a, "/"); print a[1] }' || true)
      printf 'PASSWORD=%s\nBASE_URL=http://%s:%s\n' "$fixture_pw" "${addr:-<this server>}" "$STAGING_PORT" \
        > "$STAGING_DIR/k6.env"
      umask 022
    fi
    unset pw fixture_pw
    dc up -d --no-build --wait postgres pgbouncer redis-cache redis-queue
    dc run --rm --no-deps -T migrate
    if [ "$users" -gt 0 ]; then fixtures --users "$users"; fi
    if [ "$registration" = 1 ]; then
      run touch "$STAGING_DIR/registration"
      # The fake is test code, never in a release image: its own small image, built here (payments' compose file).
      dc build fake-paystation
      # In staging's database only: registration open, as the surge needs it.
      # shellcheck disable=SC2016
      dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$1"' sh \
        "UPDATE settings SET value = 'true'::jsonb WHERE key = 'registration_open'"
      dc up -d --no-build --wait api worker web nginx fake-paystation
      say "up for the registration surge: payments on the fake; next: scripts/load-staging.sh k6 registration"
    else
      dc up -d --no-build --wait api worker web nginx
      say "up: nginx on port $STAGING_PORT, closed to the outside until 'sudo scripts/load-staging.sh window --ips ...'"
      say "next: scripts/load-staging.sh exam; the generators' settings are in $STAGING_DIR/k6.env"
    fi
    ;;

  exam)
    q=30 d=30 w=60
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --questions) q=$(int_arg --questions "${2:-}" 1 200); shift ;;
        --duration) d=$(int_arg --duration "${2:-}" 1 30); shift ;;
        --window-end-in) w=$(int_arg --window-end-in "${2:-}" 2 1440); shift ;;
        *) fail "unknown option $1" ;;
      esac
      shift
    done
    out=$(fixtures --exam --questions "$q" --duration "$d" --window-end-in "$w")
    echo "$out"
    id=$(sed -n 's/.*"examId":"\([0-9a-f-]*\)".*/\1/p' <<< "$out")
    if [ "$DRY" = 0 ]; then
      [ -n "$id" ] || fail "no exam id"
      sed -i '/^EXAM_ID=/d' "$STAGING_DIR/k6.env"
      printf 'EXAM_ID=%s\n' "$id" >> "$STAGING_DIR/k6.env"
    fi
    ;;

  report)
    [[ ${1:-} =~ ^[0-9a-f-]{36}$ ]] || fail "report needs the exam id"
    fixtures --report "$1"
    ;;

  k6)
    # k6 in a container on staging's own network. The registration surge must run here: the payer opens the fake's
    # checkout at http://fake-paystation:18090 and comes back through http://nginx. For the exam simulation this is a
    # quick check only (straight to the API replicas); the real run comes from other machines through the window.
    name=${1:-}
    [ "$#" = 0 ] || shift
    case "$name" in
      registration)
        registration_mode || fail "the registration surge needs 'up --registration'"
        script=registration-surge.js base=http://nginx ;;
      exam) script=exam-simulation.js base=http://api:4000 ;;
      *) fail "k6 exam|registration [k6 options, e.g. -e RATE=4]" ;;
    esac
    [ "$DRY" = 1 ] || [ -n "$(project_containers)" ] || fail "staging is not up"
    run docker run --rm --name "$P-k6" --network "${P}_default" -v "$PWD/loadtests:/scripts:ro" \
      --env-file "$STAGING_DIR/k6.env" "$K6_IMAGE" run -e "BASE_URL=$base" "$@" "/scripts/$script"
    ;;

  window)
    is_root || [ "$DRY" = 1 ] || fail "window changes the firewall: run it with sudo"
    ips='' minutes=90 trusted=1
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --ips) ips=${2:-}; shift ;;
        --minutes) minutes=$(int_arg --minutes "${2:-}" 1 240); shift ;;
        --no-trusted) trusted=0 ;;
        *) fail "unknown option $1" ;;
      esac
      shift
    done
    [ -n "$ips" ] || fail "window needs --ips <ip>[,<ip>...]: the generator machines' public addresses"
    IFS=, read -r -a list <<< "$ips"
    [ "${#list[@]}" -le 4 ] || fail "at most 4 generator addresses (as scripts/loadtest-generators.sh)"
    for ip in "${list[@]}"; do valid_ip "$ip" || fail "not a single public IPv4 address: '$ip'"; done
    ext=$(ext_if)
    [ -n "$ext" ] || fail "no default route: cannot tell the outside interface"
    if [ "$DRY" = 0 ]; then
      guard=$(iptables -S DOCKER-USER 2> /dev/null || true)
      grep -qF -- "-i $ext -j DROP" <<< "$guard" || fail "the DOCKER-USER guard is not in place"
      [ -z "$(rules)" ] || fail "an allow-list is already open (status, or close first)"
      command -v systemd-run > /dev/null || fail "systemd-run is missing: no expiry timer, so no window"
      [ -n "$(project_containers)" ] || fail "staging is not up"
      [ "$trusted" = 0 ] || [ -x scripts/loadtest-generators.sh ] ||
        fail "scripts/loadtest-generators.sh is missing (A2's L14); --no-trusted runs without it (one client address per generator)"
    fi
    # The backstop first, so the window can never outlive its minutes even if this script is killed.
    run systemd-run --quiet --unit "$TIMER" --on-active="${minutes}m" --timer-property=AccuracySec=1s \
      "$PWD/scripts/load-staging.sh" close
    trap 'close_rules; trusted_off; say "closed"' EXIT
    trap 'exit 130' INT TERM HUP
    for ip in "${list[@]}"; do
      run iptables -I DOCKER-USER 1 -i "$ext" -s "$ip/32" -p tcp -m conntrack --ctorigdstport "$STAGING_PORT" \
        -m comment --comment "$MARK" -j RETURN
    done
    if [ "$trusted" = 1 ]; then
      # nginx takes CF-Connecting-IP as the client address only from these machines; staging's nginx reads the same
      # folder, so it is reloaded too.
      run as_owner scripts/loadtest-generators.sh on "$ips" --hours $(((minutes + 59) / 60))
      staging_nginx_reload
    fi
    say "open for ${list[*]} on port $STAGING_PORT for $minutes min (until $(date -d "+$minutes min" '+%H:%M %Z' 2> /dev/null || echo "$minutes min from now"))$([ "$trusted" = 1 ] && echo ', trusted generators on'); Ctrl-C closes it"
    if [ "$DRY" = 0 ]; then
      end=$((SECONDS + minutes * 60))
      # sleep in the background and wait for it: a signal then interrupts the wait at once, and the trap closes.
      while [ "$SECONDS" -lt "$end" ]; do
        sleep 5 &
        wait $! || true
      done
    fi
    ;;

  close)
    is_root || [ "$DRY" = 1 ] || fail "close changes the firewall: run it with sudo"
    close_rules
    trusted_off
    say "closed: $( [ -z "$(rules)" ] && echo 'no staging rule left' || echo 'RULES LEFT, see status')"
    [ -z "$(rules)" ] || exit 1
    ;;

  status)
    if [ -n "$(project_containers)" ]; then docker compose -p "$P" ps --format '{{.Service}} {{.State}} {{.Health}}' 2> /dev/null || true
    else echo "stack: not running"; fi
    if is_root; then
      r=$(rules)
      if [ -z "$r" ]; then echo "allow-list: closed"; else echo "allow-list: OPEN"; echo "$r"; fi
    else
      echo "allow-list: run with sudo to read the firewall"
    fi
    if systemctl is-active --quiet "$TIMER.timer" 2> /dev/null; then echo "expiry timer: active"; else echo "expiry timer: none"; fi
    if [ -x scripts/loadtest-generators.sh ]; then
      echo "trusted generators: $(as_owner scripts/loadtest-generators.sh status 2>&1 | tr '\n' ' ')"
    fi
    ;;

  down)
    if is_root; then
      close_rules
      trusted_off
    elif systemctl is-active --quiet "$TIMER.timer" 2> /dev/null; then
      fail "the allow-list may be open: sudo scripts/load-staging.sh close first"
    fi
    for c in $(project_containers); do
      [ "$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$c")" = "$P" ] || fail "label mismatch on $c"
    done
    # compose needs the settings file to read the project; it exists from the first step of up.
    if [ -f "$STAGING_ENV_FILE" ] || [ "$DRY" = 1 ]; then dc down -v --remove-orphans; fi
    # The fake's image was built here for this staging; no release image is ever removed.
    if registration_mode; then
      run docker image rm -f "sirat-fake-paystation:$(envval SIRAT_TAG "$STAGING_DIR/release.env")" > /dev/null 2>&1 || true
    fi
    run rm -rf "$STAGING_DIR"
    say "down: project $P and its data removed"
    ;;

  *) fail "unknown command '$cmd' (up, exam, report, window, close, status, down)" ;;
esac

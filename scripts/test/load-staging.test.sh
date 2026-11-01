#!/usr/bin/env bash
# scripts/load-staging.sh on faked commands (iptables, systemd-run, systemctl, ip, docker, runuser, id, stat and A2's
# loadtest-generators.sh): the firewall window opens only for the listed addresses, with its expiry timer, and closes on
# a signal, on an error inside it and by `close`; status tells open from closed; a dry run changes nothing; up writes
# the throwaway settings owner-only and prints no secret; never project sirat. No Docker and no root needed (CI's
# checks job). Usage: bash scripts/test/load-staging.test.sh
# The checks read their variables inside eval, which shellcheck cannot follow.
# shellcheck disable=SC2034
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo/scripts" "$T/repo/infra" "$T/repo/loadtests" "$T/bin" "$T/state"
cp "$SRC/scripts/load-staging.sh" "$T/repo/scripts/"
cp "$SRC/.env.example" "$T/repo/.env.example"
export STATE="$T/state" STAGING_DIR="$T/staging" RELEASE_FILE="$T/release.env"
printf 'SIRAT_TAG=abc123\n' > "$RELEASE_FILE"

fake() { printf '#!/usr/bin/env bash\n%s\n' "$2" > "$T/bin/$1"; chmod +x "$T/bin/$1"; }
fake id 'if [ "${1:-}" = -u ]; then echo "${FAKE_UID:-0}"; else exec /usr/bin/id "$@"; fi'
fake stat 'if [ "$*" = "-c %U ." ]; then echo deploy; else exec /usr/bin/stat "$@"; fi'
fake ip 'case "$*" in
  "-4 route show default") echo "default via 192.0.2.1 dev eth0" ;;
  "-4 -o addr show dev eth0") echo "2: eth0    inet 203.0.113.10/24 brd 203.0.113.255 scope global eth0" ;;
esac'
# iptables keeps DOCKER-USER in a file, one "-A DOCKER-USER ..." line per rule, as `iptables -S` prints them.
fake iptables 'f="$STATE/docker-user"; touch "$f"
echo "iptables $*" >> "$STATE/log"
case "$1" in
  -S) echo "-N DOCKER-USER"; cat "$f" ;;
  -I) shift 3; { echo "-A DOCKER-USER $*"; cat "$f"; } > "$f.new" && mv "$f.new" "$f" ;;
  -D) shift 2; want="-A DOCKER-USER $*"; grep -vxF -- "$want" "$f" > "$f.new"; mv "$f.new" "$f" ;;
esac'
fake systemd-run 'echo "systemd-run $*" >> "$STATE/log"; touch "$STATE/timer"'
fake systemctl 'echo "systemctl $*" >> "$STATE/log"
case "$*" in
  "is-active --quiet sirat-docker-user") exit 0 ;;
  "is-active --quiet sirat-staging-close.timer") [ -f "$STATE/timer" ] ;;
  "stop sirat-staging-close.timer") rm -f "$STATE/timer" ;;
esac'
fake runuser 'echo "runuser $*" >> "$STATE/log"; while [ "$1" != -- ]; do shift; done; shift; exec "$@"'
fake docker 'echo "docker $*" >> "$STATE/log"
case "$*" in
  "ps -aq --filter label=com.docker.compose.project=sirat-staging") [ -f "$STATE/up" ] && echo c0ffee ;;
  ps\ -q\ *service=postgres*) [ -f "$STATE/up" ] && echo pg0001 ;;
  inspect\ *) echo sirat-staging ;;
  "image inspect"*) exit 0 ;;
  compose\ *\ up\ *) touch "$STATE/up" ;;
  compose\ *\ down\ *) rm -f "$STATE/up" ;;
  run\ *--exam*) echo "{\"msg\":\"load exam\",\"examId\":\"01a19600-0000-7000-8000-000000000001\",\"windowEnd\":\"x\"}" ;;
esac
exit 0'
cat > "$T/repo/scripts/loadtest-generators.sh" << 'EOF'
#!/usr/bin/env bash
echo "generators $*" >> "$STATE/log"
case "$1" in
  on) [ "${FAIL_GENERATORS:-0}" = 1 ] && exit 1; echo "$2" > "$STATE/generators" ;;
  off) rm -f "$STATE/generators" ;;
  status) if [ -f "$STATE/generators" ]; then echo "on $(cat "$STATE/generators")"; else echo off; fi ;;
esac
EOF
chmod +x "$T/repo/scripts/loadtest-generators.sh"
export PATH="$T/bin:$PATH"

LS="$T/repo/scripts/load-staging.sh"
fails=0
ok() { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }
expect() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
staging_rules() { grep -c 'sirat-staging-allow' "$STATE/docker-user" 2> /dev/null || true; }
guard() { printf -- '-A DOCKER-USER -i eth0 -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN\n-A DOCKER-USER -i eth0 -j DROP\n-A DOCKER-USER -j RETURN\n' > "$STATE/docker-user"; }
reset() { rm -f "$STATE/log" "$STATE/timer" "$STATE/generators"; guard; }

echo "== up (as deploy)"
reset
out=$(FAKE_UID=1000 bash "$LS" up --users 50 2>&1); st=$?
expect "exits 0" '[ "$st" = 0 ]'
expect "it shows what the host runs now first (load average, memory)" 'grep -q "this host now: load average" <<< "$out" && grep -q "memory available" <<< "$out"'
expect "the settings directory is owner-only" '[ "$(stat -c %a "$STAGING_DIR")" = 700 ]'
for f in staging.env fixtures.env k6.env release.env; do
  expect "$f exists, mode 600 or tighter" '[ -f "$STAGING_DIR/$f" ] && [ "$(stat -c %a "$STAGING_DIR/$f")" -le 644 ]'
done
expect "staging.env and fixtures.env are 600" '[ "$(stat -c %a "$STAGING_DIR/staging.env")" = 600 ] && [ "$(stat -c %a "$STAGING_DIR/fixtures.env")" = 600 ]'
pw=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$STAGING_DIR/staging.env")
lpw=$(sed -n 's/^PASSWORD=//p' "$STAGING_DIR/k6.env")
expect "throwaway secrets were made" '[ "${#pw}" -ge 32 ] && [ "${#lpw}" -ge 16 ]'
expect "no secret in the output" '! grep -qF -- "$pw" <<< "$out" && ! grep -qF -- "$lpw" <<< "$out"'
expect "payments are off and the JWT secret is not the example's" 'grep -qx "PAYSTATION_ENV=" "$STAGING_DIR/staging.env" && ! grep -q "change-me" "$STAGING_DIR/staging.env"'
expect "production-mode cookies stay Secure for the exam simulation" 'grep -qx "COOKIE_SECURE=true" "$STAGING_DIR/staging.env"'
expect "the release tag is the deployed one" 'grep -qx "SIRAT_TAG=abc123" "$STAGING_DIR/release.env"'
expect "the generators get this server's address" 'grep -qx "BASE_URL=http://203.0.113.10:8088" "$STAGING_DIR/k6.env"'
expect "compose: project sirat-staging, the staging overlay, no build" 'grep -q "docker compose -p sirat-staging .*loadtests/staging.compose.yml up -d --no-build --wait api worker web nginx" "$STATE/log"'
expect "never project sirat" '! grep -qE -- "-p sirat( |$)" "$STATE/log"'
expect "the fixtures share staging Postgres's network" 'grep -q "docker run --rm --network container:pg0001 --env-file $STAGING_DIR/fixtures.env .*sirat-migrate:abc123 .*loadtest-fixtures.ts --users 50" "$STATE/log"'
out=$(FAKE_UID=1000 bash "$LS" up 2>&1); st=$?
expect "a second up is refused while the project exists" '[ "$st" = 1 ] && grep -q "exists" <<< "$out"'
out=$(FAKE_UID=1000 bash "$LS" exam --duration 30 2>&1)
expect "exam records the id for the generators" 'grep -qx "EXAM_ID=01a19600-0000-7000-8000-000000000001" "$STAGING_DIR/k6.env"'

echo "== window refusals"
reset
out=$(FAKE_UID=1000 bash "$LS" window --ips 203.0.113.5 2>&1); st=$?
expect "not as deploy" '[ "$st" = 1 ] && grep -q "run it as root" <<< "$out"'
for ips in 0.0.0.0 10.1.2.3 192.168.1.5 172.20.0.1 127.0.0.1 203.0.113.0/24 300.1.1.1 "203.0.113.5,a.b.c.d" "1.1.1.1,1.1.1.2,1.1.1.3,1.1.1.4,1.1.1.5"; do
  out=$(bash "$LS" window --ips "$ips" 2>&1); st=$?
  expect "refuses --ips $ips" '[ "$st" = 1 ] && [ "$(staging_rules)" = 0 ] && [ ! -f "$STATE/timer" ]'
done
printf -- '-A DOCKER-USER -j RETURN\n' > "$STATE/docker-user"
out=$(bash "$LS" window --ips 203.0.113.5 2>&1); st=$?
expect "refuses without the DOCKER-USER guard" '[ "$st" = 1 ] && grep -q guard <<< "$out" && [ ! -f "$STATE/timer" ]'

echo "== window opens, then a signal closes it"
reset
bash "$LS" window --ips 203.0.113.5,198.51.100.7 --minutes 30 > "$T/window.out" 2>&1 &
pid=$!
for _ in $(seq 50); do [ "$(staging_rules)" = 2 ] && [ -f "$STATE/generators" ] && break; sleep 0.2; done
expect "two rules, one per address, on the staging port only" '[ "$(staging_rules)" = 2 ] && grep -q -- "-s 203.0.113.5/32 -p tcp -m conntrack --ctorigdstport 8088" "$STATE/docker-user" && grep -q -- "-s 198.51.100.7/32" "$STATE/docker-user"'
expect "the rules sit above the guard's DROP" '[ "$(grep -n -- "-j DROP" "$STATE/docker-user" | cut -d: -f1)" -gt 2 ]'
expect "the expiry timer runs close after the minutes" 'grep -q "systemd-run --quiet --unit sirat-staging-close --on-active=30m .*load-staging.sh close" "$STATE/log"'
expect "A2's switch: on, as deploy, for the same addresses" 'grep -q "runuser -u deploy -- scripts/loadtest-generators.sh on 203.0.113.5,198.51.100.7 --hours 1" "$STATE/log"'
out=$(bash "$LS" status 2>&1)
expect "status says open" 'grep -q "allow-list: OPEN" <<< "$out" && grep -q "expiry timer: active" <<< "$out" && grep -q "trusted generators: on" <<< "$out"'
kill -TERM "$pid"; wait "$pid"
expect "SIGTERM closes every staging rule" '[ "$(staging_rules)" = 0 ]'
expect "the guard is untouched" 'grep -q -- "-i eth0 -j DROP" "$STATE/docker-user" && [ "$(wc -l < "$STATE/docker-user")" = 3 ]'
expect "the timer is stopped and the generators are off" '[ ! -f "$STATE/timer" ] && [ ! -f "$STATE/generators" ]'
out=$(bash "$LS" status 2>&1)
expect "status says closed" 'grep -q "allow-list: closed" <<< "$out" && grep -q "expiry timer: none" <<< "$out"'

echo "== a lost session (SIGHUP) closes it"
reset
bash "$LS" window --ips 203.0.113.5 --minutes 5 > /dev/null 2>&1 &
pid=$!
for _ in $(seq 50); do [ "$(staging_rules)" = 1 ] && break; sleep 0.2; done
kill -HUP "$pid"; wait "$pid"
expect "closed after SIGHUP" '[ "$(staging_rules)" = 0 ] && [ ! -f "$STATE/timer" ]'

echo "== an error inside the window closes it"
reset
FAIL_GENERATORS=1 bash "$LS" window --ips 203.0.113.5 --minutes 5 > /dev/null 2>&1
st=$?
expect "exits non-zero" '[ "$st" != 0 ]'
expect "and leaves no rule, no timer" '[ "$(staging_rules)" = 0 ] && [ ! -f "$STATE/timer" ]'

echo "== the expiry: the timer's close"
reset
bash "$LS" window --ips 203.0.113.5 --minutes 5 > /dev/null 2>&1 &
pid=$!
for _ in $(seq 50); do [ "$(staging_rules)" = 1 ] && break; sleep 0.2; done
kill -KILL "$pid"; wait "$pid" 2> /dev/null
expect "a killed window leaves its rule (only the timer can close it now)" '[ "$(staging_rules)" = 1 ] && [ -f "$STATE/timer" ]'
out=$(FAKE_UID=1000 bash "$LS" down 2>&1); st=$?
expect "down as deploy is refused while the timer is active" '[ "$st" = 1 ] && grep -q "close first" <<< "$out"'
bash "$LS" close > /dev/null 2>&1
expect "close (what the timer runs) removes it" '[ "$(staging_rules)" = 0 ] && [ ! -f "$STATE/timer" ]'

echo "== dry run"
reset
cp "$STATE/docker-user" "$T/before"
out=$(bash "$LS" --dry-run window --ips 203.0.113.5 --minutes 10 2>&1); st=$?
expect "exits 0 and prints the plan" '[ "$st" = 0 ] && grep -q "^+ iptables -I DOCKER-USER 1 -i eth0 -s 203.0.113.5/32" <<< "$out" && grep -q "^+ systemd-run" <<< "$out"'
expect "changes nothing" 'cmp -s "$T/before" "$STATE/docker-user" && [ ! -f "$STATE/timer" ] && [ ! -f "$STATE/generators" ]'
rm -rf "$STAGING_DIR" "$STATE/up"
out=$(FAKE_UID=1000 bash "$LS" --dry-run up --tag def456 2>&1); st=$?
expect "a dry up prints the compose plan and writes nothing" '[ "$st" = 0 ] && grep -q "^+ docker compose -p sirat-staging" <<< "$out" && [ ! -d "$STAGING_DIR" ] && [ ! -f "$STATE/up" ]'

echo "== the registration surge (payments' fake PayStation)"
reset
rm -rf "$STAGING_DIR" "$STATE/up"
out=$(FAKE_UID=1000 bash "$LS" up --registration 2>&1); st=$?
expect "refused without payments' compose file" '[ "$st" = 1 ] && grep -q "fake-paystation.compose.yml is missing" <<< "$out" && [ ! -f "$STATE/up" ]'
echo 'services: {}' > "$T/repo/infra/fake-paystation.compose.yml"
rm -rf "$STAGING_DIR"
out=$(FAKE_UID=1000 bash "$LS" k6 registration 2>&1); st=$?
expect "k6 registration refused before up --registration" '[ "$st" = 1 ]'
out=$(FAKE_UID=1000 bash "$LS" up --registration 2>&1); st=$?
expect "up --registration exits 0" '[ "$st" = 0 ]'
expect "the registration staging's resume cookie is not Secure (payments' k6 jar, plain http)" 'grep -qx "COOKIE_SECURE=false" "$STAGING_DIR/staging.env"'
without_fake() { grep "docker compose -p sirat-staging" "$STATE/log" | grep -v "fake-paystation.compose.yml"; }
expect "it adds the fake to every compose call" '[ -z "$(without_fake)" ]'
expect "builds only the fake" 'grep -q "fake-paystation.compose.yml build fake-paystation$" "$STATE/log" && ! grep -qE " build (migrate|api|worker|web)" "$STATE/log"'
expect "opens registration in staging's database" 'grep -q "exec -T postgres .*UPDATE settings SET value = .true.::jsonb WHERE key = .registration_open." "$STATE/log"'
expect "starts the fake with the app" 'grep -q "up -d --no-build --wait api worker web nginx fake-paystation" "$STATE/log"'
expect "makes no load students" '! grep -q "loadtest-fixtures.ts --users" "$STATE/log"'
: > "$STATE/log"
out=$(FAKE_UID=1000 bash "$LS" k6 registration -e RATE=4 2>&1); st=$?
expect "k6 registration runs on staging's network, through its nginx" '[ "$st" = 0 ] && grep -q "docker run --rm --name sirat-staging-k6 --network sirat-staging_default .*grafana/k6:1.0.0 run -e BASE_URL=http://nginx -e RATE=4 /scripts/registration-surge.js" "$STATE/log"'
expect "later compose calls still include the fake" '[ -z "$(without_fake)" ]'
out=$(FAKE_UID=1000 bash "$LS" down 2>&1)
rm -f "$T/repo/infra/fake-paystation.compose.yml"

echo "== down"
reset
mkdir -p "$STAGING_DIR" && cp "$SRC/.env.example" "$STAGING_DIR/staging.env" && touch "$STATE/up"
out=$(FAKE_UID=1000 bash "$LS" down 2>&1); st=$?
expect "down removes the project and its settings" '[ "$st" = 0 ] && [ ! -f "$STATE/up" ] && [ ! -d "$STAGING_DIR" ] && grep -q "compose -p sirat-staging .* down -v --remove-orphans" "$STATE/log"'

echo "load-staging test: $fails failed"
[ "$fails" = 0 ]

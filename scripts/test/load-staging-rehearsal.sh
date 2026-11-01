#!/usr/bin/env bash
# The VPS load kit (scripts/load-staging.sh) against real Docker, run by run-load-staging-rehearsal.sh from a tools
# container with the clone at the daemon's own path. Project sirat-staging on loopback (STAGING_BIND), the
# sirat-*:$TAG images. Not part of it: the firewall window (no DOCKER-USER here; load-staging.test.sh covers it on
# faked commands) and the guard check, which a fake systemctl answers. Needs CLONE_DIR, OUT and TAG.
# The checks read their variables inside eval, which shellcheck cannot follow.
# shellcheck disable=SC2034
set -uo pipefail
cd "$CLONE_DIR" || exit 1
export STAGING_DIR="$OUT/staging" RELEASE_FILE="$OUT/release.env" STAGING_BIND=127.0.0.1 STAGING_PORT=${STAGING_PORT:-18088}
printf 'SIRAT_TAG=%s\n' "$TAG" > "$RELEASE_FILE"
mkdir -p "$OUT/bin"
printf '#!/bin/sh\n[ "$*" = "is-active --quiet sirat-docker-user" ]\n' > "$OUT/bin/systemctl"
chmod +x "$OUT/bin/systemctl"
export PATH="$OUT/bin:$PATH"
LS=scripts/load-staging.sh
P=sirat-staging
fails=0
ok() { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }
expect() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
indent() { sed 's/^/        | /'; }
svc() {
  local ids
  ids=$(docker ps -q --filter "label=com.docker.compose.project=$P" --filter "label=com.docker.compose.service=$1")
  sed -n 1p <<< "$ids"
}
inside() { docker run --rm --network "${P}_default" alpine:3.22 wget -qO- -T 10 "$1" 2> /dev/null || true; }
report_line() { bash "$LS" report "$1" 2> /dev/null | sed -n '/"msg":"load report"/p'; }
gone() {
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$P")" ] &&
    [ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$P")" ] &&
    [ -z "$(docker network ls -q --filter "name=^${P}_default\$")" ] && [ ! -d "$STAGING_DIR" ]
}

# PARTS (default "exam registration"): which parts to run.
PARTS=" ${PARTS:-exam registration} "
if [[ $PARTS == *" exam "* ]]; then
echo "== the exam simulation's staging"
t0=$SECONDS
bash "$LS" up --tag "$TAG" --users 60 2>&1 | indent
expect "up: the stack is running" '[ -n "$(svc nginx)" ] && [ -n "$(svc api)" ] && [ -n "$(svc worker)" ] && [ -n "$(svc pgbouncer)" ]'
expect "the settings are owner-only" '[ "$(stat -c %a "$STAGING_DIR")" = 700 ] && [ "$(stat -c %a "$STAGING_DIR/staging.env")" = 600 ]'
expect "the API runs in production mode on staging's own secret" '[ "$(docker exec "$(svc api)" printenv NODE_ENV)" = production ] && [ "$(docker exec "$(svc api)" printenv JWT_ACCESS_SECRET)" = "$(sed -n "s/^JWT_ACCESS_SECRET=//p" "$STAGING_DIR/staging.env")" ]'
expect "nginx publishes only on loopback" '[ "$(docker port "$(svc nginx)" 80/tcp)" = "127.0.0.1:$STAGING_PORT" ]'
expect "the app answers through staging's nginx" 'grep -q "\"status\":\"ready\"" <<< "$(inside http://nginx/api/ready)"'
expect "Postgres carries the test marker" '[ "$(docker exec "$(svc postgres)" sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"SHOW sirat.environment\"")" = test ]'
out=$(bash "$LS" exam --questions 10 --duration 2 --window-end-in 15 2>&1)
echo "$out" | indent
exam=$(sed -n 's/^EXAM_ID=//p' "$STAGING_DIR/k6.env")
expect "exam: the id is in k6.env" '[[ $exam =~ ^[0-9a-f-]{36}$ ]]'
bash "$LS" k6 exam -e USERS=60 -e SCENARIO=steady -e RAMP=10 -e CHECKPOINT_MIN=25 -e CHECKPOINT_MAX=35 \
  -e LEAVE_SHARE=0.1 --quiet > "$OUT/k6-exam.log" 2>&1
st=$?
grep -E "✓|✗" "$OUT/k6-exam.log" | indent
expect "k6 exam inside the stack: every threshold passes" '[ "$st" = 0 ]'
final=''
for _ in $(seq 48); do
  final=$(report_line "$exam")
  grep -qE '"(in_progress|submitted)":' <<< "$final" || break
  sleep 5
done
echo "$final" | indent
expect "report: all 60 attempts scored, none open" 'grep -q "\"attempts\":{\"scored\":60}" <<< "$final" && grep -q "\"overdueOpen\":0" <<< "$final"'
bash "$LS" status 2>&1 | indent
bash "$LS" down 2>&1 | indent
expect "down: no container, volume, network or settings left" 'gone'
echo "   exam part: $((SECONDS - t0)) s"
fi

if [[ $PARTS == *" registration "* ]]; then
echo "== the registration surge's staging (payments' fake PayStation)"
t1=$SECONDS
bash "$LS" up --registration --tag "$TAG" 2>&1 | indent
expect "up --registration: the fake is running and healthy" '[ -n "$(svc fake-paystation)" ] && [ "$(docker inspect -f "{{.State.Health.Status}}" "$(svc fake-paystation)")" = healthy ]'
expect "the API is on the fake (and in development mode, which the fake needs)" '[ "$(docker exec "$(svc api)" printenv PAYSTATION_ENV)" = fake ] && [ "$(docker exec "$(svc api)" printenv NODE_ENV)" = development ]'
expect "registration is open in staging's database" 'grep -q "\"open\":true" <<< "$(inside http://nginx/api/registrations/info)"'
bash "$LS" k6 registration -e RATE=2 -e RAMP=10s -e HOLD=30s --quiet > "$OUT/k6-registration.log" 2>&1
st=$?
grep -E "✓|✗" "$OUT/k6-registration.log" | indent
expect "k6 registration inside the stack: every threshold passes" '[ "$st" = 0 ]'
bash "$LS" down 2>&1 | indent
expect "down: no container, volume, network or settings left" 'gone'
expect "down removes the fake's image too" '! docker image inspect "sirat-fake-paystation:$TAG" > /dev/null 2>&1'
echo "   registration part: $((SECONDS - t1)) s"
fi

echo "load-staging rehearsal: $fails failed"
[ "$fails" = 0 ]

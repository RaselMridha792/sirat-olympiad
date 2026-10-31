#!/usr/bin/env bash
# Tests for scripts/backup.sh (LAUNCH-PLAN §4 L6) in their own compose project (sirat-backup-test, never `sirat`), with
# a throwaway age key, an rclone `local` remote and a fake heartbeat. Run it through scripts/test/run-backup-test.sh,
# which provides the tools (age, rclone, the Docker CLI) in a throwaway container.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT=sirat-backup-test
T="$(mktemp -d)"
PASSED=0
FAILED=0
result() { if [ "$1" -eq 0 ]; then PASSED=$((PASSED + 1)); echo "  ok    $2"; else FAILED=$((FAILED + 1)); echo "  FAIL  $2"; sed 's/^/        /' "$T/out.log" 2>/dev/null | tail -n 5; fi; }

pw="$(head -c 48 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 24)"
printf 'BACKUP_TEST_PG_PASSWORD=%s\n' "$pw" > "$T/compose.env"
DC=(docker compose -p "$PROJECT" --env-file "$T/compose.env" -f "$ROOT/infra/backup/test/docker-compose.yml")
cleanup() {
  "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$T"
}
trap cleanup EXIT
psql() { "${DC[@]}" exec -T postgres psql -U sirat -d "${DB:-sirat}" -v ON_ERROR_STOP=1 -qAt "$@"; }

echo "backup tests (compose project $PROJECT)"
"${DC[@]}" up -d --wait postgres >/dev/null 2>&1

# The real dump's shape: Prisma's migrations table (one failed and one rolled back, which must not count), a table
# whose name needs quotes, an empty one, and rows with tabs and newlines, enough that deleting most shrinks the dump.
psql > /dev/null <<'SQL'
CREATE TABLE _prisma_migrations (
  id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz,
  migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count int NOT NULL DEFAULT 0);
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, rolled_back_at) VALUES
  ('1', 'x', now(), '20261030000000_init', NULL),
  ('2', 'x', now(), '20261031000000_exams', NULL),
  ('3', 'x', NULL, '20261101000000_failed', NULL),
  ('4', 'x', now(), '20261101000001_rolled_back', now());
CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL, note text);
INSERT INTO users (email, note)
  SELECT 'user' || g || '@test.invalid', md5(g::text) || E'\ta tab\nand a newline' FROM generate_series(1, 20000) g;
CREATE TABLE "Exam" (id serial PRIMARY KEY, title text);
INSERT INTO "Exam" (title) VALUES ('one'), ('two');
CREATE TABLE empty_table (id int);
SQL

age-keygen -o "$T/key.txt" 2>/dev/null
age-keygen -y "$T/key.txt" > "$T/recipients.txt"
printf '[testremote]\ntype = local\n' > "$T/rclone.conf"
mkdir -p "$T/bin" "$T/remote" "$T/lock"
# The heartbeat: a fake curl that writes down every call.
cat > "$T/bin/curl" <<'SH'
#!/bin/sh
echo "$*" >> "$PINGS"
SH
# A dump killed midway: when KILL_DUMP is set, the pg_dump call writes some bytes and is killed.
REAL_DOCKER="$(command -v docker)"
cat > "$T/bin/docker" <<SH
#!/usr/bin/env bash
if [ -n "\${KILL_DUMP:-}" ] && [[ "\$*" == *pg_dump* ]]; then head -c 300000 /dev/urandom; kill -9 \$\$; fi
exec "$REAL_DOCKER" "\$@"
SH
chmod +x "$T/bin/curl" "$T/bin/docker"

config() { # the base config, then any override lines (the last value of a name wins)
  cat > "$T/backup.env" <<EOF
# test config
BACKUP_PROJECT=$PROJECT
BACKUP_COMPOSE_FILES=infra/backup/test/docker-compose.yml
BACKUP_COMPOSE_ENV_FILE=$T/compose.env
BACKUP_DIR=$T/backups
BACKUP_LOCK=$T/lock/backup.lock
BACKUP_LOCK_WAIT_SECONDS=2
BACKUP_RECIPIENTS=$T/recipients.txt
BACKUP_REMOTE=testremote:$T/remote
RCLONE_CONFIG=$T/rclone.conf
BACKUP_HEARTBEAT_URL=https://hc.test/ping/abc
EOF
  for line in "$@"; do printf '%s\n' "$line" >> "$T/backup.env"; done
  chmod 600 "$T/backup.env"
}
# A fixed clock: each run is 10 minutes after the last, from Monday 2 Nov 2026 10:00 Asia/Dhaka; `at` jumps to a time.
CLOCK=$(($(date -u -d '2026-11-02T04:00:00Z' +%s) - 600))
at() { CLOCK=$(($(date -u -d "$1" +%s) - 600)); }
run_backup() {
  CLOCK=$((CLOCK + 600))
  SIRAT_BACKUP_ENV="$T/backup.env" PATH="$T/bin:$PATH" PINGS="$T/pings.log" SIRAT_BACKUP_NOW="$CLOCK" \
    bash "$ROOT/scripts/backup.sh" "$@" > "$T/out.log" 2>&1
}
on_remote() { [ -f "$T/remote/$1/$(basename "$2")" ]; }
copies() { find "$T/backups" -maxdepth 1 -name 'sirat-*.dump.age' 2>/dev/null | wc -l; }
newest() { find "$T/backups" -maxdepth 1 -name "sirat-*.$1" | sort | tail -n 1; }
field() { sed -n "s/^  \"$2\": \"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}$/\1/p" "$1"; }
table_rows() { sed -n "s/^    \"$2\": \([0-9]*\),\{0,1\}$/\1/p" "$1"; }
last_ping() { tail -n 1 "$T/pings.log" 2>/dev/null || true; }

# 1. A normal run.
config
: > "$T/pings.log"
status=0; run_backup || status=$?
m="$(newest manifest.json)"
f="$(newest dump.age)"
ok=1
[ "$status" -eq 0 ] && [ "$(copies)" -eq 1 ] && on_remote hourly "$f" && on_remote hourly "$m" && ok=0
result "$ok" "a normal run leaves an encrypted copy and its manifest here and on the remote (hourly/)"
ok=1
[ "$(field "$m" sha256)" = "$(sha256sum "$f" | cut -d' ' -f1)" ] &&
  [ "$(sha256sum "$T/remote/hourly/$(basename "$f")" | cut -d' ' -f1)" = "$(field "$m" sha256)" ] &&
  head -c 64 "$f" | grep -q '^age-encryption.org/v1' && ok=0
result "$ok" "the manifest's sha256 matches the local and the uploaded copy, which is age-encrypted"
ok=1
[ "$(table_rows "$m" users)" = 20000 ] && [ "$(table_rows "$m" Exam)" = 2 ] &&
  [ "$(table_rows "$m" empty_table)" = 0 ] && [ "$(table_rows "$m" _prisma_migrations)" = 4 ] &&
  [ "$(grep -c '^    "2026' "$m")" -eq 2 ] && grep -q '"20261030000000_init"' "$m" &&
  grep -q '"20261031000000_exams"' "$m" && [ -n "$(field "$m" created_at)" ] && ok=0
result "$ok" "the manifest counts every table's rows and lists only the finished migrations"
ok=1
[ "$(wc -l < "$T/pings.log")" -eq 1 ] && grep -q 'https://hc.test/ping/abc$' "$T/pings.log" && ok=0
result "$ok" "the heartbeat gets one success ping"
ok=1
[ "$(stat -c '%a' "$T/backups")" = 700 ] && [ "$(stat -c '%a' "$f")" = 600 ] &&
  [ -z "$(find "$T/backups" -name '.work.*' -o -name '*.dump')" ] && ok=0
result "$ok" "the copies are owner-only and no plain dump is left"

# 2. The throwaway key decrypts the copy; the restored rows match the manifest.
ok=1
if age -d -i "$T/key.txt" "$f" > "$T/plain.dump" &&
  psql -c 'CREATE DATABASE restorecheck' &&
  "${DC[@]}" exec -T postgres pg_restore -U sirat -d restorecheck --no-owner < "$T/plain.dump"; then
  [ "$(DB=restorecheck psql -c 'SELECT count(*) FROM users')" = "$(table_rows "$m" users)" ] &&
    [ "$(DB=restorecheck psql -c 'SELECT count(*) FROM "Exam"')" = "$(table_rows "$m" Exam)" ] && ok=0
fi
rm -f "$T/plain.dump"
result "$ok" "the throwaway key decrypts the upload and the restored counts match the manifest"

# 3. A dump killed midway.
: > "$T/pings.log"
status=0; KILL_DUMP=1 run_backup || status=$?
ok=1
[ "$status" -ne 0 ] && [ "$(copies)" -eq 1 ] && [ -z "$(find "$T/backups" -name '.work.*')" ] &&
  [ "$(find "$T/remote/hourly" -type f | wc -l)" -eq 2 ] && last_ping | grep -q '/fail$' && ok=0
result "$ok" "a dump killed midway leaves no new copy (nor its .work.* after the next run's start), pings /fail"

# 4. A remote that does not exist.
config "BACKUP_REMOTE=nosuchremote:somewhere"
: > "$T/pings.log"
status=0; run_backup || status=$?
ok=1
[ "$status" -ne 0 ] && grep -q "FAILED at step 'upload'" "$T/out.log" && last_ping | grep -q '/fail$' && ok=0
result "$ok" "a bad remote exits non-zero and pings /fail"

# 5. Another run holding the lock.
config
flock "$T/lock/backup.lock" -c 'sleep 6' &
holder=$!
sleep 1
status=0; run_backup || status=$?
wait "$holder"
ok=1
[ "$status" -ne 0 ] && grep -q 'another backup is still running' "$T/out.log" && ok=0
result "$ok" "a run waits for the lock and fails after the limit"

# 6. A dump much smaller than the last one.
psql -c 'DELETE FROM users WHERE id > 50' > /dev/null
before="$(copies)"
: > "$T/pings.log"
status=0; run_backup || status=$?
ok=1
[ "$status" -ne 0 ] && grep -q 'much smaller than the last one' "$T/out.log" && [ "$(copies)" -eq "$before" ] &&
  last_ping | grep -q '/fail$' && ok=0
result "$ok" "a dump much smaller than the last one fails the run"
status=0; run_backup --accept-smaller || status=$?
ok=1
[ "$status" -eq 0 ] && grep -q 'WARNING: --accept-smaller: accepted a dump of' "$T/out.log" &&
  [ "$(copies)" -eq $((before + 1)) ] && ok=0
result "$ok" "--accept-smaller takes that dump once, by hand, and says so"
status=0; run_backup --accept-smaller --verify || status=$?
ok=1
[ "$status" -eq 2 ] && ok=0
result "$ok" "--accept-smaller cannot be combined with --verify"
psql -c "INSERT INTO users (email, note) SELECT 'again' || g || '@test.invalid', md5(g::text) FROM generate_series(1, 20000) g" > /dev/null

# 7. Retention: the newest three copies stay.
for _ in 1 2 3; do run_backup || true; sleep 1; done
ok=1
[ "$(copies)" -eq 3 ] && [ "$(find "$T/backups" -maxdepth 1 -name 'sirat-*.manifest.json' | wc -l)" -eq 3 ] && ok=0
result "$ok" "only the newest three copies are kept here"

# 8. --verify.
status=0; run_backup --verify || status=$?
ok=1
[ "$status" -eq 0 ] && grep -q 'backup: verified' "$T/out.log" && ok=0
result "$ok" "--verify passes on the newest copy"
cp "$(newest manifest.json)" "$T/manifest.bak"
sed -i 's/^  "created_at": "[^"]*",$/  "created_at": "",/' "$(newest manifest.json)"
: > "$T/pings.log"
status=0; run_backup --verify || status=$?
ok=1
[ "$status" -ne 0 ] && grep -q 'no valid created_at' "$T/out.log" && last_ping | grep -q '/fail$' && ok=0
result "$ok" "--verify fails on a manifest without a valid created_at"
cp "$T/manifest.bak" "$(newest manifest.json)"
printf 'x' >> "$(newest dump.age)"
: > "$T/pings.log"
status=0; run_backup --verify || status=$?
ok=1
[ "$status" -ne 0 ] && grep -q 'does not match its manifest' "$T/out.log" && last_ping | grep -q '/fail$' && ok=0
result "$ok" "--verify fails on a changed copy and pings /fail"

# 9. Tier prefixes (owner Q1 lifecycle): the first run of the Dhaka day at or after 03:00 is also the daily copy, and
#    on a Sunday also the weekly one; other runs are hourly only.
tiers_of() { # the prefixes that hold the newest copy
  local name t out=""
  name="$(basename "$(newest dump.age)")"
  for t in hourly daily weekly; do [ -f "$T/remote/$t/$name" ] && [ -f "$T/remote/$t/${name%.dump.age}.manifest.json" ] && out="$out$t "; done
  printf '%s' "${out% }"
}
at 2026-11-07T21:10:00Z # Sunday 8 Nov, 03:10 Dhaka
run_backup || true
result "$([ "$(tiers_of)" = 'hourly daily weekly' ] && echo 0 || echo 1)" "the 03:xx run on a Sunday lands in hourly/, daily/ and weekly/"
at 2026-11-07T22:10:00Z # Sunday, 04:10 Dhaka: today's daily copy exists
run_backup || true
result "$([ "$(tiers_of)" = hourly ] && echo 0 || echo 1)" "a later run the same day lands in hourly/ only"
at 2026-11-08T20:10:00Z # Monday 9 Nov, 02:10 Dhaka: before 03:00
run_backup || true
result "$([ "$(tiers_of)" = hourly ] && echo 0 || echo 1)" "a run before 03:00 Dhaka lands in hourly/ only"
at 2026-11-08T23:10:00Z # Monday, 05:10 Dhaka: no daily copy yet today (the 03:00 run failed)
run_backup || true
result "$([ "$(tiers_of)" = 'hourly daily' ] && echo 0 || echo 1)" "the first run after a missed 03:00 makes the daily copy (not weekly on a Monday)"

# 10. A local-only run.
config "BACKUP_REMOTE=none"
: > "$T/pings.log"
status=0; run_backup || status=$?
ok=1
[ "$status" -eq 0 ] && grep -q 'NOT off the server' "$T/out.log" && [ ! -s "$T/pings.log" ] && ok=0
result "$ok" "BACKUP_REMOTE=none keeps a local copy, says it is not off the server, and pings nothing"

# 11. The configuration.
config
chmod 644 "$T/backup.env"
status=0; run_backup || status=$?
ok=1
[ "$status" -ne 0 ] && grep -q 'readable by its owner only' "$T/out.log" && ok=0
result "$ok" "a config that others can read is refused"
config "BACKUP_PROJECT="
status=0; run_backup || status=$?
ok=1
[ "$status" -ne 0 ] && grep -q 'must name the compose project' "$T/out.log" && ok=0
result "$ok" "a config without a project is refused"
grep -v '^age1' "$T/recipients.txt" > "$T/no-keys.txt" || true
config "BACKUP_RECIPIENTS=$T/no-keys.txt"
status=0; run_backup || status=$?
ok=1
[ "$status" -ne 0 ] && grep -q 'no age public key' "$T/out.log" && ok=0
result "$ok" "a recipients file without a public key is refused"

echo "backup tests: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]

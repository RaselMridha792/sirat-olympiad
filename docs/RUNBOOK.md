# RUNBOOK

Copy-paste operations. Always run from the repo root. Compose file: `infra/docker-compose.yml`, always with the root `.env` (`--env-file .env`; without it compose refuses to start because required variables are missing). Commands marked VERIFIED were run on the owner's machine during A1 (2026-10-30); everything else is still to be verified on the real VPS.

```bash
# The VPS: the live release's images (SIRAT_TAG from the release file scripts/deploy.sh writes). Every `up` takes
# --no-build and app services take --no-deps, so a command run by hand never builds or touches a data service.
export DC="docker compose -p sirat --env-file .env --env-file /var/lib/sirat/release.env -f infra/docker-compose.yml"
# Local machine only (never on the VPS): the dev override; images are tagged :latest
export DCD="docker compose -p sirat --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml"
```

## 0. Local development (VERIFIED)

```bash
cp .env.example .env                    # fill real local passwords; never commit
cp apps/api/.env.example apps/api/.env  # host-side dev env (same POSTGRES_PASSWORD and POSTGRES_APP_PASSWORD)
openssl rand -base64 48                 # paste a fresh output into JWT_ACCESS_SECRET of each file (blank in the examples)
pnpm install
pnpm --filter @sirat/shared build
pnpm db:generate

$DCD up -d postgres pgbouncer redis-cache redis-queue mailpit   # data services on 127.0.0.1:15432/16432/16379/16380; Mailpit UI http://127.0.0.1:18025
pnpm db:migrate                                         # prisma migrate dev (host, via DIRECT_URL)
$DCD up -d --build --no-deps migrate                    # a fresh cluster only: gives sirat_app its login (log: runtime role ready)
pnpm --filter @sirat/api db:seed                        # idempotent config seed
ALLOW_DEV_FIXTURES=yes-this-is-not-production pnpm --filter @sirat/api db:fixtures:dev   # DEV ONLY (see below)
pnpm dev:api                                            # http://localhost:4000/api/health
pnpm --filter @sirat/api admin:create --email you@example.org --name "Your Name"   # a local admin (section 13)
pnpm dev:web                                            # http://localhost:3000; dashboards need a session (see below)

pnpm typecheck && pnpm lint && pnpm test && pnpm build  # unit gates
pnpm --filter @sirat/api test:int                       # DB + Redis integration tests (uses sirat_test only)

$DCD up -d --build                                      # full stack; http://127.0.0.1:8080 and /api/ready
$DCD up -d --build --no-deps migrate api worker web nginx   # the shared stack (lead's rule): rebuild only the app services
```

**nginx after pulling the TLS change once (L3):**
- An nginx container created before the folder mount (single-file mounts, the image's default command) keeps running, but it cannot start again. At the next Docker Desktop or PC restart, or after `$DCD restart nginx`, it crash-loops with `open() "/etc/nginx/sirat/cloudflare-realip.conf" failed`.
- With the lead's or Rasel's go-ahead (the stack is shared), recreate it once from a checkout that has the change: `$DCD up -d --no-deps nginx`. The same applies if a smoke turn recreated nginx from a worktree without the change and that worktree merges main later.
- The e2e's CSP step needs nginx's site (http://127.0.0.1:8080). Against a bare Next, or an nginx without the change, it fails on purpose.

**The runtime role sirat_app (L2, L8):**
- Every stack turn needs `POSTGRES_APP_PASSWORD` in the root `.env`, because PgBouncer, the API, the worker and the seed log in as `sirat_app` (L8).
  - **Without it**, compose stops before it creates or restarts any container, so nothing crash-loops. It prints `required variable POSTGRES_APP_PASSWORD is missing a value: POSTGRES_APP_PASSWORD missing - set it in .env (openssl rand -hex 32)`.
  - **With a value other than the one the cluster already has** (the dev cluster keeps its first one), the migrate job prints `password already set, kept`, then its seed fails to log in (password authentication failed for `sirat_app`). The job exits non-zero, so the API and the worker do not start. Put the agreed value in the root `.env`, recreate PgBouncer (next point), then take the turn; if the value is lost, use the reset below.
- PgBouncer holds the value of the worktree that last created it (the key is part of its settings). A fixed or changed value therefore needs `$DCD up -d --no-deps pgbouncer` before the usual app-only turn. The messages:
  - `SASL authentication failed`: the client's value differs from PgBouncer's;
  - `password authentication failed for user "sirat_app"`: PgBouncer's value differs from the role's, or the role has no login yet (a fresh cluster; Postgres logs `User "sirat_app" has no password assigned`);
  - `FATAL: bouncer config error`: a user other than `sirat_app` went through PgBouncer, such as a host URL with `sirat@…:16432`. Use `sirat_app` on 16432, or the owner on 15432.
- **The L8 switch on the shared stack** (once, in the window the lead and Rasel pick): every worktree's root `.env` has the value, and every `apps/api/.env` `DATABASE_URL` through 16432 uses `sirat_app` (or the owner on 15432). Then `$DCD up -d --no-deps pgbouncer` comes last. Apps with L8 already work through the old PgBouncer, so nothing breaks before that step, and turns before the window stay app-only even though the compose file changed.
- `pnpm dev:api` through the stack's PgBouncer (`127.0.0.1:16432`) logs in as `sirat_app` too (`apps/api/.env.example`). To run as the owner instead, point `DATABASE_URL` straight at Postgres (`127.0.0.1:15432`).
- `POSTGRES_APP_PASSWORD` in the root `.env` (`openssl rand -hex 32`) is the same value in every worktree that takes stack turns: one Postgres cluster has one role. The first stack turn after L2 gives the role its login (the migrate log says `runtime role ready: sirat_app (login and password set)`); later turns keep it.
- `TEST_APP_DATABASE_URL` in `apps/api/.env` (`postgresql://sirat_app:<the same value>@127.0.0.1:15432/<the session's *_test database>`, the same host and database as `TEST_DATABASE_URL`) makes the integration tests run the app as `sirat_app`, as CI does. Without it the tests run the app as the owner and skip the `sirat_app` checks; with it but no login yet, `test:int` stops with a message.
- Rasel types both values. Sessions never read or print them.
- Changing the dev value (only to rotate it or when it is lost), with the lead's or Rasel's go-ahead. New database connections of the running stack fail from step 2 until step 4 ends.
  1. Rasel puts the new value in every worktree's root `.env`, every `TEST_APP_DATABASE_URL` and every `apps/api/.env` `DATABASE_URL` through 16432.
  2. `$DCD exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER ROLE sirat_app PASSWORD NULL"'` (no value is typed in the command).
  3. `$DCD up -d --no-deps pgbouncer`, so PgBouncer takes the new value.
  4. One announced stack turn: `runtime-role.ts` sets the new value, the seed logs in, and the app logs in through the recreated PgBouncer.

Signing secret: the API refuses to start (in every `NODE_ENV`) when `JWT_ACCESS_SECRET` is blank, shorter than 32 characters, too repetitive, or contains a placeholder word such as `fake`, `example` or `change me`. The error names the rule, never the value. Use a separate value per environment and never reuse the dev value on the VPS.

Fixtures: 3 verified students with paid registrations, `student1@fixtures.invalid` … `student3@fixtures.invalid`, password = your `FIXTURE_PASSWORD` in `apps/api/.env`. They refuse to run unless `NODE_ENV` is development/test, the confirmation is set for that run, the URL is local with no `host`/`hostaddr` parameter, and the connected Postgres server carries `sirat.environment=development` (only the dev override sets it; after pulling this change once, recreate the dev Postgres with `$DCD up -d postgres`, data is kept). PowerShell: `$env:ALLOW_DEV_FIXTURES='yes-this-is-not-production'; pnpm --filter @sirat/api db:fixtures:dev`. Each student has a distinct phone (`01700000001`…`01700000003`) and a paid 400 BDT payment that went initiated → pending → paid, like a real one.

### Payments migration on an old dev database (once)

The payments migration (`*_payments_registration`) refuses a database that holds payments or pending registrations. The new columns have no meaningful backfill, and a migration never deletes data. A dev database with the old fixtures holds 3 such payments. **On the shared dev database (`sirat`), run this only after Rasel says so.** Run it before the next `$DCD up -d --build`; otherwise the `migrate` job fails and `api` does not start.

```bash
export ALLOW_DEV_FIXTURES=yes-this-is-not-production       # PowerShell: $env:ALLOW_DEV_FIXTURES='yes-this-is-not-production'
pnpm --filter @sirat/api db:fixtures:dev --clean           # 1. removes ONLY the @fixtures.invalid users' payments and registrations; users stay
pnpm --filter @sirat/api prisma:deploy                     # 2. prisma migrate deploy (not `pnpm db:migrate`: migrate dev may offer a reset)
pnpm --filter @sirat/api db:seed                           # 3. new settings keys
pnpm --filter @sirat/api db:fixtures:dev                   # 4. the same three students get paid registrations again
```

- **The migration already ran and failed** (the `migrate` job or step 2 says `payments_registration: the database holds …`): nothing was changed; Prisma ran it as one transaction. Mark it rolled back, then run steps 1–4: `pnpm --filter @sirat/api exec prisma migrate resolve --rolled-back <name from the error, e.g. 20261031111746_payments_registration>`.
- **Payments remain after step 1:** they are not fixture rows. Stop and ask the owner; never delete them by hand.
- **Test databases (`*_test`):** nothing to do. `test:int` (`test/prepare-test-db.mjs`) empties their three payment tables and clears a failed try before this migration runs.
- `apps/api/test/payments-migration.int-spec.ts` runs this whole order on a throwaway database at main's earlier schema with the old fixtures.

Web session: the dashboards read the real session (`GET /api/auth/me` from the web server; `API_INTERNAL_URL`, default `http://localhost:4000`, compose sets `http://api:4000`), so `pnpm dev:web` needs `pnpm dev:api` running (the stack's API is not published on :4000; with the full stack, use its own web through nginx at http://127.0.0.1:8080). Log in at `/login` as a fixture student; the admin pages need an admin from the create-admin CLI. Without a session a dashboard page goes to `/refresh`, then `/login`; with the API down it shows the error page, never `/login`. Dashboard data comes from the mock in development; `DATA_SOURCE=http pnpm dev:web` reads the local API instead (methods not connected yet show the error state, as in production).

Page checks and e2e (`apps/web/scripts`; Node and a local Chrome or Edge, no other tool):
- **The launch table** (`apps/web/src/data/launch.ts`) decides which dashboard pages are live:
  - `check:prod` fails a `live` page that shows the error state, a `soon` page without "coming soon", and any page without a row. Every new page needs a row.
  - In development, `?mock=launch` shows the `soon` pages as production would.
- `check:leak` (dev server) and `check:prod` / `check:api-down` (`next start` with `API_INTERNAL_URL`): set `CHECK_STUDENT_EMAIL`/`CHECK_STUDENT_PASSWORD` (a fixture student) and `CHECK_ADMIN_EMAIL`/`CHECK_ADMIN_PASSWORD`; `check:leak` also needs `CHECK_AMBASSADOR_EMAIL`/`CHECK_AMBASSADOR_PASSWORD` (a fixture student an admin approved as an ambassador, only in a throwaway database: CI approves `student2@fixtures.invalid` through the API). CI runs all three (job "Dashboard pages").
- `pnpm --filter @sirat/web e2e [http://127.0.0.1:8080]` runs against the whole local stack with `E2E_STUDENT_PASSWORD` (the fixture password) and optionally `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`; it reads the reset email from Mailpit. The local stack (project `sirat`, same ports) is shared between sessions: announce `up -d --build`, smoke tests and e2e runs before starting and when done. The reset case sets the student's password to the same value again and ends that student's sessions. It refuses a base URL or `MAILPIT_URL` that is not 127.0.0.1, localhost or ::1.
- `pnpm --filter @sirat/web e2e:exam [http://127.0.0.1:8080]` (exam room): needs `E2E_STUDENT_PASSWORD` and an admin (`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`). The admin publishes a 15-minute exam for all categories through the API (`E2E exam <time>`; it stays published, closed after its 15-minute window, because an exam is archived only after its results are published); a fixture student takes it in the browser up to the 6th violation, and every response, the HTML and localStorage are searched for explanations, correct keys, scores and question ids. Same stack rules as `e2e`; loopback URLs only.
- `pnpm --filter @sirat/web e2e:exam-admin [http://127.0.0.1:8080]` (exam authoring, E5b): needs an admin (`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`). In the browser: the settings form's own checks, a draft, questions through the dialog (checks, add, edit, delete), markup shown as plain text, a refused and then a successful publish, no delete once published (the API refuses one too), a published edit that becomes version 2, a refused unpublish, a published exam's settings (frozen fields, a later close with a reason), a stale save refused, a random-draw exam's retire (down to the minimum, kept in the history), an archive; the settings page must carry no question or answer key. It leaves two published exams (`E2E authoring <time>`, open for about 90 minutes; `E2E authoring pool <time>`, opening tomorrow) and one archived draft. Same stack rules as `e2e`; loopback URLs only.
- `pnpm --filter @sirat/web e2e:register <baseUrl>` (registration and payment, payments PR 4): needs an admin (`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`, who opens registration for the run and closes it again) and an API with `PAYSTATION_ENV=fake`, never the sandbox or live gateway. Locally without the stack: the fake (`pnpm --filter @sirat/api exec tsx test/fake-paystation/run.ts` with `FAKE_PAYSTATION_IPN_URL=<baseUrl>/api/payments/paystation/ipn`), the API and its worker with `PAYSTATION_ENV=fake`, `PAYSTATION_BASE_URL=http://127.0.0.1:18090`, `PAYSTATION_CALLBACK_URL=<baseUrl>/api/payments/paystation/callback` and `APP_URL=<baseUrl>` set in the environment (they win over `apps/api/.env`, which stays untouched), and `next dev` with `API_INTERNAL_URL` pointing at that API and `DATA_SOURCE=http` (the dev `/api` rewrite follows `API_INTERNAL_URL`, so a session on its own API port can use its own web; the free-book step reads real data). It leaves two `e2e-…@test.invalid` students behind.

Load test of registration and payment (`loadtests/registration-surge.js`, payments PR 5; k6 is a separate binary, not a dependency). Locally it runs on throwaway containers, never on the shared stack, `sirat` or `sirat_pay`:
- Containers (`--rm`, so nothing stays): `docker run -d --rm --name sirat-pay-load-pg -e POSTGRES_USER=load -e POSTGRES_PASSWORD=<any> -e POSTGRES_DB=sirat_load -p 127.0.0.1:54433:5432 postgres:17-alpine`, the same for `redis:7-alpine` (`-p 127.0.0.1:54380:6379`) and `axllent/mailpit:v1.32.0` (`-p 127.0.0.1:54025:8025`). On Windows, pick ports outside `netsh interface ipv4 show excludedportrange protocol=tcp`.
- Environment for the API and the worker (it wins over `apps/api/.env`, which stays untouched): `DATABASE_URL` and `DIRECT_URL` to that database, `REDIS_CACHE_URL=redis://127.0.0.1:54380/0`, `REDIS_QUEUE_URL=redis://127.0.0.1:54380/1`, `PAYSTATION_ENV=fake`, `PAYSTATION_BASE_URL=http://127.0.0.1:18090`, `PAYSTATION_CALLBACK_URL`/`PAYSTATION_IPN_URL` on the API's own port, `EMAIL_PROVIDER=mailpit`, `MAILPIT_URL=http://127.0.0.1:54025`.
- Then `prisma migrate deploy` and `pnpm --filter @sirat/api db:seed` with that environment, open registration in that database only (`update settings set value = 'true'::jsonb where key = 'registration_open'`), start the fake with `FAKE_PAYSTATION_IPN_URL=http://127.0.0.1:<api port>/api/payments/paystation/ipn`, then `node --env-file=.env dist/main.js` and `dist/worker.js`, and run `k6 run -e BASE_URL=http://127.0.0.1:<api port> loadtests/registration-surge.js` (options: `loadtests/README.md`).
- Afterwards: `docker stop sirat-pay-load-pg sirat-pay-load-redis sirat-pay-load-mail` (`--rm` removes them and their data).
- On the VPS (DoD #17): a staging stack with the fake, k6 from another machine through nginx. Through nginx the generator's single address meets the start limit (300/min per IP): keep `RATE` at 4 or less per generator machine, or use more machines.

## 1. Status and logs

```bash
$DC ps -a                          # VERIFIED; `migrate` shows "Exited (0)" when healthy
$DC logs -f --tail=200 api        # also: worker web nginx postgres pgbouncer redis-cache redis-queue migrate
$DC restart api                    # restart one service
scripts/healthcheck.sh https://<domain>
df -h; free -m; docker stats --no-stream
scripts/monitor.sh --dry-run       # the server checks now: the host facts, and each critical or warning check (raises nothing)
cat /var/lib/sirat/monitor-state.json   # the checks' state kept between runs (levels and when they last alerted)
```

**Server checks (L11):**
- **Schedule** (cron, set up by L12): `scripts/monitor.sh` every 5 minutes, and `scripts/monitor.sh --digest` at 08:00 Asia/Dhaka.
- **Configuration:** `.env.monitor` in the clone (git-ignored, `chmod 600`; names in `infra/monitor/monitor.env.example`): the compose project, the env files (the VPS adds `/var/lib/sirat/release.env`) and the heartbeat URL.
- **What a run does:**
  1. collects the host facts;
  2. runs `ops-check` in the api container, which adds the queues, workers, failed jobs, the reconciliation schedule and the queue Redis memory, decides each check's level (thresholds: LAUNCH-PLAN §6), and raises an `ops.<check>` alert on a change, hourly while it holds, and once when resolved;
  3. pings the heartbeat: success with no critical check, `/fail` with the check names otherwise.
- **A run that cannot reach ops-check** counts as critical (`monitor`).
- **During a deploy** (`deploy.sh` holds `/var/lib/sirat/deploy.lock`), `/fail` is held back.
- **The digest** comes every morning (alerts of the last 24 h by kind, the backup age, the disk, payments by status). A morning without it means the alert email path is broken.

## 2. Deploy and rollback

**`scripts/deploy.sh` (L9)**, as the `deploy` user, from the clone (`/srv/sirat`). Settings: `.env.deploy` in the clone (git-ignored, `chmod 600`; names in `infra/deploy/deploy.env.example`), with a read-only GitHub token for the CI check.

```bash
git fetch origin && sha=$(git rev-parse origin/main)   # deploy only a commit on main whose CI run passed (the script checks)
scripts/deploy.sh "$sha"          # preflight, build, a backup if it adds migrations, migrate, start, smoke; rolls back by itself
scripts/deploy.sh --rollback      # back to the previous release (its images are kept), no build
cat /var/lib/sirat/release.env    # the live release (SIRAT_TAG) and the one before it
tail /var/lib/sirat/releases.log  # every deploy, refusal, failure and rollback
scripts/deploy.sh --first         # once, on a fresh host, with the clone at the commit to deploy first (it names it):
                                  # the data services, then nginx (refuses if a data container exists)
```

- **A deploy:**
  1. **Preflight:**
     - a lock (`/var/lib/sirat/deploy.lock`; the monitor holds back `/fail` meanwhile); not root; `.env` mode 600; a clean tree;
     - nothing exported that compose would take over the files (`POSTGRES_*`, `DIRECT_URL`, `SIRAT_TAG`, `COMPOSE_*`; `DATABASE_URL` too, which compose no longer reads since L8);
     - free disk; the commit on `origin/main` with a passed CI run; no exam window open within 30 minutes either side;
     - the data services running and healthy, no development marker on Postgres, and the data services exactly as this commit's compose file describes them. Otherwise it stops with "data-service change pending: apply it as its own step": a deploy never starts or recreates a data service.
  2. Builds `sirat-{migrate,api,worker,web}:<sha>` while the live release serves.
  3. When the release adds migrations, a backup first (`sudo -n systemctl start sirat-backup.service`). A failed backup stops the deploy before migrate.
  4. `run --rm --no-deps migrate`. It must print `config seed done`; otherwise the deploy stops and the live API keeps serving ("Migration failed" below, or "The runtime role step failed" when the last line starts with `runtime role:`).
  5. `up -d --no-deps --no-build --wait api worker web`. nginx is reloaded only when `infra/nginx` changed, or recreated when a site template or entrypoint hook changed.
  6. **Smoke:**
     - exact 200s through nginx's internal listener;
     - the public URL: with maintenance off, `scripts/healthcheck.sh`; with it on, the maintenance answers, and the public app check is named as pending until maintenance is off (section 4);
     - each API replica's PayStation boot line against `.env` (compared, never printed); with payments disabled, only while `registration_open` is false;
     - the worker healthy; `prisma migrate status` up to date.
  7. **Success:** the release file and the log are written. The images of the last 3 releases stay; older `<sha>` tags this script built are removed, never a volume.
  8. **Failure after the switch:** back to the live release with no build, smoked again, and a loud line that **migrations stay applied**. A failed first release turns maintenance on instead.
- **The gap:** the replicas restart in place, about 10–20 s without the API (owner question Q4). nginx shows the maintenance page meanwhile, so deploy off-peak (00:00–07:00 Asia/Dhaka after launch).
- **Migrations stay backward-compatible:** the live API keeps serving between migrate and the switch, and a rollback runs the old code on the new schema.
- **The rehearsal** (`bash scripts/test/run-deploy-rehearsal.sh`, its own project `sirat-rh`, announce it): first start, two releases under a request loop, the RUNBOOK commands, a release whose API fails at boot (rolled back by itself), a failing migration, a data-service change, maintenance, a rollback during maintenance, and the CI gate.

Every DB session (migrations and psql included) starts with `statement_timeout 10s`, `lock_timeout 5s` and `idle_in_transaction_session_timeout 60s`. A migration that needs longer (backfill, index build) starts with `SET statement_timeout = '15min';`; in psql, run `SET statement_timeout = 0;` before a long manual query. A migration that fails on `lock_timeout` was waiting behind a long transaction: follow "Migration failed" below, then deploy again when traffic is low.

**Migration failed** (the deploy output names it, e.g. P3018). The deploy already stopped before the switch, so the live API keeps serving:
1. Do not run `$DC up`.
2. Confirm the failed migration left no changes. Prisma runs each migration file as one transaction on Postgres, unless the file has its own `BEGIN`/`COMMIT` or statements that cannot run in a transaction; check those by hand.
3. Mark it rolled back, with the failed release's image (the live one does not have the migration): `SIRAT_TAG=<failed sha> $DC run --rm --no-deps migrate node_modules/.bin/prisma migrate resolve --rolled-back <migration_name>`.
4. Fix forward: a corrected migration in a new commit, then deploy that. **No deploys during a live exam window**, except a critical fix agreed with the owner.

**The runtime role step failed** (the output's last line starts with `runtime role:`): every migration is applied and nothing needs `migrate resolve`. The live API keeps serving meanwhile.
- **A problem with `POSTGRES_APP_PASSWORD`** (the shape, `openssl rand -hex 32`; a placeholder; the superuser's value; missing). `deploy.sh` refuses a malformed value before `--first`, so this is rare. The value is also PgBouncer's password, so changing it is a data-service change that `deploy.sh` refuses to make:
  - before the first release: fix `.env`, run `$DC up -d --no-deps --no-build pgbouncer`, then the deploy;
  - with a live release (also a planned rotation): under maintenance (section 4), fix `.env`, then `$DC up -d --no-deps --no-build pgbouncer`, `$DC run --rm --no-deps migrate` and `$DC up -d --no-deps --no-build api worker`.
- **`55P03`** (another migrate run held the database for over 30 s) or another database code: run the deploy again (`scripts/deploy.sh "$sha"`).
- **`sirat_app cannot read N table(s) and lacks M default privilege(s)`**: the same commit can never pass. Deploy a new commit with a reviewed repair migration: the runtime_role migration's two `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT … TO sirat_app` statements, plus `GRANT SELECT, INSERT, UPDATE, DELETE` on the tables it cannot read. The script takes UPDATE and DELETE back on the append-only ones.

## 3. Scale API replicas

```bash
$DC up -d --no-deps --no-build --no-recreate --scale api=<n> api   # VERIFIED (1 -> 2): nginx picks up new replicas without a restart
```

## 4. Maintenance mode

**The switch (L5):** while the flag file `infra/nginx/maintenance/on` exists (in the clone, git-ignored), nginx answers the public site with a 503:
- pages, whatever the method: the bilingual page `infra/nginx/pages/maintenance.html` ("we'll be right back", and "if you just paid, your payment is safe; we confirm it automatically");
- other `/api` calls: JSON `{"statusCode":503,"code":"MAINTENANCE",...}`;
- both with `Cache-Control: no-store` (Cloudflare keeps neither), `Retry-After: 120` and the security headers.

**Still passing:** `/healthz`, the PayStation IPN (it records and queues; PayStation retries) and the callback (it records the return; the result page it leads to shows the maintenance page). The worker keeps confirming payments. nginx looks for the file on every request: no reload, no restart.

```bash
scripts/maintenance.sh on        # maintenance: on (since <UTC time>)
scripts/maintenance.sh status    # maintenance: on (since ...) | maintenance: off
scripts/maintenance.sh off
# Checks from the server go through the internal listener, which the switch never affects:
$DC exec -T nginx wget -qO- http://127.0.0.1:8081/api/ready   # {"status":"ready"} while visitors see the page
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/    # 503 while on, 200 after off
```

- **The script** touches only the flag file and never runs up, down or restart. It refuses `on` while the page is not world-readable: nginx's workers read it, so keep the clone at umask 022.
- **The same page replaces nginx's own 502/504** on pages and on the PayStation callback (the status stays 502/504), so a deploy gap or a stopped web shows it too. Other `/api` calls keep their JSON errors.
- **When:**
  - the kill switches, in order: `registration_open=false`, then maintenance on, then `deploy.sh --rollback` (L9);
  - a restore (section 5);
  - a critical fix during an incident.

  Not during a live exam window without the owner: students keep answering in the browser, but their final submit would get the MAINTENANCE answer.
- **Tests:** `infra/nginx/test/check-maintenance.sh` (its own containers and fake upstreams; CI's docker job), and a CI step on the stack.

## 5. Backup and restore

**Backups (L6):** encrypted with age, copied off the server with rclone, checked, with a heartbeat. `scripts/backup.sh` runs as root from `sirat-backup.service`, which its timer starts hourly while registration is open, and which `deploy.sh` starts before migrate.

```bash
sudo systemctl start sirat-backup.service          # a backup now; a failure exits non-zero (and stops a deploy)
sudo /srv/sirat/scripts/backup.sh --accept-smaller # once, by hand, after a deliberate big delete (see below)
sudo journalctl -u sirat-backup.service -n 30      # what the last runs did
sudo systemctl start sirat-backup-verify.service   # newest local copy: sha256 vs manifest, an age file, < 26 h old
sudo ls -l /var/backups/sirat                      # the newest 3 encrypted copies (.dump.age) and their manifests
systemctl list-timers 'sirat-backup*'              # next runs
bash scripts/test/run-backup-test.sh               # the tests (own compose project sirat-backup-test; dev machine or CI)
```

- **A run:**
  1. takes a lock (`/var/lib/sirat/backup.lock`; `deploy.sh` waits on it);
  2. runs `pg_dump -Fc` inside the postgres container (credentials stay there);
  3. reads the whole archive back, counting every table's rows and the applied migrations;
  4. refuses a dump under half the size of the last one;
  5. encrypts it to the public keys in `infra/backup/recipients.txt`, and writes a manifest (`created_at`, `sha256` of the encrypted file, `tables`, `migrations`);
  6. stores the copy locally, then uploads the dump and then the manifest into tier prefixes:
     - every run → `hourly/`;
     - the first run of the Asia/Dhaka day at or after 03:00 → also `daily/` (a failed 03:00 run is made up by the next one);
     - that run on a Sunday → also `weekly/`;
  7. keeps the newest 3 locally;
  8. pings the heartbeat.

  A failure pings the heartbeat's `/fail` with the failed step's name and exits non-zero:
  - before the store step it leaves no new copy;
  - a failed upload keeps the local encrypted copy, which was stored first;
  - a run killed mid-dump leaves its partial plain dump in an owner-only `.work.*` directory under `/var/backups/sirat` until the next run removes it.
- **Setup on the VPS (root, once):**
  1. `apt install age rclone`.
  2. `/etc/sirat/backup.env` from `infra/backup/backup.env.example`, `chmod 600` (refused otherwise); `BACKUP_PROJECT=sirat`.
  3. `/etc/sirat/rclone.conf` (`chmod 600`) with the bucket's **put-only** key (owner Q1), named by `RCLONE_CONFIG`; the remote in `BACKUP_REMOTE`.
  4. The heartbeat URL (outside service, LAUNCH-PLAN §6) in `BACKUP_HEARTBEAT_URL`.
  5. The key holders' public keys in `infra/backup/recipients.txt`, by pull request.
  6. Copy the four units from `infra/backup/` to `/etc/systemd/system/` (they expect the clone at `/srv/sirat`), then `systemctl daemon-reload && systemctl enable --now sirat-backup.timer sirat-backup-verify.timer`.
  7. Start one run and see the copy in the bucket.
- **Until the bucket exists:** `BACKUP_REMOTE=none` keeps local copies only, warns "NOT off the server" and pings nothing. Launch needs the off-server copy (LAUNCH-PLAN §7).
- **After registration closes, go daily:** `systemctl edit sirat-backup.timer` with `[Timer]`, `OnCalendar=`, `OnCalendar=*-*-* 03:30 Asia/Dhaka`. Then set the heartbeat's expected period to about 26 h.
- **Decrypt** (a key holder, never on the server): `age -d -i <key file> sirat-<stamp>.dump.age > sirat.dump`. Compare `sha256sum` of the `.age` file with the manifest first.
- **Retention off the server (Q1):** the bucket's versioning and lifecycle rules, not the script (the put-only key cannot delete). Three lifecycle rules:
  - prefix `hourly/`: expire objects 2 days after creation;
  - prefix `daily/`: expire after 8 days;
  - prefix `weekly/`: expire after 35 days;
  - on all three, delete noncurrent versions after 1 day.

  That keeps 7 daily and 4 weekly copies (RULEBOOK §6) plus 2 days of hourly ones.
- **"The dump is much smaller than the last one":** the run stops when a dump is under half the size of the last one, because a sudden drop usually means lost data. After a deliberate big delete (the first run of the session and token cleanup job, a test-data wipe), check that the drop is expected, then run `sudo /srv/sirat/scripts/backup.sh --accept-smaller` once by hand. It logs that it was used; the timer never passes it, and the next timed runs compare with that copy.

**Restore (L7):** `scripts/restore.sh`, as the deploy user from the clone. It never overwrites a database: a rebuilt server restores into the empty database of a fresh volume, and a server still up restores beside the live database, then swaps the names.

```bash
age -d -i <key file> sirat-<stamp>.dump.age > sirat.dump   # a key holder, never on the server; sha256 against the manifest first
scripts/restore.sh sirat.dump --project sirat                # a rebuilt server: the EMPTY database of a fresh volume
scripts/restore.sh sirat.dump --project sirat --mode beside  # the server is up: into <db>_restore_<stamp>, then swapped;
                                                             # the old database stays as <db>_old_<stamp>
$DC exec -T nginx wget -qO- http://127.0.0.1:8081/api/ready   # {"status":"ready"} (the script checks it too)
scripts/maintenance.sh off && scripts/healthcheck.sh https://<domain>
```

- **What the script does:**
  1. reads the whole archive (a truncated dump stops it before anything changes);
  2. says the project, the database and the server marker, and asks for the project name to be typed (a server marked as development is refused without `--allow-dev`);
  3. maintenance on; stops web, api and worker, while nginx shows the maintenance page;
  4. makes sure `sirat_app` exists: roles are not in a dump (`prisma/runtime-role.ts --ensure`);
  5. restores in one transaction, without `--clean`;
  6. clears `sessions` and `auth_tokens` (everyone logs in again);
  7. runs migrate, which puts back the database timeouts and `sirat_app`'s restrictions, CONNECT and login;
  8. checks `statement_timeout` 10s in a new session, `sirat_app`'s grants and CONNECT, and the migrations;
  9. flushes the cache, starts the app and checks it through the internal listener: three good rounds in a row of
     `/api/ready` and the home page, within 30 s (the restarted containers may have new addresses, which nginx
     picks up within 10 s; the same settle as `deploy.sh`).

  Maintenance stays on for a person to check.
- **By hand, after a restore:**
  - rotate `JWT_ACCESS_SECRET` in `.env` and recreate api and worker;
  - compare the payments since the dump time minus 1 h with a PayStation export (section 11);
  - with `--mode beside`, drop `<db>_old_<stamp>` once nothing more is needed from it.

  While the API is stopped, PayStation's IPN gets nginx's JSON 502 and is retried; reconciliation catches anything missed once the worker is back. After a restore, also check the free book's cover: `GET /api/book/cover/<id>` (the id is `settings.book_cover_image_id`). Covers live in Postgres (`book_images`), so the dump carries them.
- **The drill** (`scripts/restore-drill.sh`), on another machine than the server, before every exam and before registration opens:

  ```bash
  scripts/restore-drill.sh --age sirat-<stamp>.dump.age --manifest sirat-<stamp>.manifest.json --identity <key file> [--tag <sha>]
  ```

  - **The copy:** its sha256 is checked against the manifest, then it is decrypted into an owner-only directory.
  - **The drill project** `sirat-drill`: its own volumes, throwaway secrets, payments off, email only to Mailpit, nginx and Mailpit on 127.0.0.1 only. It refuses a port bound beyond 127.0.0.1.
  - **The restore** with `restore.sh`, then the checks:
    - every table's row count against the manifest;
    - the triggers;
    - `sirat_app`'s grants and default privileges;
    - `statement_timeout` 10s;
    - the audit log refusing a delete;
    - one login as `sirat_app`.
  - **The wipe:** `down -v`, only after checking each container's project label; it never touches project `sirat`. It prints the measured time.
  - The images must be of the dump's release (`--tag`); the drill never builds.
- **The drill never reads the clone's `.env`:** the drill's api and worker take their settings only from the drill's own throwaway file (`infra/backup/drill.compose.yml` replaces compose's `env_file: ../.env` with it). The script refuses to start unless both resolve the drill's own secret, compared and never printed. On a server, the clone's `.env` holds the production secrets.
- **Tests:** `bash scripts/test/run-restore-roundtrip.sh` (CI's docker job runs it):
  - a source in its own project gets admin A, then a dump is taken, then admin B is created;
  - the drill restores the dump: A logs in (204), B does not (401);
  - then `--mode beside` restores over the running drill, keeps the old database, and the logins answer the same.

Credentials are read inside the postgres container; nothing secret is typed on the host.

## 6. Rebuild on a fresh VPS (< 1 hour)

`scripts/bootstrap.sh` (L12), as root on a fresh Ubuntu 24.04 host. It is idempotent: every step looks first, and a run with nothing left to do prints `0 change(s) made`. Run it again after each owner step below.

```bash
# On the new host, as root (copy the script over, or take it from any checkout).
bash bootstrap.sh --dry-run --authorized-keys keys.pub   # what it would change; changes nothing
bash bootstrap.sh --authorized-keys keys.pub             # keys.pub: the owner's and one backup person's public keys
# It ends with what is left for the owner:
#   - deploy's public key on GitHub as a READ-ONLY deploy key; run bootstrap again (it clones /srv/sirat)
#   - the values in /srv/sirat/.env, .env.deploy (the GitHub token), .env.monitor (the heartbeat URL) and
#     /etc/sirat/backup.env (section 5); run bootstrap again (it enables the backup timers once the remote is set)
#   - the provider's firewall panel: only 22, 80 and 443
# Then, as deploy (sudo -iu deploy; cd /srv/sirat):
git fetch origin && git checkout --detach <sha on main>   # the commit to deploy first
scripts/deploy.sh --first && scripts/deploy.sh <sha>       # section 2 (the origin certificate first: section 15)
# A rebuild after a loss: restore the newest backup before opening (section 5). Then the checks:
scripts/prelaunch-check.sh
```

- **What it sets up:**
  - Docker from Docker's own apt repository;
  - UTC with chrony (the monitor's 02:00 UTC digest is 08:00 Asia/Dhaka);
  - swap and `vm.overcommit_memory=1`; security updates without automatic reboot;
  - the `deploy` user, in the docker group, with SSH keys only. Root and password logins go off only once deploy has keys (no lockout), and `sshd -t` checks the change first;
  - UFW for the host, plus `sirat-docker-user.service`: Docker's published ports bypass UFW, so from outside only 80 and 443 may reach a container;
  - fail2ban for SSH;
  - the clone in `/srv/sirat` through a read-only deploy key, with GitHub's host key pinned;
  - `/var/lib/sirat`;
  - `.env`, `.env.deploy`, `.env.monitor` and `/etc/sirat/backup.env` from their examples, mode 600, never overwritten;
  - the four backup units;
  - the monitor's two cron lines (`/etc/cron.d/sirat-monitor`, output in the journal under `sirat-monitor`);
  - one sudo rule: `deploy` may run `systemctl start sirat-backup.service`, and nothing else (checked with `visudo -cf`).
- **The deploy key is a root key:** `deploy` is in the docker group, which is root-equivalent, so the sudo rule limits sudo, not real power. Keep deploy's SSH keys on few machines, each with a passphrase. When a person leaves, remove their line from `/home/deploy/.ssh/authorized_keys` (and from the `--authorized-keys` file bootstrap is run with) the same day.
- **Tests:** `bash scripts/test/run-bootstrap-test.sh` (an Ubuntu 24.04 container; CI runs it). It covers the dry run, the no-lockout rule, the whole setup, a second run that changes nothing, and an edited `.env` that is kept. Its first full run on a real host is the VPS (owner question Q4 without a VM), timed against the one-hour target.

## 7. Exam-day incident steps

**Ops alert → what to do** (`[Sirat] Ops alert:`; `level: 2` critical, `1` warning, `0` resolved; the same kinds are in the heartbeat's `/fail` body):

| Check | Means | First steps |
|---|---|---|
| `disk` | 80% used (warning), 90% (critical) | `df -h`; `docker system df`; prune old images (`docker image prune -a` after a deploy); old local backups are only 3 |
| `swap`, `memory`, `cpu` | swap in use; memory or CPU above 85% on two checks (memory over 95%: critical) | `docker stats --no-stream`; find the service; scale or restart it (section 3); before an exam, L14's sizing |
| `containers` | a service not running or unhealthy on two checks | `$DC ps -a`; `$DC logs --tail=100 <service>`; `$DC up -d --no-deps --no-build <service>` |
| `workers` | a job queue (email, payments, exam) has no worker on two checks | `$DC ps worker`; `$DC logs --tail=100 worker`; `$DC up -d --no-deps --no-build worker`. Payments are confirmed only by the worker: critical |
| `queue_backlog` | over 500 waiting, or the oldest over 5 min (warning); a payments or email job waiting 15 min while workers are connected (critical: a stuck worker) | worker logs; restart the worker; the queue Redis memory |
| `failed_jobs` | jobs failed for good since the last check (a payment verify job: critical) | worker logs by job name; payments: the review list (section 11). An exam `sweep` job fails when one of its items failed: `$DC logs worker \| grep 'exam sweep item failed'` names the step (finalize, score, build) and the attempt or exam id; every other item went on, and the next minute's sweep tries again |
| `reconciliation` | the payments reconciliation is more than 3 intervals late | worker running? `$DC logs worker \| grep reconcile` |
| `queue_redis_memory` | the queue Redis over 300 MB (warning), 400 MB of 512 (critical) | failed jobs piling up; `redis-cli INFO memory` in `redis-queue` |
| `http_5xx` | over 2% (warning) or 10% (critical) of at least 50 requests in 5 min | `$DC logs --since 10m nginx api`; `/api/ready`; recent deploy? |
| `password authentication failed for user "sirat_app"` (pgbouncer log) | the role's password no longer matches PgBouncer's (any role may change its own; an injected `ALTER ROLE`): every new database connection fails, while PgBouncer stays healthy | `$DC run --rm --no-deps migrate` sets the `.env` value again; then `/api/ready`. If the `.env` value itself changed, section 2 |
| `database busy` (api log, warn) | the database refused for a passing reason (Prisma P2028/P2034/P2024 or a lock or statement timeout): the request answered **503 `SERVICE_BUSY`** with `Retry-After: 2`, nothing was applied, and the registration wizard retried once by itself | a few under a surge are expected. Many, or for minutes: the API is CPU-bound or the pool is too small (`docker stats`; `connection_limit` in `DATABASE_URL`; scale API replicas, section 3). A plain `unhandled error` (500) is a different thing: read its class |
| `app_errors` | API 5xx or web render errors in the logs | `$DC logs --since 10m api web` |
| `api_p95` | the API's p95 over 1 s | "Site slow" below |
| `certificate` | the origin certificate ends within 14 days | section 3 of LAUNCH-PLAN / the TLS steps in this runbook |
| `backup_age` | no off-server backup in 26 h (critical) | `journalctl -u sirat-backup.service -n 50` (section 5) |
| `time_sync` | the clock is not synchronised | `timedatectl`; `systemctl restart systemd-timesyncd` |
| `monitor` (heartbeat only) | ops-check could not run | the api container: `$DC ps api`, `$DC logs --tail=50 api` |

**Site slow:** `docker stats` (CPU/RAM) → PgBouncer waiting clients (`SHOW POOLS;`) → slow queries (log > 500 ms) → queue depth/failed jobs (BullMQ) → API p95 in monitoring → consider `--scale api=N`, then tell the owner.
**Site down:** `$DC ps` → Nginx logs → `df -h` (disk full?) → Postgres/Redis health → restart failing service → if data loss suspected, restore plan (section 5).
**`/api/ready` returns 503:** `$DC logs --tail=50 api | grep "readiness failed"` names the dependency (database, redisCache, redisQueue); check that container.
**Logs say "rate limiter unavailable":** the cache Redis is down or slow; the API keeps serving (fail-open) but the per-user and per-IP limits are off until it is back. Restart `redis-cache`.
**Students wait on "Signing you in again…" and the API log shows 503s on `/api/auth/refresh`:** the database was too slow for a session renewal to commit within `REFRESH_ROTATION_BUDGET_MS` (8 s), or its 5 s `lock_timeout` cut a wait. Each renewal was rolled back: nobody is logged out, the old cookies still work, and the browsers retry with a growing pause. Look at database load and connections; do not raise the budget during an exam (at most 10 s, and only with `$DC up -d api`).

**Dashboards show the error page (not the login page):** the web cannot read the session: `GET /api/auth/me` timed out (5 s), was rate limited or the API is down. The web log has one `ServerApiError` line per failure (class and status only). Check `/api/ready` and the API's 429s. A 429 behind this page always comes from the API, because the web asks `/auth/me` server-side, not through nginx: either the user's own limit on `/auth/me` (`API_LIMIT_PER_USER_PER_MINUTE`, 120 per route) or, for a cookie that does not verify, the client IP's 600.
**Clients get 429:** a JSON body with code `TOO_MANY_REQUESTS` and `Retry-After: 1` comes from nginx `limit_req`; a JSON body from the API (`ThrottlerException`) comes from a signed-in user's own limit (120 per route), the per-IP default for anonymous requests (600) or a route tier (forgot-password 120, resend/reset/verify 300, refresh 3,000). Many nginx 429s for one school or mobile operator come from its per-IP zones (`auth` 20 r/s, `api` 30 r/s; DECISIONS "Per-user API limits"). If a whole school is limited by the API, check that real client IPs are restored (section 10).
**"Security alert" email or `security.login.*` audit rows:** `login.account_limit` means one account failed 50 times within an hour (only IPs that failed are refused; the student can still log in from another network or reset the password); `login.distributed` means failures on one account from more than 20 IPs within an hour (nothing is blocked). Look the account id up in `audit_logs`; if it repeats across many accounts, consider Cloudflare Turnstile on login (DECISIONS). Alert emails pause 10 minutes per kind and stop at the hourly cap of their category; the audit log has every event.

**Alert emails (L10):**
- **Categories:** every alert has one category, and its subject names it: `[Sirat] Security alert:` (logins), `[Sirat] Payments alert:` (`payments.*`), `[Sirat] Ops alert:` (`ops.*`: backups, server checks, the drill).
- **Caps:** each category has its own hourly cap (`SECURITY_ALERT_EMAILS_PER_HOUR`, 6 each by default, owner Q2), so a flood of failed logins never silences a payment or backup alert. Within a category, each kind pauses 10 minutes after an email.
- **The record:** the audit log (`security.<kind>`) has every event, mailed or held back.
- **A blank `SECURITY_ALERT_EMAIL`** on a production server logs a boot warning (`SECURITY_ALERT_EMAIL is blank`) in the api and worker logs: then no one is emailed.
- **From a script or by hand** (ops kinds only, numeric details only):

  ```bash
  $DC exec -T api node dist/cli/ops-alert.js --kind ops.alert_test --meta drill=1   # the fake-alert drill: one Ops alert email
  ```

  `backup.sh` raises `ops.backup_failed --meta step=<n>` (with the step names in `scripts/backup.sh`) on any failure, after pinging the heartbeat's `/fail`. When the API cannot raise it, the backup still fails, and the heartbeat is the alert.
**A student cannot log in ("Too many attempts"):** the account is locked for their IP (10 failures in 15 min; 15 min, doubling on repeats up to 4 h) or reached 50 failures in an hour. The fastest fix is a password reset: completing it unlocks the account at once, on every IP. Logging in from another network (mobile data) also works, since other IPs are not locked. A whole school refused at once usually means its IP reached `LOGIN_IP_FAILURES_PER_MINUTE` (100 failures per minute); it clears within a minute. Limits are set in `.env` (`LOGIN_*`) and need `$DC up -d api` (never during an exam). Audit rows `auth.login_locked` show when locks started.
**More log detail:** set `LOG_LEVEL=debug` in `.env` and `$DC up -d --no-deps --no-build api` (default `info` in production). **Never during an exam:** this recreates every API replica at once (and re-runs migrate first), a full API outage of about 10–20 s. Container logs rotate at 50 MB × 5 per container.
**Payments stuck:** admin → Payments → lookup by invoice/trx/phone → manual reconcile (audit-logged). Money taken but DB says unpaid is the worst case: alert on any `pending` beyond expiry.
**Submissions failing:** check `/api/ready`, Redis queue instance, API logs for 5xx; clients retry with backoff and keep local copies, so fix fast rather than patch hastily.

## 8. Contacts (fill in)

Client: — · PayStation support: — · Email provider: Amazon SES (AWS account / support plan: —) · Hostinger support: — · Cloudflare: — · Owner (Rasel Mridha): —

## 9. Pre-launch checklist (T-7 → T-0)

**This launch (registration and payment, 15 Nov; LAUNCH-PLAN section 12):**
- **Sat 7 Nov:** on the VPS, in the order of section 6: bootstrap, the origin certificate, `deploy.sh --first`, Cloudflare and the firewall, the first release, the first admins, an outside port scan.
- **Sun 8 – Mon 9:** on the VPS:
  - the rehearsals: deploy, a second deploy, a forced rollback, a reboot, maintenance on and off;
  - the backup timers, the first off-server copy, a failure alert;
  - the outside monitors and a fake alert;
  - the real-IP check on the three mobile operators.
- **Tue 10 – Wed 11:**
  - a restore drill on another machine;
  - k6 with simulated shared IPs;
  - the live merchant and one real payment.
- **Thu 12, the release candidate:** `scripts/prelaunch-check.sh` with every line PASS (registration still closed) and the MANUAL lines done. It is the last day for non-critical deploys.
- **Fri 13:** the freeze, from 00:00 (48 h). Rehearse the kill switches in order, each checked through the internal listener:
  1. `registration_open=false`;
  2. maintenance on (section 4);
  3. `deploy.sh --rollback` (section 2).

  After maintenance off, the public smoke must pass.
- **Sat 14:** Rasel's go/no-go. A fresh backup minutes before opening; then registration opens through the audited admin setting, and someone watches the alerts.

**The checks:**
- [ ] `scripts/prelaunch-check.sh` on the VPS (`--registration closed` until opening, `open` after): every line PASS, never a value printed. It checks:
  - only nginx publishes ports;
  - `.env` mode 600, `APP_URL` https, `COOKIE_SECURE` not false;
  - the runtime role (not the database owner); no development marker; no Mailpit;
  - every app container on the recorded release; migrations up to date; the worker healthy;
  - each API's PayStation boot line (live, the client's account and prefix, https callback and IPN);
  - no fixture users, no test invoices, no published exam, the fee 40000, `registration_open` as intended;
  - an off-server backup under 26 h old; SES; the page CSP;
  - real client IPs through Cloudflare; the Cloudflare list under 90 days old;
  - disk, swap and the clock.

  Its MANUAL lines are the items below.
- [ ] Cloudflare settings and TLS (section 15); the page CSP; an outside port scan shows only 22, 80 and 443.
- [ ] Deploy, rollback and maintenance rehearsed on the VPS (sections 2 and 4).
- [ ] An off-server backup and a passed restore drill (section 5); the runtime role (below).
- [ ] The outside monitors, and a fake alert received (section 7).
- [ ] The contacts filled in (section 8); the release SHA green on `main`.

See `RULEBOOK.md` section 13: load test at 1.5–2× peak, backup + restore drill, 48 h code freeze, patches before freeze, monitoring + fake alert, Cloudflare verified, email deliverability, real small PayStation payment, rollback rehearsed, owner watching dashboards.

Also before launch:
- [ ] The API connects to Postgres with a **non-superuser runtime role** (OPEN-QUESTIONS #27); the bootstrap superuser is used only for migrations, backup and restore. Check: `$DC logs api worker | grep "database role="` shows only `role=sirat_app superuser=false` (production refuses to boot as a superuser).
- [ ] PayStation sandbox checklist done (`docs/paystation/SANDBOX-CHECKLIST.md`) and the accepted `trx_status` values confirmed.
- [ ] `PAYSTATION_ENV=live` on the VPS, and the boot log's PayStation line matches the client account: `$DC logs api | grep "PayStation env="` shows `env=live`, the live host, the client's account label and invoice prefix, and the production callback and IPN URLs. It never shows any part of the merchant id or password. A `payments are DISABLED` WARN, or a `payments.disabled_in_production` alert, means PAYSTATION_ENV is blank: no registration can be paid.
- [ ] The free book: an admin has set the real title and uploaded the cover (`/admin/book`), before registration opens.
- [ ] `paystation:selfcheck` on the VPS ends with `initiate: created` and exits 0. It leaves one unpaid 10 BDT `X…` invoice in the client's panel. The command: `$DC run --rm --no-deps -T api node dist/cli/paystation-selfcheck.js`; locally `pnpm --filter @sirat/api paystation:selfcheck`.
  - Exit 2 means the settings are wrong or payments are disabled; the line says which variable and rule.
  - `credentials rejected (status_code 1001)` means a wrong merchant id or password, or the wrong `PAYSTATION_ENV` for the account. The merchant id must be used exactly as issued, with any "-".
- [ ] Cloudflare real-IP list refreshed (section 10).
- [ ] Email: SES set up as in section 12 (domain verified with DKIM, MAIL FROM, DMARC, production access granted), `EMAIL_PROVIDER=ses` with the IAM user's keys, `EMAIL_FROM` on the verified domain, one real test email received, and `$DC ps worker` healthy.
- [ ] `SECURITY_ALERT_EMAIL` is an inbox someone reads during exams, and `APP_URL` is the public web origin (email links).
- [ ] The first admin exists (section 13): one account per person, never shared, its password only in that person's password manager.
- [ ] The VPS `.env` has its own `JWT_ACCESS_SECRET` (`openssl rand -base64 48`) and no `COOKIE_SECURE=false` (the API refuses it with `NODE_ENV=production`).

## 10. Cloudflare real-IP list (refresh every few months and before each exam)

```bash
scripts/refresh-cloudflare-ips.sh     # VERIFIED: validates both lists, nginx -t on the pinned image, then rewrites the file in place
$DC exec nginx nginx -c /etc/nginx/sirat/nginx.conf -t && $DC exec nginx nginx -c /etc/nginx/sirat/nginx.conf -s reload
```
The container mounts the whole `infra/nginx` folder, so it sees the new file at once, with no recreate. To confirm:
```bash
[ "$($DC exec -T nginx grep -c '^set_real_ip_from' /etc/nginx/sirat/cloudflare-realip.conf)" = "$(grep -c '^set_real_ip_from' infra/nginx/cloudflare-realip.conf)" ] && echo same-list
```
The script refuses (exit non-zero, live file untouched) when a download fails, returns anything that is not a CIDR, or has fewer than 10 IPv4 / 5 IPv6 ranges. Never edit `infra/nginx/cloudflare-realip.conf` by hand and never paste the old one-liner: it wrote an empty list when the download failed, which made every student behind a Cloudflare edge share one rate-limit bucket.
After go-live, confirm in the nginx access log that client addresses are real users, not Cloudflare edges. If Cloudflare reaches the origin over IPv6 while the compose network has none, Docker replaces the source address and real-IP restore cannot work: keep the origin A-record-only.

## 11. Payments: the review list, refunds and manual reconciliation (PayStation has no refund API)

**Where to look:** `GET /admin/payments?review=1` (admin only) lists every payment set aside for a person; `GET /admin/payments/:id` shows its events (every PayStation answer, callback and IPN, stored redacted). Look up by `invoice`, `trx`, `phone` (any Bangladeshi form) or `email`. Every admin action is in the audit log with the admin's id and IP. A critical case also raises `security.payments.needs_review` (audit log, and the operator email when `SECURITY_ALERT_EMAIL` is set).

**First step for any case: re-check.** `POST /admin/payments/:id/recheck` asks PayStation now (the worker; usually a few seconds); reload the payment and read the newest `status_v1` event.

**By review reason** (no refund handling in the app, owner 2026-10-31: refunds are done outside it):

| Reason | What it means | What to do |
|---|---|---|
| `success_without_trx_id` | PayStation said success with our invoice and amount, but no `trx_id` | Find the transaction in PayStation's merchant panel. If it is there and paid, `POST /admin/payments/:id/reconcile { trxId, reason }` (the only manual "paid"; it refuses anything else). The account is made as usual |
| `email_taken`, `phone_taken` | Paid, but an account got that email or phone meanwhile; no account was made, the attempt is `conflict` | Contact the student (the attempt's email/phone in the payment view). If the existing account is theirs, the money is a duplicate: refund it outside the app (below). Otherwise ask the owner |
| `duplicate_payment` | A second paid payment for an attempt that already has an account (same user) | Refund the second payment outside the app (below) |
| `abandoned_attempt_paid` | A late success on an attempt the student gave up (they may have started again) | Look up the student's other attempts by email/phone. If they have an account now, refund this payment; if not, ask the owner before anything else |
| `amount_mismatch`, `invoice_mismatch` | PayStation reported another amount or another invoice | Never mark it paid. Contact PayStation support with the invoice number and `trx_id`; record the case |
| `trx_id_reused` | The `trx_id` already belongs to another payment | A fraud or mix-up signal. Do not reconcile. Compare both payments in PayStation's panel; contact PayStation support |
| `refund_reported` | PayStation reports `refund` for a paid payment | The payment stays `paid` (the app has no refund state). Confirm in the panel; what happens to the student's access follows the owner's policy (OPEN-QUESTIONS P8): ask the owner |
| `late_success` | Paid after its checkout expired; the account was made normally | Nothing, unless the student also paid again (then `duplicate_payment` appears) |
| `account_mismatch` (event, no review reason) | The payment was started on another PayStation account (after a switch, PAYMENTS-PLAN §13) | Check it in that account's panel; handle by hand |

**Refund a payment (outside the app)**
1. Find the payment by invoice number, `trx_id` or phone; its status is `paid`.
2. Refund it in the PayStation merchant panel, or ask PayStation support. Keep their refund reference.
3. Re-check: the event shows `refund_reported`; the payment stays `paid`. Never delete the payment, its events or the registration row.
4. Record the refund reference and the reason with the case (audit log / support notes).

**Money taken but the payment still shows unpaid**
1. Re-check. If PayStation now reports success with our invoice and exactly our amount, the re-check marks it paid and makes the account; nothing else to do.
2. If it reports success without a `trx_id`: the reconcile row above.
3. If the amount or the invoice does not match, or `2001` keeps coming back: do **not** mark it paid. Contact PayStation support with the invoice number and `trx_id`.

**The free book's courier list:** `GET /api/admin/book-orders/export.csv?status=confirmed` (admin only; audited with the filter and the row count). It holds minors' addresses and phone numbers: hand it to the courier, then delete the downloaded file. Nothing is stored on the server. After the pickup, mark those orders shipped (`POST /api/admin/book-orders/ship`); from then on the student cannot change the address. **Marked shipped by mistake:** it cannot be undone (the trigger `book_orders_locked_after_shipping` locks the order, by design). Do not edit the database: record the case in the courier sheet (the order code, what was wrong, the right address from the student) and handle it by hand with the courier.

**The checkout time limit** (`payment_expiry_minutes`, default 10) equals PayStation's checkout-link lifetime. In the sandbox the link dies after about 10 minutes (S12), and v1 then still says `processing`. A longer limit would offer "Continue payment" on a dead link.
- **Re-measure it on the client's live account** in the account-switch check (PAYMENTS-PLAN §13): make one unpaid checkout, and open its link every minute until it says "Invalid or Expired Token".
- If the lifetime differs, set the setting to it in `/admin/settings` (it is audited). Never set it shorter than the lifetime (D3).
- A payment finished just before the limit is not lost: the IPN, the callback or reconciliation within the 48 h late watch still marks it paid (`late_success`).

**Changing the fee or the registration window:** `PUT /admin/settings/:key` with the value the form showed as `expected` (409 if someone changed it meanwhile); the fee needs a reason. Payments already started keep their amount.

## 12. Email (Amazon SES)

The `worker` service sends; the API only queues. Locally every email goes to Mailpit (http://127.0.0.1:18025), whatever `.env` says.

**One-time setup** (AWS console, one region close to the users, e.g. `ap-south-1`):
1. SES → Identities → create a **domain** identity for the sending domain with **Easy DKIM**; add the DKIM CNAMEs in Cloudflare (DNS only, not proxied) and wait for "Verified".
2. Set a **custom MAIL FROM** subdomain (e.g. `mail.<domain>`) and add its MX and SPF TXT records. Add a **DMARC** TXT record on `_dmarc.<domain>` (start with `p=none; rua=mailto:...`, tighten later).
3. Request **production access** (new accounts are in the sandbox: verified recipients only, low quota).
4. IAM → create a user with no console access and only this policy, then an access key for it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:<region>:<account-id>:identity/<sending-domain>",
      "Condition": { "StringLike": { "ses:FromAddress": "*@<sending-domain>" } }
    }
  ]
}
```

   While the account is still in the sandbox, SES may also check the verified recipient's identity: if sends fail with an access error, add that identity's ARN to `Resource` until production access is granted.
5. In the VPS `.env`: `EMAIL_PROVIDER=ses`, `EMAIL_FROM=Sirat Olympiad <no-reply@<sending-domain>>`, `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`. Then `$DC up -d --no-deps --no-build worker`. The worker refuses to start with a missing or malformed setting; `$DC logs worker` names the variable, never its value.

**Key rotation:** create a second access key for the IAM user → put it in `.env` → `$DC up -d --no-deps --no-build worker` → check `$DC logs worker` for `email sent` → deactivate, then delete the old key.

**Failed emails:** `$DC logs worker | grep 'email attempt failed'` shows kind, job id, attempt and the SES error name (never the address). Each job is tried 8 times over about 2 hours; failed jobs are kept 3 days. Users can always ask for the email again (resend verification, forgot password).

## 13. Admin accounts (create-admin CLI)

There is no sign-up for admins and the web never accepts a role, so an operator creates every admin from the command line, at a terminal. The password is typed at a hidden prompt, twice. It is never an argument, an environment variable or a log line.

```bash
# VPS. The runtime api image has no tsx (its src/ cannot run), so this runs the compiled CLI from dist/.
# No -T: the hidden prompt needs the terminal that `run` gives. --no-deps: otherwise compose runs `migrate` again first.
$DC run --rm --no-deps api node dist/cli/create-admin.js --email ops@example.org --name "Ops Admin"
#   Password:              <- type it; nothing shows on screen
#   Repeat the password:   <- the same again; nothing shows
#   Admin created: <id>    <- the new user id, nothing else

# Check the audit row (the SQL goes through stdin, hence -T here)
$DC exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
select created_at, entity_id, meta from audit_logs where action = 'admin.created' order by created_at desc limit 5;
SQL

# Local (uses apps/api/.env; on Windows run it in PowerShell or Windows Terminal)
pnpm --filter @sirat/api admin:create --email ops@example.org --name "Ops Admin"
```

- The password must pass the same policy as everyone's (8–128 characters, not on the common-passwords list) and is hashed with argon2id. The account gets role admin and a verified email (no verification email). An `admin.created` audit row records it (`meta.via = cli`). The CLI prints only the new user id.
- An email that already has an account is refused and nothing changes: the CLI never promotes, edits or resets an existing account.
- Without a terminal (for example with `-T`) it stops at once with exit code 2. `--password-stdin` (first line of piped stdin) exists for the automated tests only: a piped password usually ends up in shell history.
- Exit codes: 0 created, 1 refused (password policy, existing email, invalid email or name), 2 usage (any `--password` argument, no terminal), 130 cancelled (Ctrl+C).
- Blocking an admin or changing a role: not built yet (admin features, later in Phase A).

## 14. Students list export (admin CSV)

The students' personal data (many are minors) leaves the system only through this export. Admins only.

- **Where:** `/admin/users` → set the search and filters → "Export CSV" → write the reason (3–200 characters) → "Download CSV". The file holds the rows the page shows, students and ambassadors only, never staff.
- **On the record:** every export writes the audit row `users.exported` before the file starts: admin, IP, the filters (a search term only as its kind: name, email, phone or invoice), the row count and the reason. No audit row, no file (503).
- **Limits:** 5 exports per admin per hour (429 after that, refused requests count too); at most 50,000 rows (400 `too_many_rows`: narrow the filter).
- **Handling the file:** keep it on the admin's own computer only, never in a shared drive, chat or email; hand it over in person or through the client's agreed channel; delete it (and empty the bin) once the task is done. The CSV opens in Excel with Bangla intact (UTF-8 with a BOM); cells starting with `=`, `+`, `-` or `@` carry a leading `'` on purpose (formula injection).
- **Who exported what:** `SELECT created_at, actor_id, ip, meta FROM audit_logs WHERE action = 'users.exported' ORDER BY created_at DESC LIMIT 50;`

## 15. TLS behind Cloudflare (origin certificate)

Cloudflare's SSL mode is **Full (strict)**, with a free **Cloudflare Origin CA** certificate (DECISIONS "TLS behind Cloudflare").
- The production site is `infra/nginx/sites/tls`, rendered at start. It takes the host name from `APP_URL`, which must be `https://<host>` with no port or path (`infra/nginx/entrypoint/15-public-host.envsh`).
- The dev override serves `sites/plain` on http://127.0.0.1:8080 instead.
- The full Cloudflare checklist comes with LAUNCH-PLAN L4.

Once, on the VPS (the private key never leaves it):
1. Make the key and a CSR on the VPS, then `chmod 600 infra/nginx/certs/origin.key` (the folder is git-ignored):
   ```bash
   openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=<host>" -keyout infra/nginx/certs/origin.key -out origin.csr
   ```
2. In Cloudflare, open SSL/TLS → Origin Server → Create Certificate → "Use my private key and CSR". Paste the CSR, add the hostnames `<host>` and `*.<host>`, and choose 15 years. Save the certificate as `infra/nginx/certs/origin.pem`.
3. Set `APP_URL=https://<host>` in `.env`, best before the first start (the LAUNCH-PLAN §2 order: certificate, then first start).
   - If the stack already runs, recreate nginx, and also api and worker if they exist. Both read `APP_URL` once at start (email links, the payment return).
   - Do it outside an exam window: every API replica restarts, about 10–20 s without the API.
   ```bash
   $DC up -d --no-deps --no-build --force-recreate nginx
   [ -z "$($DC ps -aq api worker)" ] || $DC up -d --no-deps --no-build --force-recreate api worker
   $DC exec -T api printenv APP_URL   # must print https://<host>
   ```
4. Check the origin directly, before Cloudflare is involved. This must print `ok`:
   ```bash
   curl -sk --resolve <host>:443:127.0.0.1 https://<host>/healthz
   ```
   From inside the container, `$DC exec -T nginx wget -qO- http://127.0.0.1:8081/api/ready` uses the internal listener, which has no redirect.
5. Only now set SSL/TLS to **Full (strict)** in Cloudflare, then turn on Always Use HTTPS.
   - Full (strict) before nginx serves the certificate gives error 521. Without `infra/nginx/certs/origin.pem`, nginx does not start (`$DC logs nginx` shows `cannot load certificate`), so nothing answers on 443, or on 80.
   - 525 means the TLS handshake failed, for example when the host in `APP_URL` is not the proxied name and the catch-all 443 server refuses it.
   - 526 means a certificate was served that Cloudflare cannot validate: not the Origin CA one, the host name missing from it, or expired.
   - Flexible together with the origin's redirect loops forever.

HSTS comes from nginx only: 300 s for launch, without `includeSubDomains`. The ramp to 1 day, then 180 days, is a one-line change in `infra/nginx/nginx.conf` (owner question Q3). Apply it with a reload, outside exam windows.

**Fallback: a public certificate, only if Cloudflare's proxy has to be turned off (DNS only).** The Origin CA certificate is trusted only by Cloudflare, so without the proxy, browsers refuse it.
- **Issue one with DNS-01:** run certbot in a throwaway container (`certbot/dns-cloudflare`) with a Cloudflare API token limited to Zone → DNS → Edit on this one zone. Keep the token in a mode-600 credentials file outside the repo, for that run only. Then delete the file and revoke the token, so no API token stays on the server.
- **Install it:** copy `fullchain.pem` to `infra/nginx/certs/origin.pem` and `privkey.pem` to `infra/nginx/certs/origin.key`, then `chmod 600` the key.
- **Load it**, outside an exam window: `$DC exec nginx nginx -c /etc/nginx/sirat/nginx.conf -t && $DC exec nginx nginx -c /etc/nginx/sirat/nginx.conf -s reload`. The certs folder is inside the folder mount, so a reload sees the new files.
- **Renew it:** it lasts 90 days, so put the renewal date in the calendar. Go back to the Origin CA certificate and Full (strict) once the proxy is on again.
- **HTTP-01 does not work** with `sites/tls` as written: port 80 redirects the token path, and on 443 `location /` sends it to Next. It would need a code change.

## 16. Nightly session and token cleanup (L13)

- **What it deletes:** every night at 03:30 Asia/Dhaka, the worker's `housekeeping` queue runs `session-cleanup`. There is one scheduler, so one run however many workers start.
  - `sessions` rows that expired, or were revoked, more than 30 days ago. A rotated row counts as revoked. These rows keep IPs and browsers.
  - `auth_tokens` 7 days after they expired, used or not.
  - Nothing else: never users, payments, registrations, submissions or the append-only logs.
- **How:**
  - batches of 1,000 (`FOR UPDATE SKIP LOCKED`, 5 s each), at most 50 batches per table a night; the rest waits for the next night;
  - 3 attempts. A job that failed for good is kept 7 days, and `ops-check` reports it as a `failed_jobs` warning.
- **Check that it ran:** one audit row per run, with counts only.

```bash
$DC exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
select created_at, meta from audit_logs where action = 'housekeeping.session_cleanup' order by created_at desc limit 7;
SQL
```

- The worker also logs `session cleanup done` with the same counts.
- `"more": true` means the run reached the cap. That is normal right after a long pause. If it stays true night after night, the cap is too low for the traffic.
- **No manual trigger:** a run is idempotent, so the next night catches up.
- **Indexes:** `sessions(expires_at)`, `sessions(revoked_at)` and `auth_tokens(expires_at)` came with a plain `CREATE INDEX`, fine while the tables were young. A later index on a big `sessions` table must use `CREATE INDEX CONCURRENTLY`, in a migration of its own: Prisma runs each migration in a transaction, and `CONCURRENTLY` cannot run inside one. A plain build would lock writes, and so logins and refreshes, until it finished.
- **At worker start** the log says `housekeeping scheduler set` (id, pattern, time zone) once per job. Every start says so, but Redis keeps one scheduler per job: `$DC exec -T redis-queue redis-cli ZRANGE bull:housekeeping:repeat 0 -1` lists exactly `attempt-scrub` and `session-cleanup`.
- **After a purge,** a refresh token replayed more than 30 days after its rotation gets 401, like any unknown token. It no longer ends its family or writes `auth.refresh_reuse` (DECISIONS A2.1b #9).

**The registration form's retention (D6, the same queue).** Every night at 04:00 Asia/Dhaka, `attempt-scrub` clears `pending_registrations.payload`: the stored form, with its argon2id password hash.
- **Which attempts:**
  - **abandoned** ones (cancelled, or replaced by a new start), 30 days after their last change;
  - **open but dead** ones: last changed over 30 days ago, no payment initiated, pending, paid or refunded, and every checkout expired over 30 days ago.
- **Never:**
  - completed attempts (cleared at settlement);
  - **conflict** attempts (an admin case, section 11);
  - the row itself, the name, email and phone (payment lookups), payments and their events.
- **A payment that still succeeds later is not lost:** it is marked paid and appears in the review list as `attempt_invalid` (section 11).
- **Check that it ran:** one audit row per run, `housekeeping.attempt_scrub`, with counts only (`abandoned`, `dead`, `batches`, `more`), and the worker's log line `attempt scrub done`.
- **A conflict keeps its form** until an admin has closed the case: there is no "resolved" status, so the job never clears it.
  - Once the case is closed (the student has an account, or was refunded), clear that one attempt's form by hand, and note it with the case:
    ```bash
    $DC exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
    update pending_registrations set payload = null where id = '<attempt id>' and status = 'conflict' returning id;
    SQL
    ```
  - Never delete the row or its payments.

## 17. Ambassador referral points (core C5b-1)

- **What runs:** the worker's `ambassador-points` queue has two schedulers, one run each however many workers start.
  - `referral-points`: every 5 minutes, the registrations of the last 2 days (the whole table on the very first run).
  - `referral-points-backfill`: every night at 03:45 Asia/Dhaka, every registration.
  - Each writes one ledger row `referral_paid:<paymentId>` per paid registration with a referrer, and never one twice (`ON CONFLICT DO NOTHING`). It reads registrations and writes only `point_ledger`.
- **Points per referral and the ranks** are data, changed by an admin on /admin/ambassadors ("Edit points and ranks"; audited `ambassador_points.changed`). A new value counts for later awards only. 0 pauses the awards; the next run after a value above 0 gives them.
- **A failed run** is retried 3 times; a job that failed for good is kept 7 days, and `ops-check` reports it as a `failed_jobs` warning (queue `ambassador`). No manual trigger is needed: the next run catches up.
- **At worker start** the log says `ambassador points schedulers set`. Redis keeps one of each: `$DC exec -T redis-queue redis-cli ZRANGE bull:ambassador-points:repeat 0 -1` lists exactly `referral-points` and `referral-points-backfill`.
- **Check the awards** (counts only):

```bash
$DC exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
select count(*) filter (where event_key like 'referral\_paid:%') as referral_rows, max(created_at) as latest from point_ledger;
SQL
```

- **A wrong award** is never edited or deleted (the ledger is append-only): an admin adds a compensating entry with "Adjust points" (audited `points.adjusted`).

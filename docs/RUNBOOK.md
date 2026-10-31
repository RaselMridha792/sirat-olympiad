# RUNBOOK

Copy-paste operations. Always run from the repo root. Compose file: `infra/docker-compose.yml`, always with the root `.env` (`--env-file .env`; without it compose refuses to start because required variables are missing). Commands marked VERIFIED were run on the owner's machine during A1 (2026-10-30); everything else is still to be verified on the real VPS.

```bash
export DC="docker compose --env-file .env -f infra/docker-compose.yml"
# Local machine only (never on the VPS): add the dev override
export DCD="$DC -f infra/docker-compose.dev.yml"
```

## 0. Local development (VERIFIED)

```bash
cp .env.example .env                    # fill real local passwords; never commit
cp apps/api/.env.example apps/api/.env  # host-side dev env (same POSTGRES_PASSWORD)
openssl rand -base64 48                 # paste a fresh output into JWT_ACCESS_SECRET of each file (blank in the examples)
pnpm install
pnpm --filter @sirat/shared build
pnpm db:generate

$DCD up -d postgres pgbouncer redis-cache redis-queue mailpit   # data services on 127.0.0.1:15432/16432/16379/16380; Mailpit UI http://127.0.0.1:18025
pnpm db:migrate                                         # prisma migrate dev (host, via DIRECT_URL)
pnpm --filter @sirat/api db:seed                        # idempotent config seed
ALLOW_DEV_FIXTURES=yes-this-is-not-production pnpm --filter @sirat/api db:fixtures:dev   # DEV ONLY (see below)
pnpm dev:api                                            # http://localhost:4000/api/health
pnpm --filter @sirat/api admin:create --email you@example.org --name "Your Name"   # a local admin (section 13)
pnpm dev:web                                            # http://localhost:3000; dashboards need a session (see below)

pnpm typecheck && pnpm lint && pnpm test && pnpm build  # unit gates
pnpm --filter @sirat/api test:int                       # DB + Redis integration tests (uses sirat_test only)

$DCD up -d --build                                      # full stack; http://127.0.0.1:8080 and /api/ready
```

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
- `check:leak` (dev server) and `check:prod` / `check:api-down` (`next start` with `API_INTERNAL_URL`): set `CHECK_STUDENT_EMAIL`/`CHECK_STUDENT_PASSWORD` (a fixture student) and `CHECK_ADMIN_EMAIL`/`CHECK_ADMIN_PASSWORD`; CI runs all three (job "Dashboard pages").
- `pnpm --filter @sirat/web e2e [http://127.0.0.1:8080]` runs against the whole local stack with `E2E_STUDENT_PASSWORD` (the fixture password) and optionally `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`; it reads the reset email from Mailpit. The local stack (project `sirat`, same ports) is shared between sessions: announce `up -d --build`, smoke tests and e2e runs before starting and when done. The reset case sets the student's password to the same value again and ends that student's sessions. It refuses a base URL or `MAILPIT_URL` that is not 127.0.0.1, localhost or ::1.

## 1. Status and logs

```bash
$DC ps -a                          # VERIFIED; `migrate` shows "Exited (0)" when healthy
$DC logs -f --tail=200 api        # also: worker web nginx postgres pgbouncer redis-cache redis-queue migrate
$DC restart api                    # restart one service
scripts/healthcheck.sh https://<domain>
df -h; free -m; docker stats --no-stream
```

## 2. Deploy and rollback

```bash
# Run these lines one at a time (or from a script) and stop at the first failure. Never paste them with `set -e`
# into your login shell: a failing step would close the SSH session.
prev=$(git rev-parse HEAD); git tag "deploy-$(date -u +%Y%m%dT%H%M%SZ)" "$prev"   # what was running (local tag, never pushed from the VPS)
git switch main && git fetch origin
sha=$(git rev-parse origin/main)   # deploy ONLY a commit whose CI run is green (CI is advisory, OPEN-QUESTIONS #25):
# gh run list --workflow CI --commit "$sha" --json conclusion --jq '.[0].conclusion'   -> must print success
git merge --ff-only "$sha"
$DC build                          # new images; nothing restarts yet
$DC run --rm migrate               # migrate deploy + config seed with the NEW image while the OLD API keeps serving.
                                   # Its own output must end with "config seed done". If it fails, STOP: the old API is
                                   # still up; follow "Migration failed" below. (`$DC logs migrate` shows an older run.)
$DC up -d                          # recreates web/api with the new images; migrate runs again (no-op)
git diff --quiet "$prev" HEAD -- infra/nginx || $DC up -d --force-recreate nginx   # single-file bind mounts never see files git replaced
for _ in $(seq 1 60); do [ "$($DC ps --format '{{.Health}}' api | grep -vc '^healthy$')" = 0 ] && break; sleep 5; done   # wait until every API replica is healthy
scripts/healthcheck.sh https://<domain>   # if this fails -> rollback
# Re-run migrations + seed by hand (safe to repeat):
$DC run --rm migrate
# Rollback: git checkout --detach <deploy-tag|sha> && $DC up -d --build   (next deploy starts with `git switch main`)
# A rollback does NOT undo migrations, and it fails with P3009 while a failed migration is unresolved (see below).
```
Every DB session (migrations and psql included) starts with `statement_timeout 10s`, `lock_timeout 5s` and `idle_in_transaction_session_timeout 60s`. A migration that needs longer (backfill, index build) starts with `SET statement_timeout = '15min';`; in psql, run `SET statement_timeout = 0;` before a long manual query. A migration that fails on `lock_timeout` was waiting behind a long transaction: follow "Migration failed" below, then deploy again when traffic is low.
Migrations must stay backward-compatible: the old API keeps serving between `run migrate` and `up -d`, and a rollback runs old code on the new schema. `up -d` stops every API replica before the new ones start (about 10–20 s of 502s even when the deploy succeeds); zero-downtime deploys are the TODO in `scripts/deploy.sh` (build → migrate → start → health-check → auto-rollback).

**Migration failed** (the `run` output names it, e.g. P3018). Do this before any other `$DC up`:
1. Leave the old API running; do not run `$DC up`.
2. Confirm the failed migration left no changes. Prisma runs each migration file as one transaction on Postgres, unless the file has its own `BEGIN`/`COMMIT` or statements that cannot run in a transaction; check those by hand.
3. Mark it rolled back: `$DC run --rm migrate node_modules/.bin/prisma migrate resolve --rolled-back <migration_name>` (works with the new or the old image).
4. Fix forward (a corrected migration in a new commit, then deploy again) or roll back the code (`git checkout --detach <deploy-tag>`, `$DC build`, `$DC up -d`). **No deploys during a live exam window** except a critical fix agreed with the owner.

## 3. Scale API replicas

```bash
$DC up -d --no-recreate --scale api=6 api   # VERIFIED (1 -> 2): nginx picks up new replicas without a restart
```

## 4. Maintenance mode

TODO: Nginx `maintenance.html` toggle (return 503 with a friendly page for `/` and `/api`). Document the exact commands here when built.

## 5. Backup and restore

```bash
scripts/backup.sh                       # VERIFIED (Windows Git Bash; re-check on the VPS): owner-only dump, verified by a full read
# Restore: stop traffic first, restore (refuses a truncated dump; one transaction), then migrate and start again
$DC stop nginx web api
scripts/restore.sh backups/<file>.dump  # DESTRUCTIVE, asks for YES (truncated-dump refusal VERIFIED; full restore not yet rehearsed)
$DC run --rm migrate && $DC exec redis-cache redis-cli FLUSHALL && $DC up -d && scripts/healthcheck.sh https://<domain>
```
Credentials are read inside the postgres container; nothing secret is typed on the host. One-time on hosts with older backups: `chmod 700 backups && chmod 600 backups/*.dump`. Hardening phase: restore into a fresh database instead of `--clean` over the live schema. Before every exam: fresh backup + **restore drill on another machine**. Keep ≥ 7 daily + 4 weekly. Alert on failure.

## 6. Rebuild on a fresh VPS (< 1 hour)

`scripts/bootstrap.sh` (scaffold prints the steps; implement and rehearse). Needs: repo, `.env`, latest backup.

## 7. Exam-day incident steps

**Site slow:** `docker stats` (CPU/RAM) → PgBouncer waiting clients (`SHOW POOLS;`) → slow queries (log > 500 ms) → queue depth/failed jobs (BullMQ) → API p95 in monitoring → consider `--scale api=N`, then tell the owner.
**Site down:** `$DC ps` → Nginx logs → `df -h` (disk full?) → Postgres/Redis health → restart failing service → if data loss suspected, restore plan (section 5).
**`/api/ready` returns 503:** `$DC logs --tail=50 api | grep "readiness failed"` names the dependency (database, redisCache, redisQueue); check that container.
**Logs say "rate limiter unavailable":** the cache Redis is down or slow; the API keeps serving (fail-open) but the per-user and per-IP limits are off until it is back. Restart `redis-cache`.
**Students wait on "Signing you in again…" and the API log shows 503s on `/api/auth/refresh`:** the database was too slow for a session renewal to commit within `REFRESH_ROTATION_BUDGET_MS` (8 s), or its 5 s `lock_timeout` cut a wait. Each renewal was rolled back: nobody is logged out, the old cookies still work, and the browsers retry with a growing pause. Look at database load and connections; do not raise the budget during an exam (at most 10 s, and only with `$DC up -d api`).

**Dashboards show the error page (not the login page):** the web cannot read the session: `GET /api/auth/me` timed out (5 s), was rate limited or the API is down. The web log has one `ServerApiError` line per failure (class and status only). Check `/api/ready` and the API's 429s. A 429 behind this page always comes from the API, because the web asks `/auth/me` server-side, not through nginx: either the user's own limit on `/auth/me` (`API_LIMIT_PER_USER_PER_MINUTE`, 120 per route) or, for a cookie that does not verify, the client IP's 600.
**Clients get 429:** a JSON body with code `TOO_MANY_REQUESTS` and `Retry-After: 1` comes from nginx `limit_req`; a JSON body from the API (`ThrottlerException`) comes from a signed-in user's own limit (120 per route), the per-IP default for anonymous requests (600) or a route tier (forgot-password 120, resend/reset/verify 300, refresh 3,000). Many nginx 429s for one school or mobile operator come from its per-IP zones (`auth` 20 r/s, `api` 30 r/s; DECISIONS "Per-user API limits"). If a whole school is limited by the API, check that real client IPs are restored (section 10).
**"Security alert" email or `security.login.*` audit rows:** `login.account_limit` means one account failed 50 times within an hour (only IPs that failed are refused; the student can still log in from another network or reset the password); `login.distributed` means failures on one account from more than 20 IPs within an hour (nothing is blocked). Look the account id up in `audit_logs`; if it repeats across many accounts, consider Cloudflare Turnstile on login (DECISIONS). Alert emails pause 10 minutes per kind and stop at the hourly cap; the audit log has every event.
**A student cannot log in ("Too many attempts"):** the account is locked for their IP (10 failures in 15 min; 15 min, doubling on repeats up to 4 h) or reached 50 failures in an hour. The fastest fix is a password reset: completing it unlocks the account at once, on every IP. Logging in from another network (mobile data) also works, since other IPs are not locked. A whole school refused at once usually means its IP reached `LOGIN_IP_FAILURES_PER_MINUTE` (100 failures per minute); it clears within a minute. Limits are set in `.env` (`LOGIN_*`) and need `$DC up -d api` (never during an exam). Audit rows `auth.login_locked` show when locks started.
**More log detail:** set `LOG_LEVEL=debug` in `.env` and `$DC up -d api` (default `info` in production). **Never during an exam:** this recreates every API replica at once (and re-runs migrate first), a full API outage of about 10–20 s. Container logs rotate at 50 MB × 5 per container.
**Payments stuck:** admin → Payments → lookup by invoice/trx/phone → manual reconcile (audit-logged). Money taken but DB says unpaid is the worst case: alert on any `pending` beyond expiry.
**Submissions failing:** check `/api/ready`, Redis queue instance, API logs for 5xx; clients retry with backoff and keep local copies, so fix fast rather than patch hastily.

## 8. Contacts (fill in)

Client: — · PayStation support: — · Email provider: Amazon SES (AWS account / support plan: —) · Hostinger support: — · Cloudflare: — · Owner (Rasel Mridha): —

## 9. Pre-exam checklist (T-7 → T-0)

See `RULEBOOK.md` section 13: load test at 1.5–2× peak, backup + restore drill, 48 h code freeze, patches before freeze, monitoring + fake alert, Cloudflare verified, email deliverability, real small PayStation payment, rollback rehearsed, owner watching dashboards.

Also before launch:
- [ ] The API connects to Postgres with a **non-superuser runtime role** (OPEN-QUESTIONS #27); the bootstrap superuser is used only for migrations, backup and restore.
- [ ] PayStation sandbox checklist done (`docs/paystation/SANDBOX-CHECKLIST.md`) and the accepted `trx_status` values confirmed.
- [ ] `PAYSTATION_ENV=live` on the VPS, and the boot log's PayStation line matches the client account: `$DC logs api | grep "PayStation env="` shows `env=live`, the live host, the client's account label and invoice prefix, and the production callback and IPN URLs. It never shows any part of the merchant id or password. A `payments are DISABLED` WARN, or a `payments.disabled_in_production` alert, means PAYSTATION_ENV is blank: no registration can be paid.
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
$DC exec nginx nginx -t && $DC exec nginx nginx -s reload
```
Then confirm the running nginx sees the new list (a deploy that replaced the file through git gives it a new inode, which an nginx container created earlier does not see):
```bash
[ "$($DC exec -T nginx grep -c '^set_real_ip_from' /etc/nginx/cloudflare-realip.conf)" = "$(grep -c '^set_real_ip_from' infra/nginx/cloudflare-realip.conf)" ] || $DC up -d --force-recreate nginx   # recreate: never during an exam
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
5. In the VPS `.env`: `EMAIL_PROVIDER=ses`, `EMAIL_FROM=Sirat Olympiad <no-reply@<sending-domain>>`, `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`. Then `$DC up -d worker`. The worker refuses to start with a missing or malformed setting; `$DC logs worker` names the variable, never its value.

**Key rotation:** create a second access key for the IAM user → put it in `.env` → `$DC up -d worker` → check `$DC logs worker` for `email sent` → deactivate, then delete the old key.

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

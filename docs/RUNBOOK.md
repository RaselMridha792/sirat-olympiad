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
pnpm install
pnpm --filter @sirat/shared build
pnpm db:generate

$DCD up -d postgres pgbouncer redis-cache redis-queue   # data services on 127.0.0.1:15432/16432/16379/16380
pnpm db:migrate                                         # prisma migrate dev (host, via DIRECT_URL)
pnpm --filter @sirat/api db:seed                        # idempotent config seed
ALLOW_DEV_FIXTURES=yes-this-is-not-production pnpm --filter @sirat/api db:fixtures:dev   # DEV ONLY (see below)
pnpm dev:api                                            # http://localhost:4000/api/health

pnpm typecheck && pnpm lint && pnpm test && pnpm build  # unit gates
pnpm --filter @sirat/api test:int                       # DB + Redis integration tests (uses sirat_test only)

$DCD up -d --build                                      # full stack; http://127.0.0.1:8080 and /api/ready
```

Fixtures: 3 verified students with paid registrations, `student1@fixtures.invalid` … `student3@fixtures.invalid`, password = your `FIXTURE_PASSWORD` in `apps/api/.env`. They refuse to run unless `NODE_ENV` is development/test, the confirmation is set for that run, the URL is local with no `host`/`hostaddr` parameter, and the connected Postgres server carries `sirat.environment=development` (only the dev override sets it; after pulling this change once, recreate the dev Postgres with `$DCD up -d postgres`, data is kept). PowerShell: `$env:ALLOW_DEV_FIXTURES='yes-this-is-not-production'; pnpm --filter @sirat/api db:fixtures:dev`.

## 1. Status and logs

```bash
$DC ps -a                          # VERIFIED; `migrate` shows "Exited (0)" when healthy
$DC logs -f --tail=200 api        # also: web nginx postgres pgbouncer redis-cache redis-queue migrate
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
**Logs say "rate limiter unavailable":** the cache Redis is down or slow; the API keeps serving (fail-open) but per-IP limits are off until it is back. Restart `redis-cache`.
**Clients get 429:** a JSON body with code `TOO_MANY_REQUESTS` and `Retry-After: 1` comes from nginx `limit_req`; a JSON body from the API (`ThrottlerException`) comes from the 600/min app limit. If a whole school is limited, check that real client IPs are restored (section 10).
**More log detail:** set `LOG_LEVEL=debug` in `.env` and `$DC up -d api` (default `info` in production). **Never during an exam:** this recreates every API replica at once (and re-runs migrate first), a full API outage of about 10–20 s. Container logs rotate at 50 MB × 5 per container.
**Payments stuck:** admin → Payments → lookup by invoice/trx/phone → manual reconcile (audit-logged). Money taken but DB says unpaid is the worst case: alert on any `pending` beyond expiry.
**Submissions failing:** check `/api/ready`, Redis queue instance, API logs for 5xx; clients retry with backoff and keep local copies, so fix fast rather than patch hastily.

## 8. Contacts (fill in)

Client: — · PayStation support: — · Email provider: Resend (support/contact: —) · Hostinger support: — · Cloudflare: — · Owner (Rasel Mridha): —

## 9. Pre-exam checklist (T-7 → T-0)

See `RULEBOOK.md` section 13: load test at 1.5–2× peak, backup + restore drill, 48 h code freeze, patches before freeze, monitoring + fake alert, Cloudflare verified, email deliverability, real small PayStation payment, rollback rehearsed, owner watching dashboards.

Also before launch:
- [ ] The API connects to Postgres with a **non-superuser runtime role** (OPEN-QUESTIONS #27); the bootstrap superuser is used only for migrations, backup and restore.
- [ ] PayStation sandbox checklist done (`docs/paystation/SANDBOX-CHECKLIST.md`) and the accepted `trx_status` values confirmed.
- [ ] Cloudflare real-IP list refreshed (section 10).

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

## 11. Payments: refunds and manual reconciliation (PayStation has no refund API)

The admin payments screen (look up by invoice / PayStation `trx_id` / phone, re-check, manual reconcile; every action audit-logged with a reason) arrives with the payments module. Until then, this is the procedure.

**Refund a payment**
1. Find the payment by invoice number, `trx_id` or phone; its status must be `paid`.
2. Refund it in the PayStation merchant panel, or ask PayStation support. Keep their refund reference.
3. Re-check (transaction status v1 by invoice). When PayStation reports `trx_status = refund`, the system moves the payment `paid → refunded` and audit-logs it.
4. If PayStation does not show `refund` yet, reconcile it manually to `refunded` with the reason and PayStation's refund reference (audit-logged). Never delete the payment or the registration row.
5. What happens to the student's registration and exam access follows the owner's policy (OPEN-QUESTIONS P8). Until it is decided, ask the owner before changing access.

**Money taken but our DB says unpaid (the worst case)**
1. Look up the payment; read `gateway_payload` and the stored IPN bodies.
2. Re-check. If `status_code` is `"200"`, `trx_status` is success/successful and amount + invoice match, the re-check marks it paid; nothing else to do.
3. If the gateway reports success but the amount or invoice does not match, or `2001` keeps coming back: do **not** mark it paid. Contact PayStation support with the invoice number and `trx_id`, and record the case in the audit log.
4. If a student paid twice for one registration: refund the second payment (steps above).

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
pnpm --filter @sirat/api db:fixtures:dev                # DEV ONLY: 3 verified students with paid registrations
pnpm dev:api                                            # http://localhost:4000/api/health

pnpm typecheck && pnpm lint && pnpm test && pnpm build  # unit gates
pnpm --filter @sirat/api test:int                       # DB + Redis integration tests (uses sirat_test only)

$DCD up -d --build                                      # full stack; http://127.0.0.1:8080 and /api/ready
```

Fixture login emails: `student1@fixtures.invalid` … `student3@fixtures.invalid`, password = `FIXTURE_PASSWORD` from `apps/api/.env`. Fixtures refuse to run unless `NODE_ENV` is development/test, `ALLOW_DEV_FIXTURES=yes-this-is-not-production` and the DB host is local.

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
git pull --ff-only
$DC up -d --build                  # VERIFIED locally: builds, runs `migrate` (migrate deploy + config seed), then starts api
$DC logs migrate                   # must end with "config seed done"; the api will not start if migrate failed
scripts/healthcheck.sh https://<domain>   # if this fails -> rollback
# Re-run migrations + seed by hand (safe to repeat):
$DC run --rm migrate
# Rollback: git checkout <previous-tag> && $DC up -d --build
```
Migrations must stay backward-compatible (old code keeps running while the new one starts). TODO: `scripts/deploy.sh` = build → migrate → start → health-check → auto-rollback on failure. **No deploys during a live exam window** except a critical fix agreed with the owner.

## 3. Scale API replicas

```bash
$DC up -d --no-recreate --scale api=6 api   # VERIFIED (1 -> 2): nginx picks up new replicas without a restart
```

## 4. Maintenance mode

TODO: Nginx `maintenance.html` toggle (return 503 with a friendly page for `/` and `/api`). Document the exact commands here when built.

## 5. Backup and restore

```bash
scripts/backup.sh                       # VERIFIED: pg_dump -Fc into ./backups (then ship OFF the server)
scripts/restore.sh backups/<file>.dump  # DESTRUCTIVE, asks for YES (not yet rehearsed)
```
Credentials are read inside the postgres container; nothing secret is typed on the host. Before every exam: fresh backup + **restore drill on another machine**. Keep ≥ 7 daily + 4 weekly. Alert on failure.

## 6. Rebuild on a fresh VPS (< 1 hour)

`scripts/bootstrap.sh` (scaffold prints the steps; implement and rehearse). Needs: repo, `.env`, latest backup.

## 7. Exam-day incident steps

**Site slow:** `docker stats` (CPU/RAM) → PgBouncer waiting clients (`SHOW POOLS;`) → slow queries (log > 500 ms) → queue depth/failed jobs (BullMQ) → API p95 in monitoring → consider `--scale api=N`, then tell the owner.
**Site down:** `$DC ps` → Nginx logs → `df -h` (disk full?) → Postgres/Redis health → restart failing service → if data loss suspected, restore plan (section 5).
**`/api/ready` returns 503:** `$DC logs --tail=50 api | grep "readiness failed"` names the dependency (database, redisCache, redisQueue); check that container.
**Logs say "rate limiter unavailable":** the cache Redis is down or slow; the API keeps serving (fail-open) but per-IP limits are off until it is back. Restart `redis-cache`.
**Payments stuck:** admin → Payments → lookup by invoice/trx/phone → manual reconcile (audit-logged). Money taken but DB says unpaid is the worst case: alert on any `pending` beyond expiry.
**Submissions failing:** check `/api/ready`, Redis queue instance, API logs for 5xx; clients retry with backoff and keep local copies, so fix fast rather than patch hastily.

## 8. Contacts (fill in)

Client: — · PayStation support: — · Email provider: — · Hostinger support: — · Cloudflare: — · Owner (Rasel Mridha): —

## 9. Pre-exam checklist (T-7 → T-0)

See `RULEBOOK.md` section 13: load test at 1.5–2× peak, backup + restore drill, 48 h code freeze, patches before freeze, monitoring + fake alert, Cloudflare verified, email deliverability, real small PayStation payment, rollback rehearsed, owner watching dashboards.

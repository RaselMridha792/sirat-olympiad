# RUNBOOK

Copy-paste operations. SCAFFOLD: commands are the intended ones; verify each on the real VPS and fix this file as you go. Always run from the repo root. Compose file: `infra/docker-compose.yml`.

```bash
export DC="docker compose -f infra/docker-compose.yml"
```

## 1. Status and logs

```bash
$DC ps
$DC logs -f --tail=200 api        # also: web nginx postgres pgbouncer redis-cache redis-queue
$DC restart api                    # restart one service
scripts/healthcheck.sh https://<domain>
df -h; free -m; docker stats --no-stream
```

## 2. Deploy and rollback

```bash
git pull --ff-only
$DC build
$DC run --rm api pnpm --filter @sirat/api prisma:deploy   # migrations (backward-compatible only)
$DC up -d
scripts/healthcheck.sh https://<domain>   # if this fails -> rollback
# Rollback: git checkout <previous-tag> && $DC build && $DC up -d
```
TODO: `scripts/deploy.sh` = build → migrate → start → health-check → auto-rollback on failure. **No deploys during a live exam window** except a critical fix agreed with the owner.

## 3. Scale API replicas

```bash
$DC up -d --scale api=6
```

## 4. Maintenance mode

TODO: Nginx `maintenance.html` toggle (return 503 with a friendly page for `/` and `/api`). Document the exact commands here when built.

## 5. Backup and restore

```bash
scripts/backup.sh                       # pg_dump -Fc into ./backups (then ship OFF the server)
scripts/restore.sh backups/<file>.dump  # DESTRUCTIVE, asks for YES
```
Before every exam: fresh backup + **restore drill on another machine**. Keep ≥ 7 daily + 4 weekly. Alert on failure.

## 6. Rebuild on a fresh VPS (< 1 hour)

`scripts/bootstrap.sh` (scaffold prints the steps; implement and rehearse). Needs: repo, `.env`, latest backup.

## 7. Exam-day incident steps

**Site slow:** `docker stats` (CPU/RAM) → PgBouncer waiting clients (`SHOW POOLS;`) → slow queries (log > 500 ms) → queue depth/failed jobs (BullMQ) → API p95 in monitoring → consider `--scale api=N`, then tell the owner.
**Site down:** `$DC ps` → Nginx logs → `df -h` (disk full?) → Postgres/Redis health → restart failing service → if data loss suspected, restore plan (section 5).
**Payments stuck:** admin → Payments → lookup by invoice/trx/phone → manual reconcile (audit-logged). Money taken but DB says unpaid is the worst case: alert on any `pending` beyond expiry.
**Submissions failing:** check `/api/ready`, Redis queue instance, API logs for 5xx; clients retry with backoff and keep local copies, so fix fast rather than patch hastily.

## 8. Contacts (fill in)

Client: — · PayStation support: — · Email provider: — · Hostinger support: — · Cloudflare: — · Owner (Rasel Mridha): —

## 9. Pre-exam checklist (T-7 → T-0)

See `RULEBOOK.md` section 13: load test at 1.5–2× peak, backup + restore drill, 48 h code freeze, patches before freeze, monitoring + fake alert, Cloudflare verified, email deliverability, real small PayStation payment, rollback rehearsed, owner watching dashboards.

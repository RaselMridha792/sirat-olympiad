# 02 — System design

## 1. Why this design

The previous version failed near 20,000 users because: DB in another region (latency on every query), serverless API (a new DB connection per invocation, timeouts), third-party auth (a network call on every request), per-action DB writes during exams, and no load test. Each is removed by design below.

## 2. Topology (one VPS)

```
Internet → Cloudflare (DNS, CDN, DDoS, static cache)
        → Nginx :80/:443 (only public service)
             ├─ /          → web (Next.js standalone, :3000)
             └─ /api/*     → api × N replicas (NestJS, :4000)
                               ├─ PgBouncer :6432 → PostgreSQL :5432 (volume pgdata)
                               ├─ redis-cache  (allkeys-lru)
                               └─ redis-queue  (noeviction + AOF) ← BullMQ workers
```

* All services in `infra/docker-compose.yml`, `restart: unless-stopped`, healthchecks, CPU/memory limits.
* API replicas are **stateless** (no in-memory sessions/caches/files). 4–5 replicas to use all cores. Workers run the same image with a worker entrypoint (add `apps/api/src/worker.ts` when queues are built) so job load cannot slow the HTTP path.
* Runtime DB pool per API process: 5–10 connections. Total across replicas must stay below PgBouncer's `DEFAULT_POOL_SIZE` limits.

## 3. Capacity (estimate; the load test decides)

* 25k students, 30-minute exam, open ~2 days. Expected peak concurrency ≈ 1,300–3,800 active attempts (spread-dependent).
* Hot paths and their cost design:

| Path | Design | Per-student cost |
|---|---|---|
| Login surge | argon2id (CPU heavy) on login only; JWT verified locally afterwards (no DB hit per request) | 1 DB read + 1 session write |
| Start exam | Questions warmed into Redis before window opens; attempt row = 1 insert | 1 DB write |
| Autosave | Browser local store; checkpoint to Redis every 60–120 s | 0 DB writes |
| Submit | One idempotent request → 1 DB transaction → enqueue scoring | 1 DB write |
| Leaderboard | Precomputed snapshot in Redis/CDN after window closes | 0 DB per visitor |

* argon2id parameters must be tuned by load test (memory 19–64 MiB, time 2–3); a login surge of thousands/min is the CPU risk. Mitigation: queue-free but rate-limited login + progressive delay; consider lowering cost slightly rather than saturating CPU.
* Pass criteria: p95 API < 500 ms, error rate < 0.5 %, no growing queue backlog, CPU < 80 % sustained, zero data loss in submissions, at 1.5–2× peak.

## 4. Consistency model

| Concern | Rule | Enforced by |
|---|---|---|
| One attempt per student per exam | `UNIQUE(user_id, exam_id)` | DB |
| Timer cannot reset | `ends_at` stored at creation, never updated | service + DB (no update path) |
| Idempotent submit | `submissions.request_id UNIQUE`, `attempt_id UNIQUE` | DB |
| One payment ↔ one registration | `registrations.payment_id UNIQUE`, `payments.trx_id UNIQUE` | DB |
| Points never awarded twice | `point_ledger.event_key UNIQUE` | DB |
| Promotion never overwrites | `INSERT … ON CONFLICT DO NOTHING` on `round_entries(user_id, round_id)` | SQL |
| Payment transitions | state machine; illegal transitions rejected; row lock `FOR UPDATE` | service |

## 5. Failure modes and what happens

| Failure | Behaviour |
|---|---|
| Student's network drops mid-exam | Timer keeps running on server. Local answers kept. Client retries checkpoint/submit with backoff. Resume within remaining time |
| Student closes tab during payment | `payments` row already exists. Reconciliation job (every 2–5 min) asks PayStation and settles it. "Check my payment status" button |
| Callback never arrives / IPN lost | Same reconciliation job. Alert if pending beyond expiry |
| Redis cache lost | Checkpoints are only a convenience; the final submit carries all answers. Questions re-warm from DB |
| Redis queue restarted | AOF persistence; jobs retry; idempotent handlers |
| API replica crashes | Docker restarts it; Nginx retries another upstream |
| Whole VPS lost | `scripts/bootstrap.sh` + `.env` + latest off-server backup, target < 1 hour. Restore drill before every exam |
| Window-open surge | Waiting room + Start button enabled at `window_start`; client jitter; questions pre-warmed |

## 6. Security architecture (summary)

Cookie auth (httpOnly, Secure, SameSite=Lax) + custom-header CSRF check; refresh rotation with reuse detection; per-IP and per-account login limits (Redis throttler + Nginx `limit_req`); deny-by-default guards; audit log for security and admin events; Cloudflare IP ranges trusted for client IP; CSP + HSTS + helmet. Full list: `RULEBOOK.md` sections 5, 11, 15, 18.

## 7. Observability

`/api/health` (liveness), `/api/ready` (DB + Redis). Metrics: request rate, p95/p99, 5xx, active attempts, queue depth/failed jobs, PgBouncer waiting clients, slow queries (> 500 ms), CPU/RAM/swap/disk. Alerts listed in `RULEBOOK.md` section 12.

## 8. Hosting fallback

Single-VPS is the plan. If the load test fails the pass criteria, options in order: tune (argon2 cost, pool sizes, indexes) → upgrade the VPS plan → move PostgreSQL to a second server in the same region (never a different region). The owner has mentioned a Malaysia/AWS fallback; record the final decision in `DECISIONS.md`.

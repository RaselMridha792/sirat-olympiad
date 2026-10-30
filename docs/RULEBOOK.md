> **Amendments (2026-10-30) — these override the text below where they differ**
>
> 1. Product name: **Sirat Leadership Olympiad** (GLTS Leadership × Sirat Olympiad partnership). **SDG is removed**; categories are Activist / Ambassador / Achiever by grade band (bands to confirm).
> 2. Sessions: refresh token lifetime is **7 days** (section 5 said 14–30). Access token stays ~15 min.
> 3. Roles: `student`, `ambassador`, `manager` (duties undefined), `jury`, `admin`.
> 4. Email verification is **optional/lazy** (proposed): login allowed; exam start requires a verified email. Confirm with the owner.
> 5. Hosting is one Hostinger VPS; a Malaysia/AWS fallback has been discussed (decision pending, see `DECISIONS.md`).
> 6. The repo is a pnpm monorepo; new docs are `docs/01-…10-*.md`. `CLAUDE.md` at the repo root holds the Do's/Don'ts and read order.
> 7. Old-system references (bKash, Supabase, SDG tables) in sections 18-20 describe the **old Zero Olympiad**; they are lessons, not instructions to rebuild it.

# CLAUDE.md — Sirat Leadership Olympiad Platform Rulebook

This file is the source of truth for how this project is built. Read it fully before writing any code. If a task conflicts with a rule here, stop and ask the owner instead of silently breaking the rule.

---

## 0. Project in one paragraph

Sirat Leadership Olympiad (working name in older notes: Quiz Olympiad) is a live online exam platform. Students register, pay, log in, and sit timed exams, many of them at the same moment. The previous version (Next.js on Vercel + Express + Supabase in Tokyo + Supabase Auth) failed under roughly 20,000 users. This rebuild exists to remove those causes. The platform must stay up on exam day, and when something breaks it must be found and fixed fast.

**Stack (fixed, do not swap without owner approval):**

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router, TypeScript) |
| Backend | NestJS (TypeScript, strict) |
| Database | PostgreSQL in Docker, behind PgBouncer |
| Cache / queue | Redis (+ BullMQ for jobs) |
| Reverse proxy | Nginx (Cloudflare in front) |
| Hosting | ONE Hostinger KVM 8 VPS (frontend, backend, DB, Redis, Nginx all on it) |
| Auth | Our own auth system. No Supabase, no Auth0, no Clerk, no Firebase |

> Verify the VPS specs (vCPU, RAM, disk) on the Hostinger plan page before tuning any number in this file. Numbers below assume 8 vCPU / 32 GB RAM.

---

## 1. Lessons from the failed version (each is now a rule)

1. **Never put the database in a different region from the backend.** The old DB was in Tokyo, far from the server, so every query paid network latency. Now the DB, backend and frontend run on the same server and talk over the Docker network.
2. **No serverless for the API.** Vercel functions open a new DB connection per invocation, hit timeouts, and cost a lot under load. The API is a long-running NestJS process with a fixed connection pool.
3. **No third-party auth.** Login, verification, password reset and sessions are ours, in our database.
4. **Never write to the DB on every tiny user action** (every keystroke, every click) during an exam. Batch or queue.
5. **Never trust the browser** for payment success, time left, or scores.
6. **Never launch without a load test.** "It works on my machine" says nothing about 20k users.
7. **Costs must be predictable.** No pay-per-request services in the critical path.

---

## 2. How Claude Code must work

- Plan first. For any task bigger than a small fix, write a short plan (files to touch, risks) before coding.
- Work in small steps. One feature or fix per commit. Conventional commits (`feat:`, `fix:`, `chore:`).
- Never claim something works without running it. Run build, lint and tests, and report the real output.
- If a requirement is unclear, ask. Do not guess on auth, payments or exam logic.
- Never commit secrets. `.env*` is git-ignored; keep an `.env.example` with fake values.
- Never run destructive commands (dropping databases, `rm -rf` outside the project, force-push) without explicit owner confirmation.
- Keep a `docs/DECISIONS.md` with one short entry for every non-obvious technical decision and why.
- Keep a `docs/RUNBOOK.md` (see section 14) up to date as you build.

---

## 3. Architecture

```
Internet
   │
Cloudflare (DNS, CDN, DDoS protection, caching of static files)
   │
Nginx (only public service: ports 80/443)
   ├── /          → Next.js   (container, port 3000)
   └── /api/*     → NestJS    (N replicas, port 4000)
                       │
                       ├── PgBouncer (6432) → PostgreSQL (5432)
                       └── Redis (cache)  +  Redis (queue, BullMQ)
```

Rules:
- Only Nginx publishes ports to the host. PostgreSQL, PgBouncer, Redis, NestJS and Next.js are reachable only on the internal Docker network.
- Frontend calls the API on the same origin (`/api`). No cross-origin calls, so no CORS trouble and cookies stay simple.
- Everything runs from one `docker-compose.yml`. Every service has `restart: unless-stopped`, a `healthcheck`, and CPU/memory limits.
- The whole system must be rebuildable on a fresh VPS in under one hour from the repo + `.env` + latest backup. Keep `scripts/bootstrap.sh` and test it.
- A single server is a single point of failure. This is accepted, so backups, monitoring and the rebuild script are mandatory, not optional.

Suggested monorepo layout:
```
/apps/web        Next.js
/apps/api        NestJS
/infra           docker-compose, nginx, pgbouncer, postgres, redis configs
/scripts         bootstrap, deploy, backup, restore, healthcheck
/docs            DECISIONS.md, RUNBOOK.md, API.md
/loadtests       k6 scripts
```

---

## 4. Backend rules (NestJS)

**Structure and quality**
- TypeScript `strict: true`. No `any` without a comment explaining why.
- Feature modules: `auth`, `users`, `exams`, `attempts`, `payments`, `notifications`, `admin`, `health`.
- Every endpoint uses DTOs with `class-validator` and a global `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`).
- Validate environment variables at startup (fail fast if one is missing).
- Use structured JSON logging (pino). Never log passwords, tokens, OTPs, or full payment payloads.
- Global exception filter returns consistent error shapes and never leaks stack traces.
- Expose `GET /api/health` (liveness) and `GET /api/ready` (checks DB and Redis).
- Handle `SIGTERM` gracefully (finish in-flight requests, close pools) so deploys do not drop requests.

**Statelessness (required to run many copies)**
- The API runs as several identical copies (PM2 cluster or 4–5 Docker replicas) to use all CPU cores. Node uses one core per process.
- No in-memory sessions, no local file storage, no in-process caches that must be shared. Shared state goes in Redis or PostgreSQL.

**Performance**
- Paginate every list endpoint. No unbounded queries.
- No N+1 queries. Use joins or batched loads and check generated SQL on hot paths.
- Add an index for every foreign key and every column used in `WHERE`/`ORDER BY` on hot paths. Verify with `EXPLAIN ANALYZE`.
- Keep request handlers fast. Anything slow (email, PDF, certificate, bulk result calculation) goes to a queue.
- Cache read-heavy, rarely changing data (exam questions, exam config) in Redis with sensible TTLs and explicit invalidation.

**Rate limiting**
- Use `@nestjs/throttler` backed by Redis, plus Nginx `limit_req`.
- Stricter limits on `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/verify-*`.

**ORM**
- Use one ORM consistently (default choice: Prisma). With PgBouncer in transaction mode, use `?pgbouncer=true` on the runtime connection string and a separate `DIRECT_URL` for migrations.
- Runtime pool per API process stays small (e.g. 5–10). Total connections across all replicas must stay below what PgBouncer allows.

---

## 5. Authentication (our own)

Goal: secure, simple, and no external dependency in the login path.

**Passwords**
- Hash with **argon2id**. Never store or log plain passwords.
- Enforce a sensible minimum length (≥ 8) and check against a common-passwords list.

**Email verification and reset**
- On register, create a random one-time token (≥ 32 bytes from a CSPRNG). Store only its **hash** with an expiry (e.g. 24h for verify, 30 min for reset) and a `used_at` field.
- Tokens are single-use. Verification links never auto-login.
- Responses to "forgot password" and "resend verification" must be identical whether or not the email exists (no account enumeration).
- Send email through a queue using a transactional provider (SES, Brevo, Resend, or similar; owner decides). Set up SPF, DKIM and DMARC on the sending domain.
- Optional later: phone OTP. If added, OTPs are short-lived, hashed, attempt-limited.

**Sessions and tokens**
- Short-lived access token (JWT, ~15 min) + long-lived refresh token (e.g. 14–30 days) with **rotation**: every refresh issues a new refresh token and invalidates the old one. Reuse of an old refresh token revokes the whole session family.
- Store refresh tokens (hashed) in the DB or Redis so sessions can be revoked.
- Deliver tokens in **httpOnly, Secure, SameSite=Lax** cookies. Do not keep tokens in localStorage.
- With cookie auth, protect state-changing requests against CSRF (SameSite plus a CSRF token or custom header check).
- "Log out everywhere" and "revoke all sessions on password change" must work.

**Abuse protection**
- Per-IP and per-account rate limits on login. Add progressive delay or temporary lock after repeated failures.
- Log security events (failed logins, password changes, token reuse) to an audit table.

**Authorization**
- Roles: `student`, `teacher/school` (if needed), `admin`. Enforce with guards on every route, deny by default.
- Admin accounts require stronger protection (2FA recommended before launch).
- Students can only read and write their own data. Always check ownership server-side.

---

## 6. Database rules (PostgreSQL)

- Use migrations only. Never edit the schema by hand on the server.
- Primary keys: UUID (v7 if available) or bigint. `created_at` and `updated_at` on every table, stored as `timestamptz` (UTC).
- Use real constraints: `NOT NULL`, `UNIQUE`, foreign keys, `CHECK`. Do not rely on app code alone.
- Money is stored as integers in the smallest unit plus a currency code, never floats.
- Wrap multi-step writes (payment confirmation, exam submission) in transactions.

**Docker setup**
- Data lives on a named volume or host-mounted directory, never inside the container filesystem.
- PgBouncer sits in front in **transaction pooling** mode. Apps connect to PgBouncer, not Postgres.

**Starting configuration for 32 GB RAM (tune with load tests, do not treat as final)**
```
shared_buffers            = 8GB
effective_cache_size      = 20GB
maintenance_work_mem      = 1GB
work_mem                  = 16MB
max_connections           = 200    # PgBouncer keeps real usage far lower
wal_compression           = on
checkpoint_completion_target = 0.9
random_page_cost          = 1.1    # NVMe
```
Leave enough RAM for the API replicas, Next.js, Redis and the OS. Set Docker memory limits so one service cannot starve the others.

**Backups (mandatory)**
- Nightly `pg_dump` (or better: continuous WAL archiving) shipped **off the server** (S3-compatible storage or a second machine).
- Before any exam day: take a fresh backup and run a **restore drill** on a different machine. A backup that was never restored is not a backup.
- Keep at least 7 daily and 4 weekly backups. Alert if a backup job fails.

**Replica**
- Not needed at start. If added later, it goes on a **separate server**, never the same one.

---

## 7. Exam engine rules (most critical part)

- **Server is the authority on time.** Store `started_at` and `ends_at` on the server. The client timer is display only. Reject answers after `ends_at` (with a small grace window decided by the owner).
- **Never send correct answers or scoring data to the client.** Score on the server only.
- Question order and option shuffling are decided server-side and stored per attempt.
- **Autosave answers** without hammering the DB:
  - Client sends answers with a unique client-generated `request_id` (idempotency).
  - Server accepts, writes to Redis immediately, and flushes to PostgreSQL in batches or via a queue.
  - Resending the same `request_id` must not create duplicates.
- **Resume after disconnect or refresh:** an attempt can be resumed with its remaining time and saved answers. The client keeps a local backup of unsent answers and retries with backoff when the network returns.
- **One active attempt per student per exam** (enforced by a DB unique constraint, not just code).
- **Final submission** is a transaction: lock the attempt, store final answers, mark submitted. Scoring and results run asynchronously in a queue.
- Cache exam questions in Redis before the exam starts (warm-up job). The exam start must not cause a database stampede.
- Handle the "everyone clicks start at 10:00:00" spike: use short random jitter on the client or a queue-based entry if load tests show it is needed.
- Anti-cheat features (tab-switch logging, etc.) are logged events only, and must be cheap to record.

### 7.1 Exam model decided with the owner (self-paced exam inside an open window)

This section refines the rules above. Where they differ, this section wins.

- Each exam is open for a **window** (for example all day, over 2 days). A student starts whenever they like inside the window, and their personal timer runs from their own start. **The maximum exam duration is 30 minutes.** `window_start`, `window_end` and `duration_minutes` (≤ 30) are **per-exam configuration in the database**, never constants in code.
- At attempt creation the server sets `ends_at = min(started_at + duration, window_end)`. The server is the only authority on time. The timer keeps running if the student disconnects. The student can resume within the remaining time. **One attempt per student per exam** (`UNIQUE(user_id, exam_id)`), and the timer can never be reset.
- The client shows a countdown from the **remaining seconds sent by the server**, and re-syncs on every checkpoint response.
- **Light sync design (replaces per-answer database writes):**
  - Every answer change is saved immediately in the browser (IndexedDB/localStorage) so a refresh or crash does not lose work.
  - A checkpoint with all current answers is sent to the server every 60–120 seconds and written to **Redis only** (no database write per checkpoint).
  - The final submit is **one idempotent request** (client-generated `request_id`). The server stores it, returns a receipt immediately, and scoring runs asynchronously in the queue.
  - At time-up the client auto-submits the **current** answers with a random 0–20 s delay (to avoid a spike). The server accepts until `ends_at` + a grace period (owner decides, default 30 s). Add a test that auto-submit sends real answers, not an empty set.
  - If the final submit fails, the client keeps retrying with backoff and keeps the local copy until it gets a receipt.
- **No results at submission.** Results are computed after the window has closed for everyone. The leaderboard is precomputed and served from cache (Redis/CDN), never computed per visitor.
- **Question protection (students sit at different times, so questions can be shared):** per attempt, draw questions from a pool (pool size is an owner decision), and shuffle question order and options server-side, stored per attempt. `correct_answer`, review and explanations are **never exposed until the window has closed for everyone.**
- **Window-open surge:** allow login and a "waiting room" before the window opens. The Start button becomes active at `window_start`. Warm the questions into Redis beforehand.
- Expected load: with a 30-minute exam, peak concurrency is estimated in the low thousands (roughly 1,300 to 3,800 for 25k students spread over 2 days, depending on how bunched the starts are). This is an estimate. The load test must confirm it, including a first-hour surge scenario.
- Focus-loss / tab-switch events are recorded locally and sent with checkpoints and the final submit (enabled only if the owner wants it).

---

## 8. Payments

The gateway is **PayStation** (hosted checkout, paystation.com.bd). Wallets (bKash, Nagad, Rocket, Upay) and cards are offered on PayStation's page, so card data never touches our servers. The owner needs a PayStation merchant account; build and test against the **PayStation sandbox** (`https://sandbox.paystation.com.bd`) first, production API is `https://api.paystation.com.bd`.

> The official PayStation documentation (paystation.com.bd/documentation) is the source of truth for endpoints, field names and limits. Anything marked VERIFY is not stated in the docs we read and must be confirmed in the sandbox or with PayStation support, not assumed.

### 8.1 PayStation flow

1. **Create payment:** our API creates a local `payments` row first (`status = initiated`, unique `invoice_number`, amount, user, registration id). It then calls `POST /initiate-payment` with `merchantId`, `password`, `invoice_number`, `payment_amount`, `pay_with_charge` (1 = customer pays the gateway charge, 0 = merchant pays; owner decides), customer name/phone/email and our `callback_url`. A duplicate `invoice_number` returns `status_code` 1008. On `status_code` 200 the response holds `payment_url`; return it to the client, which redirects the user. Credentials stay in env vars, never in the browser.
2. **User pays on PayStation's page.** After paying, cancelling or failing, PayStation sends the browser back to our `callback_url`. The docs do not name the callback parameters (VERIFY in sandbox), so the callback is only a hint.
3. **Callback handler (GET, public):** treat it as a **hint, not proof**. Find the payment by our `invoice_number`, then call **transaction status** (`POST /transaction-status` with `merchantId` header and `invoice_number`, or v2 `POST /v2/transaction-status` by `trxId`). Mark `paid` only when `trx_status` is success (compare case-insensitively) and the amount and invoice number match our row. Store `trx_id`.
4. After marking paid, redirect the user to a normal "payment result" page in our app. Everything slow (email, receipt, registration side effects) runs in the queue.

### 8.2 IPN (server notification)

- PayStation can POST an IPN to an HTTPS URL we give it, for **successful transactions only**. The IPN has **no signature or auth header**, so treat the payload as untrusted.
- Add `POST /api/payments/paystation/ipn` as an **extra** signal. It must confirm the `invoice_number` exists and is pending, match `trx_amount`, check `trx_id` was not already processed, and then **confirm through transaction status** before marking paid. Return 2xx quickly. Retry count and delay are not documented (VERIFY), so the handler must be idempotent.
- The system must stay correct using only callback + transaction status + the reconciliation job below.

### 8.3 Users closing the payment page must never break anything

This is a hard requirement. A user can close the tab, lose network, or kill the app at any step.

- The payment row exists **before** the user leaves our site, so we always know a payment was started.
- If the callback never arrives, the **reconciliation job** (BullMQ repeatable job, every 2-5 minutes) takes every payment in `initiated`/`pending` older than ~2 minutes, calls **transaction status** by `invoice_number`, and moves it to `paid`, `failed` or `expired`. The docs do not state a checkout expiry (VERIFY with PayStation); until confirmed, use a configurable expiry (default 60 minutes) and then mark `expired`. Statuses are `processing`, `success`, `failed`, `refund`.
- The payment/registration page polls `GET /api/payments/:id/status` (every few seconds, with backoff) and also offers a **"Check my payment status"** button. Status always comes from our DB, which the callback, IPN or reconciliation job updates.
- Coming back later: "My registrations" shows pending payments with a button to resume (if still valid) or start a new payment (if expired/failed).
- **No double charging:** before creating a new payment for the same registration, check for an existing active one. If one is `initiated`/`pending`, query it first. One registration can have only one `paid` payment (DB unique constraint). Never reuse an `invoice_number`.
- **Callback and IPN must be idempotent:** either can be hit twice (refresh, double click, retry). Use a row lock (`SELECT ... FOR UPDATE`) or a unique `trx_id` constraint so the same payment cannot be applied twice.
- If a status call times out or errors, **never assume failure**. Retry, and let the reconciliation job decide.
- Money taken but our DB says unpaid is the worst case. Alert on any payment that stays `pending` beyond the expiry window, and keep a small admin screen to look up a payment by `invoice_number`/`trx_id`/phone and manually reconcile it (audit-logged).
- Registration/exam access is granted only from a payment in `paid` status in our DB. Never from the URL, query params, or client state.

### 8.4 General payment rules (apply to any gateway)

- **The gateway's own API response (query/execute) or a verified server-to-server notification is the source of truth.** Never mark a payment as paid because the user's browser returned to a success page.
- Verify any server-to-server notification: use the signature if the gateway provides one; PayStation IPN has none, so always re-confirm through the gateway status API before marking paid.
- Notification/callback handling is **idempotent**: processing the same event twice must not create two registrations. Store the gateway transaction id (`trxID`) with a unique constraint.
- Payment status is a state machine (`pending → paid / failed / refunded`). Illegal transitions are rejected.
- Store the raw gateway payload for audits.
- Webhook handler does the minimum (verify, record, enqueue) and returns fast. Emails, receipts and certificates run in the queue.
- Run a **reconciliation job** (e.g. every 10 minutes) that checks pending payments against the gateway and fixes mismatches.
- The payment path should stay healthy even when the exam path is busy (keep it lightweight and separate by queue and rate limits).
- Never log card data or full payloads containing sensitive fields.

---

## 9. Redis and queues

- Two logical Redis uses with different policies:
  - **Queue (BullMQ):** `maxmemory-policy noeviction`, persistence on (AOF). Losing jobs is not acceptable.
  - **Cache / rate limit / sessions:** `allkeys-lru` is fine.
  - Use two Redis instances (or two containers) so the policies do not conflict.
- Every job is idempotent and has retries with backoff and a dead-letter strategy.
- Monitor queue depth and failed jobs, and alert on both.

---

## 10. Frontend rules (Next.js)

- Build with `output: 'standalone'` and run in a container behind Nginx. Not on Vercel.
- Prefer Server Components and static rendering for public pages. Use ISR where content changes rarely.
- Keep client bundles small: lazy-load heavy components, no huge UI libraries without reason, check bundle size in CI.
- No secrets in `NEXT_PUBLIC_*` variables.
- All API calls go to `/api` on the same origin.
- The exam page must be resilient: show clear connection status, queue unsent answers locally, retry automatically, never lose work on refresh.
- Handle loading, empty and error states on every screen. No blank pages or raw error dumps.
- Accessibility basics and mobile-first layout (many students will use phones on weak networks).
- Images in WebP/AVIF, with proper dimensions and caching headers.

---

## 11. Nginx and server hardening

**Nginx**
- HTTP/2, `gzip on` (types: text/css, application/javascript, application/json, text/plain, image/svg+xml, `gzip_comp_level 5`). Compression happens in Nginx (or Cloudflare), never inside Node.
- Long `Cache-Control` (immutable) for hashed static assets, no caching for API responses unless explicitly designed.
- `limit_req` / `limit_conn` zones for `/api/auth/*` and general API.
- `upstream` with `keepalive` to the API replicas, sensible proxy timeouts, `client_max_body_size` set deliberately.
- Security headers: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, a Content-Security-Policy suited to the app.
- Restore real client IPs from Cloudflare headers so rate limits and logs work. Optionally allow only Cloudflare IP ranges on 80/443.
- Logrotate for Nginx and Docker logs so the disk never fills.

**Server**
- Firewall (UFW): allow only 80, 443, and SSH. SSH by key only, root login disabled, fail2ban on.
- Automatic security updates. Docker containers run as non-root where possible.
- Swap configured as a safety net, but treat any swap usage in monitoring as a warning sign.
- Time sync (chrony/NTP) is on. Exam timing depends on it.

---

## 12. Monitoring and alerting

The owner must know about a problem **before the client does**.

- **External uptime monitor** (UptimeRobot, Better Stack, or similar) hitting `/api/ready` and the home page every minute, alerting by Telegram/SMS/email.
- **Server metrics:** Netdata or Prometheus + Grafana (node exporter, cAdvisor, postgres exporter). Watch CPU, RAM, swap, disk usage and IO, network.
- **App metrics:** request rate, p95/p99 latency, error rate (4xx/5xx), active attempts, queue depth, failed jobs.
- **DB metrics:** active connections, PgBouncer waiting clients, slow queries (`log_min_duration_statement = 500ms`), locks, replication/backup status.
- **Error tracking:** Sentry (or self-hosted equivalent) for frontend and backend.
- **Alerts (minimum):** site down, 5xx rate above threshold, p95 latency above threshold, CPU/RAM above ~85%, disk above ~80%, failed backup, queue backlog growing, certificate expiry within 14 days.

---

## 13. Testing, load testing and go-live

**Code quality**
- ESLint + Prettier + TypeScript strict in CI. No merging with failing checks.
- Required tests: unit tests for auth, payment state machine and scoring; e2e tests for register → verify → login → pay → take exam → submit.
- CI (GitHub Actions): install, lint, build, test on every push.

**Load testing (required before any real exam)**
- Use k6 (scripts in `/loadtests`). Run these scenarios:
  1. **Registration surge:** many signups + email verification + payments webhooks at once.
  2. **Login surge:** everyone logs in within a few minutes.
  3. **Exam simulation:** full exam flow with autosave, at **1.5–2× the expected peak** concurrent users.
- Pass criteria (agree with owner, defaults): p95 API latency < 500 ms, error rate < 0.5%, no growing queue backlog, CPU < 80% sustained, zero data loss in submitted attempts.
- Record results and the capacity decision in `docs/DECISIONS.md`. If the test fails, fix or upgrade the plan first. Do not go live and hope.
- Load test from outside the server (another machine) so the test itself does not steal CPU.

**Pre-exam checklist (T-7 days to T-0)**
- [ ] Load test passed at 1.5–2× peak
- [ ] Fresh backup taken **and restored successfully** on another machine
- [ ] Code freeze 48 hours before the exam (only critical fixes)
- [ ] Dependencies and OS patched **before** the freeze, not after
- [ ] Monitoring and alert delivery tested (trigger a fake alert)
- [ ] Cloudflare caching and rules verified
- [ ] Email deliverability tested (verification, reset)
- [ ] Payment gateway tested end-to-end with a real small payment
- [ ] Rollback procedure rehearsed
- [ ] Owner is available and watching dashboards during the exam

---

## 14. Runbook (keep `docs/RUNBOOK.md` updated)

Must contain copy-paste commands for:
- Check service status, logs per service, restart one service
- Deploy and **rollback** the last release
- Scale API replicas up/down
- Put the site in maintenance mode with a friendly page
- Restore the database from backup
- Rebuild on a fresh VPS (`scripts/bootstrap.sh`)
- Exam-day incident steps: site slow → check CPU/RAM, PgBouncer waiting clients, slow queries, queue depth; site down → check Nginx, containers, disk, then restore plan
- Who to contact (client, payment gateway, email provider, Hostinger support)

**Deploys**
- Deploy script builds, runs migrations (backward-compatible only), starts new containers, health-checks them, then switches traffic. If the health check fails, it rolls back automatically.
- No deploys during a live exam window, except a critical fix agreed with the owner.

---

## 15. Security checklist

- Parameterized queries only (the ORM does this; never concatenate SQL).
- Helmet on the API; strict CORS allowlist (same-origin by default).
- Sanitize anything rendered as HTML. Never use `dangerouslySetInnerHTML` with user input.
- File uploads (if any): type and size limits, stored outside web root, scanned or restricted.
- `npm audit` in CI; update dependencies regularly (outside freeze windows).
- Secrets only in environment variables or a secrets file with `600` permissions, never in git or logs.
- Audit log for admin actions (who changed what, when).
- Personal data of students (many may be minors): collect the minimum, protect it, and never expose it in public endpoints or logs.

---

## 16. Hard NEVER list

1. Never use Supabase, Vercel serverless, or any third-party auth for this project.
2. Never put the database in another region or on another network path than the backend.
3. Never expose PostgreSQL, PgBouncer or Redis to the public internet.
4. Never trust client-provided time, score, price, role, or payment status.
5. Never write to the DB on every keystroke or click during an exam.
6. Never mark a payment paid without a verified webhook or gateway check.
7. Never store plain-text passwords or tokens, and never log them.
8. Never ship without lint, build and tests passing.
9. Never deploy to production during a live exam.
10. Never skip the backup restore drill before an exam.
11. Never commit `.env` files or secrets.
12. Never claim "done" without showing what was run and what the output was.

---

## 17. Open questions (ask the owner before building the affected part)

1. PayStation merchant account status: sandbox credentials available? Production approval timeline? Which methods enabled (bKash, Nagad, Rocket, Upay, cards)? Who pays the gateway charge (`pay_with_charge`)? Callback parameter names, checkout expiry and IPN retry rules (not in the public docs). Currency is BDT only?
2. What is the real **peak concurrent** user count (not total registered)? Are exams in batches or all at once?
3. Exam format: question types, number of questions, time limit, negative marking, image-based questions?
4. Which transactional email provider and sending domain?
5. Which domain, and is Cloudflare available for it?
6. Do teachers/schools need their own dashboards, bulk registration, or certificates?
7. Which languages (Bangla/English) and is a mobile app planned later?
8. Where will off-server backups be stored (S3-compatible bucket or another machine)?
9. How long is each exam window (24 hours, or specific hours each day)? Is the 30 minutes a hard maximum for every exam?
10. Same questions for everyone, or a question pool with different questions per student? How large is the pool?
11. If a student's connection drops mid-exam, the timer keeps running (default in 7.1). Is the owner and client fine with that rule?

---

## 18. Rules learned from the Zero Olympiad (previous system) audit

Each rule below exists because the previous system had the opposite problem. Treat them as hard requirements and cover each with an automated test where possible.

**Identity and authorization**
- The acting user's id and role come **only from the verified session**. Never from the request body, query or URL. Any `:id` in a URL must be checked for ownership (or admin role) on the server.
- Profile update uses an **explicit allow-list DTO** (e.g. name, phone, district, institution, education, grade, photo). `role`, `round`, `is_participated`, `promo_code`, payment tokens, points and ranks are **never client-writable**. Roles change only through admin endpoints.
- **Registration never accepts a role** from the client.
- Every route has an explicit guard. Add a CI test that lists all routes and fails if a route has no guard and is not on a short, reviewed "public" allow-list.
- Payment management endpoints (refund, query, search) and all admin endpoints are admin-only. Support tools that reset or wipe a user's data are audit-logged.

**Payments and registration**
- One payment ↔ one registration. `UNIQUE(payment_id)`, `UNIQUE(trx_id)` and a unique verification token in the DB.
- Consume the payment/verification token **atomically** before creating the account (`UPDATE … SET status='used' WHERE token=$1 AND status='completed' RETURNING …`), inside one transaction with the rest of registration. Replaying the callback must never create another account.
- Registration open/closed is enforced **on the server** (settings flag checked in the API), not only by hiding a page. The fee, dates and fee currency come from configuration/DB, never hardcoded in several files.
- Payment success/failure redirect targets are configuration, covered by an e2e test (the old system sent paid users to a "closed" page).
- Registration form data survives the trip to PayStation and back (store it server-side against the pending payment, not only in browser storage).

**Exam integrity**
- Create a **server-side attempt record** when a student starts (`started_at`, `ends_at`). Questions are served only inside the exam window and only for a started attempt.
- **Never send `correct_answer`** to any client before the exam window has closed for everyone. Review pages unlock only after `ends_at`.
- Reject submissions after `ends_at` (plus an owner-approved grace). `time_taken` is computed by the server from the attempt record, never reported by the client. Scoring is server-side.
- Quiz questions are **never deleted and re-created** on edit once submissions exist (it breaks stored answers). Lock the quiz after publish, or version it.
- Auto-submit (timer end, violation limit) must send the **current** answers. Add a test for it.
- Question list, options and order for a quiz come from the server by quiz id. The UI must open the quiz the user chose.

**Rounds, promotion and jury**
- Promotion is a **transaction, idempotent, and never overwrites existing round data** (videos, jury scores). Every run is audit-logged. Round structure and rules are data-driven, not fixed `round_1..3` columns.
- Jury scoring: validate each criterion range, compute totals on the server, record **which judge** scored, keep score history. One endpoint per job (no duplicate routes).
- Certificates are issued by the server from database state, with a verification URL. Not generated and trusted in the browser.

**Data layer**
- **All schema changes, including DB functions and indexes, live in migrations in the repo.** A fresh environment must be rebuildable from the repo alone.
- Real foreign keys and unique constraints (not "soft" links). One data-access layer, one code path (no dual direct-SQL and client-library branches). Multi-step writes use transactions.
- Counters (e.g. referral counts) are derived from real rows or maintained transactionally, never a separate drifting number.

**Frontend**
- No auth tokens in JS-readable storage. One httpOnly session cookie, one API client, one session source.
- Marketing and public pages are **server-rendered or static** (no empty-HTML shells, no persist-gate blocking the first render).
- Never inject user-provided text as HTML (no `dangerouslySetInnerHTML`, no `html:` option in alert libraries). Escape or use text.
- No personal data in persisted client caches. If any cache is persisted, keys are per user and cleared on logout.
- Real i18n (Bangla/English) instead of the Google Translate widget. No mock JSON/data in `public/`. Compress and size images (the old site shipped a 17 MB image in an 84 px circle).
- Content, dates, contact details, partners and rules text come from one source (config/CMS/data), not repeated hardcoded in many components.

**Operations**
- Never log tokens, passwords or full personal-data objects. Never return raw database error messages to clients.
- CI deploys a build artifact using **key-based SSH, never root with a password**. `.dockerignore` excludes `.env`. CI gates: lint, type-check, tests, build. One production target.
- Login is rate-limited. Rate-limit keys use the real client IP only from trusted proxy headers (Cloudflare ranges), not from raw client-controlled headers.
- Supabase-style "service key bypasses row security" shortcuts are not used. All access control is enforced in the API and verified by tests.

---

## 19. Feature scope: Ambassadors, points, ranks, teams (new in this version)

The old system only had a promo code and a referral counter. The client now wants:

1. **Ambassador panel** for students/users (separate `ambassador` role and dashboard).
2. **Points and ranks:** points earned from approved activity map to ranks (Bronze, Silver, Gold, …). The user sees points and rank on their profile.
3. **Teams:** an ambassador can create a team from the dashboard.
4. **Admin tasks:** admin assigns specific tasks (note-style) to ambassadors; completing a task earns points.

Build rules:
- Points are an **append-only ledger** (who, why, which task/event, amount, when, created by). Totals and ranks are derived from the ledger, never edited as a single number. Corrections are new compensating entries.
- Each point-earning event has a **unique event key** so the same action can never award points twice (DB unique constraint).
- Task points are awarded only after **admin approval** or a verifiable automatic condition (e.g. a referred student's payment is confirmed). Nothing is awarded on a client claim alone.
- Rank thresholds live in a **config table** that admins can edit, not in code.
- Team data is visible only to that team's members and admins. Ambassadors cannot see other teams' data or edit points.
- Leaderboards and rank views are cached in Redis and paged on the server. They must not add load to the exam path.
- Referral counts are derived from real referred-user rows, not a stored counter.

---

## 20. Migration notes from the old system (Supabase)

- Before any migration, take a **schema-only dump of the live Supabase database** (the old repo has no migrations, and two DB functions exist only in the live DB). Reconstruct the schema as proper migrations in the new repo.
- Decide with the owner whether Season 2 users/results must be imported or whether Season 3 starts fresh.
- If users are imported: Supabase Auth stores password hashes, which can be exported. Verify them on first login with the old algorithm, then **re-hash with argon2id** and store only the new hash. Users keep their passwords and no mass reset is needed. Validate this with a small test export first.
- Reuse the old system as a **business-rules specification**, not as code: SDG/category mapping, scoring, promotion ranking rules, 10-criteria jury scoring, certificate wording and Bangla font/name normalisation.
- Items worth porting (after review): scoring helpers, leaderboard ranking SQL, dashboard aggregates, admin dashboard UI components, invoice PDF template, PayStation error-code map (status codes 200, 1008, 2001).

# DECISIONS

One short entry per non-obvious technical or product decision. Newest first. Format: date · decision · why · who.

## 2026-10-31 — Account limit: only IPs that failed are refused, with alerts (owner)

1. **Approved:** when an account reaches its hourly failure limit (`LOGIN_ACCOUNT_FAILURES_PER_HOUR`, 50), only IPs that failed on that account within the hour are refused; an IP without failures (usually the student's own) can still log in.
2. **Condition 1:** reaching that limit is a security event: a `security.login.account_limit` audit row and an alert (a warn log line marked `alert`, matched by log-based alerting; an email to an operator follows with the email queue).
3. **Condition 2:** failed logins on one account from more than `LOGIN_ALERT_DISTINCT_IPS_PER_HOUR` (20) distinct IPs within an hour are a separate signal, logged and alerted the same way (`security.login.distributed`). No automatic blocking for now.
4. **Later, if needed:** Cloudflare Turnstile (a challenge on login, forgot-password and resend) as the next step against distributed guessing, instead of blocking students.

## 2026-10-31 — A2.1d login, change-password, email tokens (Claude; owner rules of 2026-10-31)

Built against a requirements checklist (seven read-only agents over the docs, DECISIONS and `reference/`). Each protection has a test that fails without it (mutation-checked).

1. **Limits** (all from env, `LOGIN_*`): 100 failed logins per minute per IP; 10 failures within 15 min lock an account+IP pair for 15 min, doubling on each repeat within 24 h up to 240 min; 50 failures per hour per account. Atomic Lua scripts in the cache Redis; emails appear in keys only as truncated SHA-256 hashes; IPv6 is keyed by its /64; fixed windows; a completed password reset bumps the account's key generation; 300 ms Redis timeout, fail-open (logged) like the global limiter.
2. **Account limit refuses only IPs that failed on the account within the hour** (implementer choice, *approved by the owner on 2026-10-31 with two alert conditions; see "Account limit: only IPs that failed are refused, with alerts"*): refusing every IP let anyone lock a student out on purpose (two IPs reach 50 an hour through the pair locks; five re-lock right after a reset). An IP without failures (usually the student's own) still logs in; an attacker gets one guess per fresh IP.
3. **Login:** limits are checked before the password, so a lock refuses even the right one (owner). An unknown email pays a dummy argon2 verify and is counted like a real one; every failure answers one 401 message; a refusal answers 429 with `Retry-After` and "…or reset your password". A blocked account learns it is blocked only after the right password (403). 204 with an empty body: no token and no personal data; the web reads `/auth/me`. The global request limiter skips login (only failures count).
4. **Audit:** failed logins (reason only) and the start of a pair lock or of the account limit; never an email or an email hash. A successful login is not audited: the sessions row records it, and login stays at one read and one write (02-SYSTEM-DESIGN §3).
5. **nginx:** the strict zone now covers only the credential endpoints (login, forgot/reset password, verify/resend email) as a flood guard sized for a school behind one IP (20 r/s, burst 200). `/me`, refresh and logout run on every page and moved to the general API zone.
6. **change-password:** under the login limits (a stolen session must not become a way to guess the password); 400 for a wrong current password, not 401, which the web treats as logged out; the new password must pass the policy and differ. One transaction writes the hash, ends every session and retires outstanding reset links; then a fresh session for this device.
7. **Email tokens:** 32 random bytes as base64url (43 characters), SHA-256 stored, lifetimes from env (24 h verify, 30 min reset); a conditional update makes each token single-use, and a new token retires the older ones of its type.
8. **Emails:** one bilingual message (Bangla first). Links are `APP_URL/<page>#token=…`: the token never reaches a server, a log or a Referer header, and mail scanners that open links cannot use it up. Names are HTML-escaped. `APP_URL` is required in production.
9. **Known risks (told to the owner):** students behind one school IP share the account+IP pair, so a classmate can lock a student out *at school*; a completed reset unlocks at once. A script on a school network can trip that IP's failure limit every minute. After a reset, a password change or a block, other devices keep a valid access token for up to 15 min (local JWT verification).
10. **Not yet:** forgot/reset/verify/resend (they need the email queue of PR #6), the per-email send caps (1 per minute, 5 per hour) and the strict throttle tier for them, the web pages (reset, verify) and the web refresh flow, and the cleanup job for old sessions and tokens.

## 2026-10-31 — Login limits and locks (owner)

1. The per-IP limit counts **only failed** logins, about 60–100 per minute, changeable in config; the IP comes only from Cloudflare's trusted header (nginx restores it; the API trusts one proxy hop).
2. Failures are counted per account+IP pair. **During a lock even the correct password does not log in.** A lock ends by itself after 15 minutes, longer step by step when locks repeat. Without a lock, a correct password resets the failure count to zero. A completed password reset unlocks the account. Messages never reveal whether an account exists.
3. A separate, larger account-wide limit: about 50 failures per hour.
4. Now build login, forgot, reset, verify, resend and change-password.

## 2026-10-30 — A2.1b passwords and sessions (Claude)

Each item has tests, and each test was checked to fail with its protection removed (20 mutations: 7 password, 13 session).

1. **Passwords:** argon2id at the OWASP baseline (19 MiB, t=2, p=1), to be tuned by the login load test; `needsRehash` lets login upgrade older hashes later. Every password is NFKC-normalized before it is checked, hashed or verified, and its length counts characters (code points): 8–128 (owner). The 10,000 most common passwords (SecLists `10k-most-common.txt`, MIT, compared case-insensitively) are refused. The list ships in `dist` and is loaded at boot: the compiled API was started without it and refused to start. `verifyDummy` costs the same as a real verify, for unknown emails at login.
2. **Sessions:** one family per login. Each refresh retires the presented token with a conditional update (of five simultaneous refreshes exactly one wins, tested) and issues a new pair in the same family; the 7-day expiry slides with each refresh. Only SHA-256 hashes of refresh tokens are stored.
3. **Reuse detection:** a retired token that comes back while its family is alive ends the family for every holder and is audited once (`auth.refresh_reuse`). Within 10 s of its rotation the same thing is two tabs refreshing at once: 409, family kept, and the client retries with the cookies the other tab already received. Inside those 10 s a theft is not detected; after them it is. A token of a family that already ended (logout, an earlier reuse) is refused without an audit entry.
4. **Cookies:** `sirat_access` (httpOnly, SameSite=Lax, Path=/, 15 min) and `sirat_refresh` (httpOnly, SameSite=Strict, Path=/api/auth, expires with the session). Host-only: the unused `COOKIE_DOMAIN` was removed from `.env.example`. `COOKIE_SECURE` defaults to true; `false` is only for local plain-http development and is refused with `NODE_ENV=production`.
5. **Logout** ends this device's family; **logout-all** ends every family and is audited. An access token stays valid until it expires (at most 15 min), because it is verified locally (03-HOW-IT-WORKS §2); logout removes it from the browser.
6. **`/auth/me`** reads the user fresh from the database (role included) and treats a blocked user as logged out; a refresh by a blocked user ends the family.
7. **Audit writes never fail a request:** a failed write is logged with the action and error class only.
8. **AppModule integration tests now use the `*_test` database** for the app's runtime connection too (the database half of the A1.1 backlog item; Redis is still shared).
9. **Follow-up (with the queue workers):** a periodic job deletes sessions that expired or were revoked more than 30 days ago, since every refresh adds a row.

## 2026-10-30 — A2.1a auth guard rails (Claude; first part of A2.1)

Each item has tests, and each test was checked to fail with its protection removed (15 mutations).

1. **DB session timeouts** are database defaults, set by a migration: `statement_timeout 10s`, `lock_timeout 5s`, `idle_in_transaction_session_timeout 60s`. They reach every new session (API through PgBouncer, workers, migrations, psql); pg_dump and its dumps set their own. Work that needs longer sets its own value first (RUNBOOK §2). Chosen over per-role settings because there is one DB role until OPEN-QUESTIONS #27, and over PgBouncer's `query_timeout` because that would not cover direct connections.
2. **`audit_logs` is append-only:** triggers refuse UPDATE, DELETE and TRUNCATE. The table owner can still disable them deliberately; the app never does. Test helpers no longer truncate it.
3. **Request timeout:** a global interceptor answers 503 after 25 s (below nginx's 30 s) and logs method and path. The handler cannot be cancelled; its DB statements stop at 10 s.
4. **Deny by default:** the global `AuthGuard` requires a valid access token in the httpOnly cookie `sirat_access` unless the route is `@Public()`; `@Roles()` narrows a route to roles from the token. Tokens are HS256 only, issuer and audience pinned, 15 min, verified locally, with claims `sub`, `role`, `sid`. Only the cookie counts (an `Authorization` header is ignored). A valid session is also attached on public routes.
5. **CSRF:** a global guard requires a non-empty `X-Requested-With` on every request except GET/HEAD/OPTIONS, public routes included (login CSRF). The API never enables CORS (tested). `@SkipCsrf()` is reserved for the PayStation IPN.
6. **Route inventory test** (`apps/api/test/app-routes.int-spec.ts`): boots the real AppModule and compares the routes controllers declare with the routes Express serves, so a route added outside a controller (and so outside the guards) fails; every `@Public()` route must be in the reviewed allow-list from 06-API. Nest registers module middleware applied with `forRoutes('*')` (nestjs-pino) as catch-all routes for every HTTP method; the test excludes exactly that shape.
7. **Guard order** (AppModule): rate limit → CSRF → session.

## 2026-10-30 — A2.0 logging and secret gates (Claude; owner-ordered before any auth code)

Each gate has its own tests, and each test was checked to fail with its gate removed.

1. **Gate 1, no Prisma messages in logs.** The exception filter never logs an error message. For a Prisma error it logs the class name, the code and only the `meta` keys that name things (`modelName`, `target`, `constraint`, `field_name`); for any other error, the class name and the stack frames without the message line. Prisma messages quote query arguments (emails, phones, password hashes). Tested with real Prisma error classes carrying an email and a hash.
2. **Gate 2, request logs carry no query strings or headers.** pino-http logs only the request id, method, path without `?…`, and status code; header redaction stays as a second layer. Nginx sends `X-Request-ID: $request_id`; the API keeps a well-formed id (8–64 letters, digits, dashes), otherwise makes a UUID, and returns it in the `X-Request-ID` header and in error bodies. `/api/health` is not logged.
3. **Gate 3, no weak signing secrets.** `JWT_ACCESS_SECRET` needs at least 32 characters, at least 10 distinct characters and no placeholder word (`fake`, `change me`, `example`, `placeholder`, `dummy`, `sample`, `your secret`, `xxxx`), in every `NODE_ENV`, because a compose env file can override `NODE_ENV`. The error names the variable and the rule, never the value. Both example env files ship it blank (like `FIXTURE_PASSWORD`), so a copied example never boots; CI generates a random secret per run. `DATABASE_URL` and the two Redis URLs must also have the right scheme.
4. **Gate 4, body-parser errors are 4xx.** Errors that body-parser marks as client errors (`expose: true`, 4xx) keep their status with a fixed message: oversized body → 413, malformed JSON → 400 (the body is never echoed), unsupported charset → 415. They are logged as warnings without the parser's message. Every other non-HTTP error stays a 500.
5. **One HTTP pipeline:** `configureApp()` is used by `main.ts` and by the integration tests, so the tests run the production middleware, pipes and filter.
6. **Rate-limiter stall fix** (A1.1 backlog). After an event-loop stall, the 300 ms Redis timeout and a reply that has already arrived are due together, and Node runs timers before I/O callbacks, so the limiter took a busy process for a hung Redis: it failed open and opened its 2 s breaker (this also made `app-throttle` flaky). `withTimeout` now defers its rejection by one `setImmediate`. Test: stall the loop past the timeout after the command is sent; the hit must still count (fails 3/3 without the fix, passes 3/3 with it).
7. **RUNBOOK repair.** The A1.1 docs commit (42008d4) duplicated §3–§11 and split the deploy block's "wait until every API replica is healthy" line: the edit script used `String.replace`, where `$'` in the replacement text means "the rest of the document". The file now matches the intended A1.1 text byte for byte (checked by re-applying the same edits literally to the parent commit). No other file was affected: no other edit contained a `$` replacement pattern, and no other doc has duplicate headings.

## 2026-10-30 — A2 (auth) approval (owner)

1. **A2 approved** as planned, with the changes below. Work starts from `main` after PR #1 and #2 were merged.
2. **Passwords:** 8 to 128 characters; the 10,000 most common passwords are refused.
3. **Login limits:**
   - The per-IP limit counts **failed** logins only, about 60–100 per minute: all students of one school can share one IP.
   - Failures are counted per **account + IP pair**, so nobody can lock someone else's account on purpose. The whole account has a separate, higher limit.
   - A correct password or a password reset unlocks. *(Superseded 2026-10-31: during a lock even the correct password is refused; see "Login limits and locks (owner)".)*
4. **A2.0 first:** the four logging/secret gates, each with its own test, before any auth code.

## 2026-10-30 — A1.1 deploy fixes (Claude; owner-scoped to four confirmed findings)

1. **Deploy order:** `$DC build` → `$DC run --rm migrate` (new image, old API still serving) → `$DC up -d`. A migration that fails on production data no longer takes the API down; RUNBOOK §2 has the recovery (`prisma migrate resolve --rolled-back`). Verified on the dev stack: 40/40 readiness checks returned 200 while the migrate job ran. `up -d` still restarts all API replicas at once (~10–20 s of 502s); zero-downtime deploys stay the `scripts/deploy.sh` TODO.
2. **SIGTERM drain:** while draining, every response carries `Connection: close` (first middleware), so nginx stops reusing busy keep-alive connections and the drain completes; a 28 s unref'd deadline closes the rest inside the 35 s `stop_grace_period`. Test: shutdown finishes in ~1 s with a busy keep-alive client and hangs without the header.
3. **Cloudflare real-IP refresh** is `scripts/refresh-cloudflare-ips.sh`: validated downloads (CIDR lines only, at least 10 IPv4 / 5 IPv6), `nginx -t` on the pinned image, then an in-place rewrite. A failed or junk download leaves the live file untouched (tested).
4. **Reference data ships as a data migration** (`*_reference_data_baseline`: 17 grade levels, 3 rank thresholds, Round 1, each only while its table is empty). The seed keeps only per-key settings. Later data migrations match rows by natural key (label, sort_order, name), never by id. Supersedes A1-review #5 and A1 #6 below: deleting all rows of these tables is no longer undone by a deploy.
5. In the same RUNBOOK deploy block: wait until every API replica is healthy before `healthcheck.sh`, recreate nginx when `infra/nginx` changed (single-file bind mounts never see files git replaced), and no `set -e` pasted into a login shell. RUNBOOK §7 now warns that the LOG_LEVEL step restarts every API replica at once (never during an exam).

**Confirmed by the second review but outside the A1.1 scope (owner, 2026-10-30), with their likely home:**
- *Hardening / `scripts/deploy.sh` (build step 9):* nginx never routes around a stalled replica (`max_fails=0` + `proxy_next_upstream error`, medium); ~5–10 s of 504s to a stopped replica's stale IP; sporadic POST 502 on reused idle upstream connections (align keep-alive timeouts); exported shell variables override `.env` for `migrate` only; the full-dependency audit can block hotfix deploys; `backup.sh` keeps every dump (retention); the green-CI deploy rule is not enforced by a script; RSC payloads (`text/x-component`) are not gzipped.
- *A2 (rate limiter and tests):* the breaker also trips on event-loop stalls (*fixed: A2.0 #6*); a hung-but-connected cache Redis still costs some requests 300 ms and grows the ioredis queue; the AppModule wiring tests run against `DATABASE_URL` and the shared cache Redis instead of the `*_test` database (*database half fixed: A2.1b #8*).
- *Next DB work:* the enum-literal catalog test misses unquoted type names and partial-index predicates; RESTRICT is asserted for only two foreign keys (Prisma's default for new optional relations is SET NULL).
- *Fixtures (low):* the server marker can also be satisfied per session (URL `options`, or a SET left on a PgBouncer connection); the per-run confirmation is documented, not enforced.

## 2026-10-30 — A1 approval and PayStation official docs (owner)

1. **A1 approved**, with conditions. **A1.1** stays small and deploy-only: a failed migration must not leave the API down; SIGTERM must drain; the Cloudflare real-IP refresh must never install an empty list; reference data moves into a migration. Each only where the second review's skeptics confirmed it. No further review rounds after A1.1: CI and tests are enough.
2. **Order:** docs → A1.1 → A2 (auth) → payments, then the rest of the Phase A order in `10-BUILD-PLAN.md`. This supersedes "Owner answers before Phase A" #1: payments come right after auth, because creating users needs auth's password hashing.
3. **A2 starts with four gates, before any auth code:** the exception filter never logs Prisma error messages; request logs carry no query strings or headers; placeholder or low-entropy JWT secrets are rejected; body-parser errors are answered as 4xx.
4. **No direct pushes to `main`** until OPEN-QUESTIONS #25 is decided: branches and pull requests only; the owner merges.
5. **OPEN-QUESTIONS #27** (non-superuser runtime DB role) is on the pre-launch checklist (RUNBOOK §9).
6. **PayStation, from the official docs** (summary: `docs/paystation/PAYSTATION-NOTES.md`). The docs confirm RULEBOOK §8's endpoints; a grant-token flow does not exist. Rules for the code:
   - **paid** only when `status_code` is `"200"`, `lowercase(data.trx_status)` is `success` or `successful`, the amount and invoice match, and `trx_id` is non-empty and unused. `failed` → failed. **Any other value is neither paid nor failed**: it stays pending, the reconciliation job looks again, and an alert is raised. The accepted list is updated after the sandbox shows the real values.
   - Our invoice number goes into the `callback_url` path (at most 200 characters). It is a hint only; verification is always through transaction status.
   - An empty `trx_id` is stored as NULL. **`2001` never marks a payment failed.**
   - `PAYSTATION_ENV=sandbox|live` → `https://sandbox.paystation.com.bd` / `https://api.paystation.com.bd`; live credentials are refused unless `NODE_ENV=production`.
   - The PDF and the Postman export stay local and git-ignored (shared sandbox credentials inside); `PAYSTATION-NOTES.md` is the committed, credential-free summary.
   - PayStation has **no refund API**: refunds are reconciled by an admin (RUNBOOK §11); what a refund does to a student's access is OPEN-QUESTIONS P8.

## 2026-10-30 — Email provider (owner)

1. **Resend** is the transactional email provider (OPEN-QUESTIONS #16 closed).
2. The notification module keeps a **provider abstraction**: Resend in production, **Mailpit** in development. Until the sending domain is verified (SPF/DKIM/DMARC), all email code is tested against Mailpit only.
3. The Resend API key lives only in env vars: never logged, committed, or put in `NEXT_PUBLIC_*`.
4. Every email goes through the **BullMQ queue with retries**. A failed or slow email never blocks registration, payment or login.
5. Built as part of **A2** (auth: verification and reset emails), not before.

## 2026-10-30 — A1 review fixes (Claude; findings verified by experiments before fixing)

An independent review plus a verification workflow (experiments in throwaway containers, skeptics, completeness critics) confirmed 16 of 18 review findings and 24 new ones; two were refuted (the leaderboard index is usable; `nginx:1.27-alpine` cannot float below 1.27.5). Supersedes A1 #4, #6, #8 and #17 below where they differ.

1. **Foreign keys are `ON DELETE RESTRICT`** except `sessions`, `auth_tokens`, `team_members` (cascade on purpose). Deleting a user, admin, round, task or grade with history fails (P2003); admin tools block or anonymise instead (M2 "no hard delete without audit").
2. **Raw-SQL CHECKs on enum columns compare `col::text`.** An enum-literal CHECK made every Prisma enum-recreate migration fail and recorded it as failed (P3009, reproduced). A catalog test fails on any new offender.
3. **`updated_at` has a DB default** (raw inserts work). Raw-SQL UPDATEs must set `updated_at = now()` themselves; raw inserts supply ids (`gen_random_uuid()` is acceptable). No DB-side uuidv7 default until Postgres 18.
4. **`promo_code` is CITEXT** (unique case-insensitively, like email).
5. **Seed semantics:** `settings` per key (new keys reach existing DBs, values never touched); `grade_levels`, `rank_thresholds`, `rounds` seeded once, only while empty. Later changes to those tables ship as SQL data migrations. If an admin deletes every row of one of them, the next deploy re-seeds it. *(Superseded by A1.1 #4: these tables ship as a data migration; the seed keeps settings only.)*
6. **Grace period:** `exams.grace_seconds` is the only source. The `submit_grace_seconds` setting was removed; `SUBMIT_GRACE_SECONDS_DEFAULT` only pre-fills the admin exam form. (The dev DB still holds the old key from the first seed; harmless, never deployed.)
7. **Dev fixtures guard:** the deciding layer is a server marker: Postgres started by `infra/docker-compose.dev.yml` carries `sirat.environment=development`, and fixtures refuse any server without it (an SSH tunnel to production has no marker). URLs with a `host`/`hostaddr` query key are refused (Prisma lets `?host=` replace the host). The confirmation is set per run, never pre-filled. Root `.env.example` defaults `NODE_ENV=production` and the api container pins it.
8. **Rate limiter:** 600 requests/min per route and client IP, no penalty block (`blockDuration: 0`), `/api/health` never limited. Fails open at once while the cache Redis is not ready, plus a 2 s breaker after a timeout. The Lua script restarts counting when a block starts and only gets integer ttl/block values.
9. **Readiness** never queues a PING on a disconnected client (the queue client kept them in memory); one PING in flight per client.
10. **Shutdown:** Prisma and Redis close in `onApplicationShutdown` (after Nest has closed the HTTP server); Redis `quit()` bounded to 2 s, then `disconnect()`; `stop_grace_period: 35s` (> nginx 30 s read timeout). Verified: SIGTERM exits 0 in ~4 s.
11. **Redis clients connect at boot** and log errors through pino (message only, rate-limited); no more raw ioredis stack traces.
12. **Nginx** pinned to stable `1.30.6-alpine`. Real client IP only from Cloudflare ranges (`infra/nginx/cloudflare-realip.conf`, refresh in RUNBOOK §10); spoofed headers from other peers are ignored (verified). `max_fails=0` and `proxy_next_upstream error` with 2 tries, so one slow request cannot eject a replica for everyone and timeouts are never replayed. Nginx-made 429/502/503/504 on `/api` are JSON; API responses pass through untouched.
13. **Compose:** json-file log rotation (50 MB × 5) on every service; `web` gets no env file; `migrate` gets only `DATABASE_URL`/`DIRECT_URL`.
14. **Docker:** `.dockerignore` is an allow-list; the `migrate` image copies only `node_modules` + `apps/api/prisma` (2.0 → 1.5 GB); the web image ships `apps/web/public`.
15. **Postgres** `log_parameter_max_length = 0`: no emails or hashes in the slow-query log. Unique-violation errors still log the key value (`DETAIL: Key (email)=…`): see OPEN-QUESTIONS #26.
16. **Queue Redis** `maxmemory 512mb` in a 1 GB container (AOF rewrite fork headroom) and no RDB snapshots.
17. **Next.js** `compress: false` (nginx compresses) and anti-framing headers (`X-Frame-Options: DENY`, `frame-ancestors 'none'`).
18. **CI is advisory on main:** GitHub Free private repos cannot enforce required checks (HTTP 403 verified). Deploy only a commit whose CI run is green (RUNBOOK §2). The docker job now starts the whole stack and checks it through nginx; CI also checks formatting, the `.sh` exec bit, and audits all dependencies (the migrate image runs dev dependencies).
19. **Node** `^22.13.0 || >=24` with `engineStrict`.
20. **Scripts:** backups are owner-only and verified by a full read before they get their final name; restore reads the whole dump before touching the DB and runs in one transaction; `healthcheck.sh` exits non-zero on failure; scripts are executable in git.

**Deferred, with owners:**
- *Start of A2 (gate before the first auth/users handler):* the exception filter must not log Prisma error messages (they contain query arguments); request logs without query strings and headers; reject placeholder or low-entropy JWT secrets; map body-parser errors (413/400/415) to 4xx instead of 500 (*these four: done, A2.0 #1–#4*); DB `statement_timeout`/`lock_timeout` for the app and a request timeout below nginx's 30 s; append-only trigger for `audit_logs` (*these: done, A2.1a #1–#3*).
- *Exam engine / ambassador / jury modules:* append-only triggers for `submissions`, `point_ledger`, `jury_scores` with their modules.
- *Leaderboard (A4):* query must be `WHERE exam_id = $1 AND score IS NOT NULL ORDER BY score DESC, time_taken_seconds ASC` (uses the index without a sort; do not add `NULLS LAST`).
- *Phase C:* a trigger so a registration can only reference a `paid` payment.
- *Hardening (build step 9):* non-superuser runtime DB role (OPEN-QUESTIONS #27); restore into a fresh database instead of `--clean`; `scripts/deploy.sh` with release tags.

## 2026-10-30 — PayStation sources and rules (owner)

1. **Official sources are only the merchant-dashboard Postman collection and the official docs PDF.** `docs/paystation/PAYSTATION-API.md` (built from the public page) is superseded and must not be used.
2. **RULEBOOK §8 endpoint names stay** (`/initiate-payment`, `/transaction-status`): the Postman collection confirms them. §8 is checked against the PDF when it arrives; no change before that.
3. **`PAYSTATION_ENV=sandbox|live`**; the API refuses to run with live credentials unless `NODE_ENV=production`. Implemented with the PayStation client (after A1 and after the PDF).
4. **`invoice_number` ≤ 20 characters and unique** (never reused). What the sandbox does with longer values is test S2 in `docs/paystation/SANDBOX-CHECKLIST.md`.
5. **Callback parameters, IPN and transaction-status v2 stay open** (OPEN-QUESTIONS P1–P3) until the PDF confirms them. *(Superseded 2026-10-30: the official docs confirm the IPN and v2; callback parameters stay open as P1.)* Paid is decided only from the transaction-status response (status success + amount + invoice match), never from the callback.
6. The Postman export holds credentials, so `docs/paystation/*.json` is git-ignored; only a redacted `*.redacted.json` may be committed.

## 2026-10-30 — Owner answers before Phase A (owner)

1. **Phase A scope = P0 backend only:** auth, exam engine, leaderboard/results, admin core. Rounds/jury/certificates/ambassador come later; registration + payment is Phase C. Note: the Phase A order line in `10-BUILD-PLAN.md` still lists payments and rounds/ambassador; this answer is newer and takes precedence until the owner updates that doc. *(Superseded 2026-10-30: follow the Phase A order in `10-BUILD-PLAN.md`; payments come right after auth.)*
2. **Test users before Phase C:** dev/test-only seed fixture (option a), guarded so it cannot run in production (see A1 #4).
3. **Git:** local commits and pushes to `origin main` (github.com/RaselMridha792/sirat-olympiad). Author/committer is the owner only; no AI co-author trailers. Never force-push without asking.
4. **Dev-only compose override** binding data services to 127.0.0.1 is approved (never used on the VPS).
5. **Seed defaults accepted as placeholders** (grade bands, rank thresholds); the owner confirms them with the client.
6. **Email verification is lazy** (confirms scaffold #10): login allowed, exam start requires a verified email. Provider not chosen yet; dev uses Mailpit (A2). **Admin 2FA** lands at the end of Phase A.
7. VPS specs: owner will confirm later (OPEN-QUESTIONS #22).

## 2026-10-30 — A1 foundation (Claude)

1. **UUIDv7 ids via Prisma `@default(uuid(7))`.** Generated by Prisma Client, not by a DB default, so raw-SQL inserts must supply ids. Why: RULEBOOK §6 prefers v7; time-ordered ids keep B-tree inserts local.
2. **`users.email` is CITEXT** (extension created at the top of the init migration). Why: `A@x.com` and `a@x.com` must be one account; enforced by the DB, not app code.
3. **Timestamps:** every table has `created_at`; every mutable table has `updated_at`. Append-only tables (`audit_logs`, `point_ledger`, `jury_scores`, `submissions`) have `created_at` only. `audit_logs.actor_id` is deliberately not a foreign key so the audit trail outlives the user row. All other links are real FKs, each with an index.
4. **Dev fixtures guard (4 layers):** `NODE_ENV` must be development/test, `ALLOW_DEV_FIXTURES=yes-this-is-not-production`, the DB host must be local (compose/production hostnames are refused), and `apps/api/prisma/fixtures` is excluded from every Docker image. Fixture users use the reserved `.invalid` TLD.
5. **Raw-SQL CHECKs** beyond the three in 05-DATABASE: `questions_per_attempt > 0`, `grace_seconds >= 0`, and `status = 'paid'` requires `trx_id` and `paid_at`. Prisma ignores CHECKs when diffing (verified by the drift check), so later migrations do not drop them.
6. **Config seed is insert-only** (`createMany` + `skipDuplicates`) and runs on every deploy in the `migrate` job; it never overwrites admin-edited values. Registration starts closed (`registration_open=false`) so the placeholder fee (0) can never be charged. To retire a grade level, do not delete it (the seed would re-add it); add an active flag when needed. *(Superseded by A1.1 #4.)* `package.json#prisma.seed` is not used (deprecated in Prisma 7); run `pnpm --filter @sirat/api db:seed`.
7. **Integration tests are separate** (`pnpm --filter @sirat/api test:int`, needs Postgres + Redis) and run only against a database whose name ends in `_test`. `pnpm test` stays unit-only. CI runs both.
8. **Rate limiter:** own Redis storage (one atomic Lua script, no extra dependency) behind a global `ThrottlerGuard`; counters are shared by all replicas. **Fails open** if Redis does not answer within 300 ms (warning logged at most every 30 s), because a cache outage must not take the API down on exam day; Nginx `limit_req` still applies. Default 120 req/min per client IP is a placeholder: A2 adds per-route tiers and per-user keys (schools share one NAT IP), and real client IPs need the Cloudflare `set_real_ip_from` list in Nginx (still TODO).
9. **`/api/ready`** checks Postgres (through PgBouncer), cache Redis and queue Redis in parallel, each with a 2 s timeout; failures are logged by name, clients get a generic 503.
10. **Migrations run in a one-shot `migrate` compose service** built from the Dockerfile `build` stage (it needs the Prisma CLI and tsx). The API waits for it (`service_completed_successfully`). The runtime image stays production-only.
11. **pnpm 10 `deploy --legacy`** in the API Dockerfile, and the Prisma client is generated again inside `/out` (deploy reinstalls packages).
12. **PgBouncer pinned to `edoburu/pgbouncer:v1.25.2-p0`, listening on 6432** (the image default is 5432, which did not match `DATABASE_URL`).
13. **Compose must be run with `--env-file .env`** from the repo root (otherwise compose reads `infra/.env`). Required variables use `${VAR:?message}` so a missing env fails loudly instead of creating blank passwords.
14. **Health checks use 127.0.0.1**, not localhost: in these images localhost resolves to `::1` while nginx/web listen on IPv4, so both were permanently unhealthy before.
15. **Nginx re-resolves upstreams** (`resolver 127.0.0.11` + `server … resolve`, nginx ≥ 1.27.3) so scaled/restarted API replicas get traffic without restarting nginx (verified by scaling 1 → 2).
16. **API `tsconfig` `incremental: false`.** With `incremental` + Nest `deleteOutDir`, the second build emitted only changed files (missing `dist/config/env.js`).
17. **Security overrides:** `multer` forced to `^2.5.0` (GHSA-q7qp-rjg7-q26m; Nest 11.2.8 still pins 2.4.0). `deepmerge-ts` advisory GHSA-ggr8-5vv4-36mx is ignored in `pnpm audit`: only the Prisma CLI config loader uses it, never with user input, and the fix is a major bump Prisma 6.19.3 does not support. Revisit both on the next Nest/Prisma upgrade. CI fails on any other high/critical advisory in production deps.
18. **Local dev ports:** the owner's machine already runs a Postgres on 5432, so the dev override uses 127.0.0.1:15432 (postgres), 16432 (pgbouncer), 16379/16380 (redis), 8080 (nginx).

Supersedes scaffold items 11 (throttler now Redis-backed and active) and 12 (Prisma client generated and migrations created on a normal machine).

## 2026-10-30 — Build strategy (owner)

Public frontend design is unconfirmed, so: backend first, then dashboards, then registration/payment perfected, public marketing site last. Details and Definition of Done: `10-BUILD-PLAN.md`.

## 2026-10-30 — Scaffold decisions (Claude, for owner review)

1. **pnpm monorepo, single folder** (`apps/web`, `apps/api`, `packages/ui`, `packages/shared`). Why: owner works in one folder; shared types/UI; one lockfile.
2. **Prisma 6.19, not 7/8.** Prisma "latest" on npm is a release candidate (8.0.0-rc) and 7.x changes the datasource config model. 6.19 is stable and matches the rulebook's `?pgbouncer=true` + `DIRECT_URL` guidance. Revisit after launch.
3. **`@sirat/shared` is compiled (CommonJS `dist/`)**, `@sirat/ui` is source-consumed by Next (`transpilePackages`). Why: Nest runs compiled CJS and cannot import TS source from a workspace package. Run `pnpm --filter @sirat/shared build` before api/web builds (CI must do this).
4. **Fonts self-hosted via fontsource**, not `next/font/google`. Why: no external request at build or runtime; Bangla support; the sandbox blocked Google Fonts and production builds should not depend on it.
5. **Tailwind v4 tokens in `packages/ui/src/styles/tokens.css`.** Brand colors copied from the old site: Primary `#E3621C`, Secondary `#083E5F`. Indigo/violet from old pages intentionally dropped.
6. **Session lifetime 7 days** (refresh), access token 15 min. The rulebook said 14–30 days; owner decided 7 days. `REFRESH_TTL_DAYS=7`.
7. **SDG removed.** Categories Activist/Ambassador/Achiever kept (grade bands to confirm). `assigned_sdg_number` and SDG topics are not in the schema.
8. **Rounds are data (`rounds`, `round_entries`)**, not `round_1..3` columns.
9. **Registration is pay-then-account** like the old flow, but form data is stored server-side in `pending_registrations`, and account creation happens inside the transaction that marks the payment paid. Why: fixes old C4 (one payment → many accounts) and the lost-form-data bug.
10. **Email verification: lazy (proposed).** Login allowed, exam start requires a verified email. Needs owner confirmation.
11. **Throttler is in-memory in the scaffold** (`ThrottlerModule.forRoot`). TODO before launch: Redis storage + per-route limits. Tracked in `04-FEATURES.md` build order step 2.
12. **Prisma client could not be generated in the scaffold sandbox** (engine download from `binaries.prisma.sh` returned 403). Schema was validated with the Prisma schema validator instead; `generate`/`migrate` must be run on a normal machine first.
13. **`reference/` holds the old UI + server source** for porting. `.env` files and public assets were excluded on purpose.

## Pending decisions (see OPEN-QUESTIONS.md)

Hosting fallback (Malaysia/AWS), email provider, domain/Cloudflare, question pool size, grace period, tab-switch logging default, `manager` role duties, ambassador approval flow, client confirmation of grade bands / fee / rank thresholds, VPS specs.

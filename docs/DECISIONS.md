# DECISIONS

One short entry per non-obvious technical or product decision. Newest first. Format: date · decision · why · who.

## 2026-11-01 — Ambassador tasks (core C5b-2; lead's plan, defaults and rules)

1. **Approval is final** (lead's default): one transaction with a row lock writes the ledger row `task:<assignmentId>` (task points, `task_id`, `created_by`) `ON CONFLICT DO NOTHING` and sets `approved`. A double click or three admins at once award once; a mistake is corrected with "Adjust points" (C5b-1), so the ledger stays append-only.
2. **Rejection** keeps the assignment open: the ambassador sees the note and may submit again.
3. **Proof is plain text only, no uploads** (lead): a pasted link is shown as text and never made clickable (a later change would be deliberate, with an allow-list).
   - **A minor's free text:** the proof is never logged and never written to an audit row. Audit rows keep ids and statuses only; the admin's note is not audited either.
   - The panel never sends the proof back; only admins see it, in the review queue.
4. **Submits are rate-limited** (lead): 10 per 10 minutes per ambassador on the route, on top of the per-user API limit, because a rejected task can be submitted again.
5. **Who:**
   - **Tasks:** admins create, edit (`expectedUpdatedAt`), archive and restore them; never deleted.
   - **Assignment:** approved, unblocked ambassadors only, all or nothing; an existing assignment is skipped (UNIQUE).
   - **Submitting:** an ambassador submits only their own assignment (another's is 404), and is re-read like the panel (a revoked one gets 403).
6. **Points** come from the task when it is approved, so an edit counts for later approvals only.
7. **Schema** (one generated and one CHECKs migration):
   - `admin_tasks.archived_at`; `task_assignments.proof_text`, `submitted_at`, `review_note`, and an index `(status, submitted_at)` for the queue.
   - CHECKs for the limits and the status rules (enum columns compared as `::text`).
   - `db-constraints.int-spec` got a longer task title (`'t'` → `'Task'`) for the new title CHECK.
8. **Web:**
   - `/admin/tasks`: Active, Archived and To review.
   - "Assign task" on /admin/ambassadors rows: the active tasks, ids and titles only.
   - "Send proof" on the ambassador panel, with the reject note shown.
   - `AmbassadorOverview.tasks[].id` is now the assignment (for submitting), with `reviewNote` and `submittedAt`.
9. **Tests:**
   - `ambassador-tasks.int-spec.ts` (10): task life cycle and refusals; assignment eligibility; submit, the queue and one award; three concurrent approvals award once; reject and resubmit with no proof or note in any audit row; own-assignment, archived and revoked refusals; the submit limit; admin only; the CHECKs.
   - web: the area file picks, the problem mapper.

## 2026-11-01 — The runtime database role sirat_app (Claude; LAUNCH-PLAN L2, OPEN-QUESTIONS #27)

1. **Two roles:**
   - The bootstrap superuser stays the owner of every object and runs the migrations, backups and restores.
   - `sirat_app` (no superuser, createdb, createrole, replication or bypassrls) gets data rights only:
     - `SELECT`, `INSERT`, `UPDATE` and `DELETE` on every table;
     - only `SELECT` and `INSERT` on the append-only tables, found by their `*_append_only` trigger (today `audit_logs`, `payment_events`, `point_ledger` and `submissions`);
     - nothing on `_prisma_migrations`;
     - no `TRUNCATE`, `REFERENCES`, `TRIGGER` or `CREATE`, and no temporary tables: PUBLIC loses `TEMPORARY` on the database. For a table name without a schema PostgreSQL looks in the session's temporary schema first, so a temporary `exams` table could stand in for the real one inside the trigger functions and get past the published-question guard (the L2 review showed it on PostgreSQL 17).
   - So an injected statement can no longer switch off the append-only triggers, set `session_replication_role`, truncate, change the schema, hide a table or run `COPY … TO PROGRAM`. Every app row lock (`FOR UPDATE`) is on a table with full data rights.
   - PostgreSQL still lets every role change its own session defaults and its own password, and drop the privileges granted to it (`DROP OWNED BY CURRENT_USER`, which also removes its default privileges, so tables created later lack its grants). The migrate job clears role-level settings on every run (item 2); a dropped grant needs a reviewed migration, and L8 decides how the migrate job checks for one.
   - Nothing switches yet. L8 points `DATABASE_URL` at the role and takes the superuser's password out of the app containers.
2. **The migration and the script:**
   - The migration `*_runtime_role` creates the role NOLOGIN and the grants, with `ALTER DEFAULT PRIVILEGES` for every later table and sequence. Its `_prisma_migrations` REVOKE is guarded: Prisma's shadow database (`migrate dev`, CI's drift check) replays the files into a database without that table.
   - `prisma/runtime-role.ts` runs in the migrate job between `migrate deploy` and the seed. It manages only the fixed name `sirat_app`. On every run it:
     - re-asserts the restrictions that a restore or a late-merged migration can undo: CONNECT for `sirat_app`, no `TEMPORARY` for PUBLIC, nothing on `_prisma_migrations`, no `UPDATE` or `DELETE` on the append-only tables. A dump without `--create` carries no database-level grants, and `pg_restore --clean` over a live schema re-creates each table under the default privileges. It adds no other right, so a later migration that narrows a table's grants stays in charge;
     - clears every role-level setting of `sirat_app` (for all databases and for this one), whoever set it, and warns with the count, never the values. None may be set on purpose: per-database values go in `ALTER DATABASE … SET`, per-job values in `SET LOCAL`;
     - puts back a database timeout only where it is missing: a restore loses them, and a later migration that changes one stays in charge;
     - gives the role its login from `POSTGRES_APP_PASSWORD` as a SCRAM-SHA-256 verifier computed in Node, so the plaintext never reaches Postgres. The script's connection sets statement logging, sampling and debug output off at connection start (`QUIET_SESSION`, the URL's `options`), and the `ALTER ROLE` is sent only after a check that they hold, so the verifier stays out of the server log whatever the server's settings. The derivation reproduces RFC 7677's client proof and server signature.
   - All steps run in one transaction behind an advisory lock: a second run on the same database waits (up to 30 s) and then finds nothing to change. Two runs at once used to fail with XX000 on the catalog rows both rewrote.
   - `--ensure` creates the role before a restore on a fresh cluster (L7). The script prints one line (plus a warning when it cleared settings), never a value.
3. **One password per cluster:**
   - On the dev cluster (`sirat.environment=development`) the password is set only while the role has none, so no worktree can reset another's. Changing it needs `ALTER ROLE sirat_app PASSWORD NULL` first, with the lead's or Rasel's go-ahead (RUNBOOK §0).
   - Until L8, an empty `POSTGRES_APP_PASSWORD` only skips the password step, and the line says whether an earlier login is kept. Test preparation never changes the password; it checks the login and explains a failure.
4. **Tests:**
   - CI's database job sets the role up as the migrate job does: `migrate deploy`, then `runtime-role.ts` with a throwaway password. So the role comes from the migration, and the script's own login is what the tests use. Between the two, CI checks the migrations' own result (no `UPDATE`/`DELETE` on the append-only tables, nothing on `_prisma_migrations`, no `TEMPORARY` for PUBLIC), then undoes one thing per repair step, so the tests also fail if the script skips a step. `TEST_APP_DATABASE_URL` is required in CI and must name the same host and database as `TEST_DATABASE_URL`.
   - The app under test (every AppModule test) and the create-admin CLI test run as `sirat_app`, so a missing grant fails in CI, not in production. The seed still runs as the owner in the tests; L8's docker job runs it as `sirat_app`.
   - `test/db-runtime-role.int-spec.ts` covers:
     - the role attributes, and its rights on the database and the schema;
     - every table's privileges, with the append-only set found from the triggers;
     - the exact default privileges, and a probe table and sequence;
     - the script's timeout rule, its re-assertion after a simulated restore, and its clearing of the role's own settings, each in a rolled-back transaction;
     - a SCRAM login on a scratch role (one name per test database, removed after);
     - that the app's `PrismaService` connects as `sirat_app`;
     - fourteen statements `sirat_app` must not run, each in a rolled-back transaction (each fails with 42501).
   - Unit tests keep the script's CREATE ROLE attributes and its timeouts equal to the migrations', and prove that it loads Prisma Client only after the `DIRECT_URL` check (a preload hook fails any load of it, by name or by file). An int test proves that `QUIET_SESSION` reaches the server.
5. **The boot line** `database role=<name> superuser=<bool>` in the API and the worker makes the RUNBOOK §9 item readable from the logs. In production it warns while the role is a superuser; from L8 a superuser is refused.

## 2026-11-01 — Ambassador points: the referral sweep, the settings and adjustments (core C5b-1; lead's plan and review)

1. **Who writes points:** a worker job, never payments' settle (their code is not touched).
   - One statement inserts `referral_paid:<paymentId>` per paid registration with a referrer, `ON CONFLICT (event_key) DO NOTHING`: repeats, two workers and the back-fill never award twice.
   - It reads payments' `registrations` and `users` only.
2. **Bounded** (lead): every 5 minutes over the last 2 days of registrations; nightly at 03:45 Asia/Dhaka over all of them.
   - The very first run looks at the whole table, so the launch-day referrals do not wait for the night. "First" means no `referral_paid:` row exists yet, found by a range on the UNIQUE index, not a LIKE scan.
   - The 5-minute run still reads the registrations table without an index on `created_at` (payments' table, none added); at 50,000 rows that is a few milliseconds, and the expensive part, the join and the conflict probes, is bounded.
3. **What counts:** a referral of an ambassador revoked since still counts (payments took the code while it was valid; earlier points stay).
   - The amount is the setting when the row is written; earlier rows never change.
   - 0 awards nothing, and a later value back-fills.
4. **Own queue** `ambassador-points` (lead: housekeeping is payments' now, so the ownership stays clear).
   - **Shared touches:** `worker.ts` (+1 module) and an optional `AMBASSADOR_QUEUE_NAME` (tests run their own queue).
   - **ops-check:** the queue is in its list as `ambassador`, so a failed run is a `failed_jobs` warning.
5. **Settings** (`/admin/ambassador-points`, its own resource; payments' `/admin/settings` allow-list is untouched): points per referral (the `ambassador_points_per_referral` setting, a new key in the insert-only config seed `DEFAULT_SETTINGS`, as the settings rule says (A1: the seed keeps the per-key settings); a data migration would break `seed.int-spec`'s fresh-deploy count) and the rank thresholds.
   - **One writer:** a transaction advisory lock, needed because the settings row may not exist yet. The admin sends the values they saw (`expected`); otherwise 409.
   - **Thresholds:** names and minimums are both UNIQUE, so the table is replaced in the transaction rather than edited row by row; nothing references it.
6. **Adjustments:** a new ledger row `adjust:<uuid>` with the admin as `created_by`, plus an audit row; never an edit. Only for an account with an ambassador profile (approved or revoked).
7. **Values:** the core plan's Q3 defaults (10 per referral, Bronze 0 / Silver 100 / Gold 250), unanswered by the owner and editable by admins, so an answer changes data, not code.
8. **Tests:**
   - `ambassador-points.int-spec.ts` (11): awards and amounts, repeats, three concurrent runs, revoked referrers, the 0 setting, the 2-day window and the back-fill, the two schedulers from two workers, settings changes with `expected` and their audit, two admins at once (one 409), threshold refusals, adjustments up and down with `created_by`, refusals, admin only.
   - unit: the first run, the bound window value, the setting fallback; the ops queue rule; web: the data pick, the problem mapper, the threshold rule.

## 2026-11-01 — The minute exam sweep tries each item on its own (exam session; lead's question after a test flake)

1. **Each finalize, score and results build in the sweep is tried on its own.** One that throws (a lock or statement timeout under load, a bad row) is logged with its step and id, and the rest go on. Before, the first exception ended the run, and since the sweep orders by `ends_at`, an attempt that kept failing would have held back every later attempt and the results build, minute after minute.
2. **The run then fails** (`exam sweep: n item(s) failed`), so the worker logs it and L11's `failed_jobs` check alerts (an ops alert at the first failure, hourly while it repeats). The next minute's sweep tries the item again. No per-attempt state: the log names the id, which an ops alert cannot carry (numbers only).
3. **A finalize that loses its row to `SKIP LOCKED` is not an error:** the holder wins (a late client submit, another sweep), and the next sweep takes the row if it is still unfinished. Both are now tested: a row held by another transaction is skipped, then finalized by the next sweep; an attempt whose finalize throws does not stop a later one.
4. **The test flake was the clock, not the finalize.** "Two finalizes, exactly one winner" got 0 winners once, under load: the test waited by this machine's clock, while finalize decides "due" with Postgres's `now()`, and the database container's clock can trail the host's. The test now waits on the database's clock. Worker jobs do not go through the HTTP busy-503 filter (#52), hence the isolation here.

## 2026-11-01 — Deploys: SHA-tagged images, a release file and deploy.sh (L9; exam session, LAUNCH-PLAN §2, owner Q4 default)

1. **Images are `sirat-<service>:<sha>`** (`image: sirat-<service>:${SIRAT_TAG:-latest}`). `latest` is the old compose default name, so CI and the shared dev stack see no change. On the VPS, `deploy.sh` writes `SIRAT_TAG` (and the previous one) to `/var/lib/sirat/release.env`, and the RUNBOOK's `$DC` reads it as a second `--env-file`. A command run by hand therefore uses the live images, and with `--no-build` (and `--no-deps` for app services) it never builds or touches a data service.
2. **A deploy never starts or recreates a data service.**
   - Each data container's `com.docker.compose.config-hash` label must equal `compose config --hash` for the commit; otherwise it stops with "data-service change pending: apply it as its own step".
   - `--first` starts them once on a fresh host, and refuses if any data container exists.
3. **Settings in `.env.deploy`** (git-ignored, mode 600, like `.env.monitor`), with the compose project always explicit. The CI gate reads the exact commit's CI run on main through the GitHub API, with a read-only token.
4. **Rehearsal mode** (refused for project `sirat`) accepts commits of a local branch and skips the CI gate, and says so in its first line.
5. **The order:** build while the live release serves; a backup only when the release adds migrations (none for the first release, which has no data); migrate (`config seed done` required); then `up --wait`. A failed backup or migrate stops before the switch, so the live API keeps serving.
6. **The smoke after the switch decides the rollback.** It checks:
   - exact 200s through the internal listener;
   - the public URL as `maintenance.sh status` says;
   - each API's PayStation boot line against `.env`, compared and never printed;
   - the worker healthy;
   - `prisma migrate status` with nothing pending or failed. "Missing from the local migrations directory" is accepted, since after a rollback the database keeps newer migrations.

   A failure goes back to the live release with no build and says loudly that migrations stay applied. A failed first release turns maintenance on instead.
7. **A rollback by hand warns about an exam window but does not refuse;** a deploy refuses within 30 minutes of one. A rollback is the incident fix.
8. **Image pruning keeps the last 3 releases** (the live and the previous one always). It removes only `<sha>` tags this script recorded, never `latest` and never a volume.
9. **The rehearsal runs on this machine's Docker** (the Q4 default without a VM).
   - Project `sirat-rh`, its own clone in a Docker volume mounted at the daemon's own path for that volume. Compose's relative bind mounts then name a path the daemon has, and file modes are real Linux ones.
   - The site name is a network alias of nginx, so the tools container reaches `https://sirat-rh.test` with real TLS (the self-signed certificate is trusted there).
   - The RUNBOOK's create-admin uses a hidden prompt; with no terminal, the rehearsal uses `--password-stdin`.
10. **CI checks the refusals on its own stack** (the development marker, a second `--first`). The full paths run in the rehearsal.
11. **Found by the rehearsal:**
    - **The smoke waits for nginx first.** Recreated containers get new addresses, and Docker may give an old one to another container. nginx re-resolves its upstreams only every 10 s, so right after a healthy `up --wait` the home page could answer 502. The smoke now waits up to 30 s (`DEPLOY_SETTLE_SECONDS`) for three good rounds through the internal listener before it judges.
    - **`--rollback` writes the release file as soon as the containers have switched,** before its smoke. The file never names a release that is not running, even when the smoke then fails.
    - **The first release must be the commit `--first` ran on,** because the data services take their settings from that commit's compose file. `--first` names it, and a refusal for a first release repeats it.
    - **An automatic rollback ends with the reason:** the failed checks and the app containers' states, which the rollback's own output would otherwise bury.

## 2026-11-01 — A busy database answers 503 SERVICE_BUSY, never 500; the registration start retries once (Claude; lead, A2's conditions)

1. **Found:** k6 at 25 starts/s while every CPU thread was busy, with a pool of 5 like production. 180 starts answered 500, all Prisma P2028 (start's interactive transaction ran out of maxWait or timeout); the global filter turned every non-HTTP error into 500.
2. **The filter** (A2's file, a minimal change; A2's conditions):
   - non-HTTP errors only: an HttpException, refresh's own 503 included, passes unchanged, without Retry-After;
   - exactly `isRetryableDbError` plus P2024 becomes `503 SERVICE_BUSY` with `Retry-After: 2`. That set means "nothing was applied, send it again": the transaction rolled back, or no connection was taken;
   - connection-lost errors (P1001, P1017) stay 500: they can hit during COMMIT with an unknown outcome;
   - the log is a warn line, "database busy", with class and code only, never the Prisma message.
3. **Login:** a busy database answers 503 and is never a failed login, because the account lookup fails before the limiter counts.
4. **The wizard** retries only the start, once: the same body and so the same `startRequestId`, after Retry-After (capped at 5 s) plus up to 1 s of jitter. A start that committed is replayed; one that rolled back starts fresh.
   - The payment retry, resume and the other calls are not retried automatically (A2: only idempotent calls). They show their error state.
   - After a second busy answer the wizard shows its "the server is busy" text (bn/en). The `startRequestId` is kept, so pressing the button again is safe too.
5. **Verified** under the same CPU hog and burst:
   - before: 180 × 500, 13 × 503 (the 25 s request timeout), 193 students without a checkout;
   - after: 0 × 500, 77 × 503 `SERVICE_BUSY`, all retried once and then 201, 0 students without a checkout; start p95 21 s → 14.6 s.
   The k6 script retries a busy start as the wizard does.
6. **The shared-IP test** (300 starts from one IP, then the 301st refused) no longer depends on wall time. The first start goes alone, its throttler window gets a long TTL, and all 301 count in that one window. It passed with a 61 s pause added.
7. **Not changed:** the transaction limits (answering 503 fast is better than waiting longer), and `connection_limit` (A2's L14 VPS tuning).

## 2026-11-01 — The audit-log viewer (core; lead's task, plan and review, M13)

1. **Admins only** (lead: not manager), re-read on every call. Read only: `audit_logs` stays append-only.
2. **The list never shows an IP, an email or the meta.** Opening a row shows them (`GET /admin/audit/:id`), and opening is not audited (as the students' detail, C1).
3. **Keyset paging on (created_at, id), newest first:** the log grows with every failed login, so there is no OFFSET.
   - The cursor carries the time to the microsecond. A JS Date keeps milliseconds only, and with it rows written within the same millisecond would be skipped; a test writes such rows and pages through them at four page sizes.
   - The cursor is opaque, checked against a strict pattern and passed as a bound value, never as SQL.
4. **Indexes:** `audit_logs (created_at DESC, id DESC)` and `(actor_id, created_at DESC)`, declared in `schema.prisma` (Prisma diffs indexes, so a raw-SQL index would fail the drift check) and generated into `*_core_audit_index`.
   - `audit_logs` is the foundation's table (announced to the lead). The migration must sort after the newest on main when it merges.
5. **Filters:**
   - **Action:** one exact action or a family (`auth.*`, matched with `starts_with`, so `_` is never a LIKE wildcard).
   - **Account:** an email (any case, looked up on the server; an unknown email matches nothing) or `system` (no actor).
   - **Dates:** Asia/Dhaka days, both included; a day that does not exist is refused.
6. **The export** (lead): the list's columns plus the meta, never the IP or an email.
   - **Redaction:** meta is written by many modules, so every email, Bangladeshi mobile number (with or without 88/+88) and IPv4/IPv6 address inside it is replaced before it reaches the file. Times such as `12:30:45`, ids, codes and invoices stay; unit tests feed each form.
   - **On the record:** the export's own audit row keeps the filters with the account only as a kind (`email`/`system`), the row count and the reason.
   - **Limits:** at most 50,000 rows, 5 exports per admin per hour.
7. **Web:** one `ExportCsvButton` (students and audit); its texts are picked in the client from a fixed table, so no message travels as a prop. `ExportUsersButton` is a thin wrapper.

## 2026-11-01 — The checkout time limit is PayStation's link lifetime: 10 minutes (Claude; S12, plan Q5/D3, lead)

1. **Measured (S12, sandbox, API only, no payment):** an unpaid checkout link works for about 9 minutes. At 10 it shows "Invalid or Expired Token".
   - v1 keeps answering `processing` for that invoice, so PayStation never tells us "expired".
   - With the old 60 minutes, "Continue payment" sent a student to a dead page for about 50 minutes.
2. **The rule was already set** (plan Q5, D3; the owner's): the time limit equals the link lifetime, never shorter. The lead applied it; it is not a new policy.
   - The seeded `payment_expiry_minutes` is now 10, and an invalid stored value falls back to 10.
   - After 10 minutes the student sees "Try again", which makes a new invoice.
3. **Nothing paid is lost:** a payment finished at 9:59 whose IPN comes after our expiry is still settled. The IPN asks for a check inside the 48 h late watch, and the check marks it paid (`late_success`, with its account). `payments-hooks.int-spec` covers exactly that sequence.
4. **Databases that already exist keep their row,** because the seed is insert-only. Production starts fresh and gets 10. On the shared dev databases, nobody changes the admin setting without asking.
5. **The "already in progress" message** no longer names a number of minutes (bn and en): an admin can change the setting.
6. **Re-measure on the client's live account** (plan §13; RUNBOOK §11).

## 2026-11-01 — "Coming soon" from a launch table (Claude; L1, LAUNCH-PLAN §8, lead review)

1. **The table:** `apps/web/src/data/launch.ts` has one row per `/dashboard` and `/admin` page, `live` or `soon`.
   - At this merge every page is live: only `admin.getStats` was still unwired, and core's #46 serves it.
   - Each owner flips its own rows.
   - A new page needs a row: `launch.test.ts` and `check-pages` fail without one.
2. **Amends "Web data layer over HTTP" #2:** a page the table marks `soon` shows `ComingSoon` instead of the error state its unwired methods would give.
   - `ComingSoon` is in `packages/ui`: `role="status"`, `data-state="coming-soon"`, neutral tokens, no retry button.
   - "Soon" comes only from the table, with no try/catch around data calls. A 404, 5xx or timeout still shows the error page.
   - With the API down, a soon page shows the error page too, because `requireAccess()` fails first.
3. **The guard:** `if (!isLive('<route>', data, params.mock)) return <ComingSoonPage title={…} />`, after `requireAccess()` and before the first data call. `launch.test.ts` reads each soon page and checks that order.
4. **Development:** the mock has every method, so every page is live there. `?mock=launch` previews the production view.
5. **`check-pages` prod is strict per route:**
   - a live page that shows the error state fails (until now such pages were only counted);
   - a soon page must show `ComingSoon` with HTTP 200;
   - a page without a row fails.
   `api-down` adds the first soon page, when there is one.
6. **The proof while every page is live:**
   - **A fixture table in `launch.test.ts`:** a soon row, a live row and a missing row; the mock with and without the preview; the order check on a guarded page, a late guard and a missing one.
   - **A local run** with one page temporarily marked soon (in the PR).
7. **The Bangla strings:** Rasel checks them (Q5).

## 2026-11-01 — Nightly session and token cleanup (Claude; L13, LAUNCH-PLAN §9, A2's notes, lead review)

1. **The rule is A2.1b #9 as recorded:**
   - sessions go 30 days after they expired or were revoked; a rotation revokes;
   - auth tokens go 7 days after expiry, used or not.
   - `rotate()` is unchanged. A refresh token replayed after its row was purged gets 401 'invalid'. It no longer ends its family or writes `auth.refresh_reuse`: the accepted loss.
2. **The schedule:**
   - its own `housekeeping` queue. Not "maintenance", which L5's maintenance switch already means (lead);
   - `30 3 * * *` Asia/Dhaka, one scheduler id, 3 attempts, failed jobs kept 7 days;
   - in ops-check, a failed run is a `failed_jobs` **warning**, not critical (lead): a missed night is not urgent, and the next night catches up.
3. **How it deletes:**
   - batches of 1,000 with `FOR UPDATE SKIP LOCKED`, each in its own transaction under `SET LOCAL statement_timeout` (5 s);
   - at most 50 batches per table and run;
   - idempotent: a retry deletes only what is left, and two runs at once both finish.
4. **Counts only:** one log line and one audit row (`housekeeping.session_cleanup`, meta `sessions`, `tokens`, `batches`, `more`). Never an IP, a browser or a token.
5. **Indexes:** `sessions(expires_at)`, `sessions(revoked_at)`, `auth_tokens(expires_at)`. Plain `CREATE INDEX` inside Prisma's migration transaction: the tables are small before launch, so `CONCURRENTLY` is not needed.
6. **AuditService** is provided in the worker module itself; it needs only Prisma. Importing the API's AuditModule would bring the alerts and the email queue.
7. **Tests:** every run gets an explicit `now`, and the rows sit days from each cutoff, so no result depends on timing. They cover:
   - 31 days deleted and 29 kept, for each branch on its own;
   - tokens: 8 days deleted, 6 kept;
   - the batch cap and "more", a second run deleting nothing, and two parallel runs;
   - the other tables and the append-only logs unchanged, apart from the one audit row;
   - the HTTP replay → 401 while the live session still refreshes;
   - two worker inits → one scheduler, and its job runs the cleanup.
   Mutation checks (cutoff 30 → 28 days, OR → AND, no batch cap) each fail the unit and the integration tests.
8. **Next:** payments' D6 payload scrub (abandoned attempts after 30 days) joins this job as a follow-up after L1 (lead).

## 2026-11-01 — Admin statistics on the admin home (core; lead's task and review)

1. **Counts only** (`GET /admin/stats`, admin and manager): no name, email, phone, id or money sum. A test scans the answer.
   - **Roles:** the user is re-read on every call, so a demoted or blocked one gets 403 at once.
   - **Jury** gets a short welcome on `/admin` and the page makes no call (lead: least privilege; letting jury see the counts later is a one-line role change).
2. **One snapshot:** every count is read in one `REPEATABLE READ` batch transaction on one connection, so the totals agree with the breakdowns and the queries never take more than one pool connection.
3. **Cache:** 60 s in the cache Redis (`admin-stats:v1`); `asOf` says when the counts were computed.
   - **Single flight:** a lock (`SET NX PX`, released only by its holder) makes a burst compute once. The others wait up to 5 s for that result, then compute on their own.
   - **The lock holder looks at the cache once more before computing** (fix, 2026-11-01, found by exam's CI): a request that missed the cache just before the leader wrote it, and took the lock just after the leader released it, used to compute a second time. The burst test now holds the leader until all six requests have tried the lock, and a separate test feeds one stale miss.
   - **Redis trouble:** every call reads Postgres, with a warning logged at most every 30 s.
   - **No invalidation:** counts up to a minute old are fine for an overview.
4. **Others' tables, read only:** payments' `registrations`, `payments` and `pending_registrations`, and exam's `attempts`. No index was added to them.
   - The 45-day per-day `GROUP BY` on `registrations.created_at` (Asia/Dhaka days, UTC+6 all year) runs at most once a minute behind the cache.
5. **Where it lives:** in the scaffold's empty `AdminModule`, which was already in `app.module.ts`, instead of a new module (lead's plan said a new `AdminStatsModule` with one line there). The audit-log viewer joins it next.
6. **Shape:** `AdminStats` (`dashboard.ts`) keeps the UI port's fields, so the page's cards and charts stay.
   - `secondRound` and `finalists` are `null` until rounds exist (C6); the page hides their card and pipeline stage.
   - New fields: `registrationAttempts`, `paymentsByStatus` (without `refunded`, which is never entered), `paymentsNeedingReview` (payments' own "needs review" rule: a `review_reason` is set) and `ambassadors`.
7. **Tests:** `admin-stats.int-spec.ts` (6) and the `dhakaDays` unit spec.
   - `admin-stats.int-spec.ts` covers every count as a difference around its own rows (the test database is shared), the Dhaka day edges, the burst computing once, the cache serving the same `asOf`, the Postgres fallback, the roles, and the counts-only scan.
   - web: `http/stats.test.ts` (picks at every level, shape refusals).

## 2026-11-01 — Exam authoring screens (E5b; exam session, EXAM-PLAN §5, on E1's API)

1. **Times are Bangladesh time whatever the admin's browser clock:** the form converts with a fixed UTC+6 (no daylight saving time in Bangladesh) and sends UTC. A wall-clock time that does not exist (30 February) is refused before sending. Announcements use the browser's clock; exam windows must not move with an admin abroad.
2. **One settings form for new and edit, on its own pages** (`/admin/exams/new`, `/admin/exams/[id]/edit`), not a dialog on the detail page.
   - The edit page gets the settings only (`pickSettings`: no questions, so no answer keys), with `updatedAt` as the version it sends back; the e2e checks the page for a question canary.
   - A published exam shows every field, the frozen ones read-only with why. Only the title and a later close are sent; the latter needs a reason (3–200 characters).
   - The patch carries only what changed: an unchanged frozen field is never sent, so it cannot be refused.
3. **The question dialog letters options by their place** (A, B, C...): removing one never leaves a gap, and the correct choice follows its option. Two options that read the same (case and spaces aside) are refused in the browser, though the API would take them.
4. **What the buttons offer follows the API's rules** (`questionRules`, `stateActions`):
   - **a draft:** add, edit in place, delete;
   - **a published exam:** an edit says "Save as version n+1"; add and retire only with a random draw, and retire only while more than the questions per attempt stay active;
   - **an archive:** nothing.

   The server still decides, and a refusal lists every reason it gave (publish can fail several checks at once).
5. **No round field** until rounds have an API (core C6): a new exam has none.
6. **A browser e2e, `e2e:exam-admin`,** run on the exam session's own throwaway database. Like `e2e:exam`, it is a by-hand stack test, not a CI step.

## 2026-11-01 — Registration surge, local k6 (Claude; payments PR 5, plan step 13; provisional until the VPS)

1. **The scenario** (`loadtests/registration-surge.js`). One iteration is one student, as the browser would do it:
   - the register page, then `start`;
   - 80 % open the checkout and pay, then come back through the callback twice;
   - the result page polls on its own schedule until "completed".
   It runs only against the fake PayStation, and stops if the checkout is anything else. No admin is needed; registration must already be open.
2. **Where:** throwaway containers (`sirat-pay-load-*`, `--rm`) with this worktree's API and worker. Nothing touched `sirat` or `sirat_pay`.
   - The PC (12 logical threads) is shared with the other sessions. These numbers are provisional regressions only.
   - DoD #17 closes only on the VPS (plan 8.1).
3. **The rate:** 4 starts/s is 14,400 an hour, more than half of all 25k students in one hour. No registration peak is written down anywhere: if the owner expects a different launch burst, the VPS run uses that.
4. **Results** (p95 in ms; errors are our API's, 4xx/5xx; "completed" = paid students who saw "completed" while the page polled):

   | Run | API p95 | start | info | callback | current | Errors | Completed | Settle p95 | PC CPU (median / p90) |
   |---|---|---|---|---|---|---|---|---|---|
   | 2/s, 3 min | 132 | 240 | 14 | 48 | 37 | 0 of 2,088 | 325 of 325 | 2.3 s | 56 % average |
   | 4/s, 5 min | 261 | **819** | 70 | 177 | 132 | 0 of 6,749 | 1,053 of 1,053 | 2.5 s | 78 / 98 % |
   | 4/s, 3 min (repeat) | 231 | **756** | 63 | 159 | 82 | 0 of 4,008 | 620 of 620 | 2.5 s | 61 / 99.5 % |

5. **Reading the numbers:**
   - The API as a whole passes in every run (p95 < 500 ms, errors 0 %).
   - `start` alone misses 500 ms at 4/s. On the server side it is the same (797 ms): it is not k6.
   - At rest `start` costs about 60 ms: the argon2id hash is 26 ms here (19 MiB, t=2), one DB round trip is 1.6 ms (about ten of them), plus the gateway call. There is no global lock in it (row locks only on the student's own attempt).
   - During the 4/s runs the PC hit 98–100 % CPU at its 90th percentile, while this API and worker used about 5 % of the machine. So the tail comes with the shared PC's load. On the VPS, `start` is measured again at the target rate.
   - If it still misses there, the first step is more API replicas (RUNBOOK §3), not a weaker argon2 (it is at the OWASP minimum).
6. **No growing queue:**
   - The settle time stays at one poll interval (p95 2.3–2.5 s; the page reads every 2 s).
   - After the runs the worker queue had nothing waiting or active.
7. **Limits to remember on the VPS:**
   - Through nginx the generator's single address meets the start limit (300/min per IP). Keep `RATE` at 4 or less per generator machine.
   - PayStation's IPNs come from a few addresses, and the IPN limit is 600/min per IP. Above 10 payments/s per PayStation address, IPNs get 429. They are only a hint: the callback and reconciliation still settle the payment. The VPS run checks this with the real nginx.

## 2026-11-01 — Ambassadors: admin approval, server promo codes and the panel (core C5a; plan `docs/plans/CORE-PLAN.md` section 6, Q2 default)

1. **A promo code is attribution only** (lead, owner decision). It records who brought a registration and changes no fee, amount or payment. Anything that would make it a discount goes to the lead and the owner first.
2. **Approval** follows Q2's default (OPEN-QUESTIONS #12 is still open). An admin makes a paid student an ambassador from the student's detail or the ambassadors list; there is no application form.
   - **One transaction:** re-read the admin, lock the user `FOR UPDATE`, refuse `wrong_role`, `blocked` or `not_paid_student`; create the profile with a server code (`SR-` + 6 Crockford characters from `crypto.randomInt`) or re-approve the old row; role → `ambassador`; audit `ambassador.approved` with the reason.
   - **A code collision** (P2002) aborts the Postgres transaction, so the whole transaction is retried, at most 3 times.
   - **Already approved:** 200, nothing is written.
3. **Revoking keeps the row:** `approved_at` → NULL, role → `student`, audit `ambassador.revoked`.
   - Payments' `referrer()` accepts a code only while `approved_at` is set, so the code stops working for new registrations at once.
   - Earlier referrals and points stay. The code (UNIQUE) is never given to anyone else, and a re-approval gives the same code back.
4. **The panel** (`GET /ambassador/me`) re-reads the role and the block on every call, so a revoked ambassador with an old token gets 403.
   - Referrals show only the name, institution and date.
   - Points and rank come from `point_ledger` and `rank_thresholds`; team and tasks stay empty until C5b.
5. **Database:** one hand-written migration, `*_core_ambassador_checks`. It adds the promo-code format CHECK (payments' DTO pattern) and append-only triggers on `point_ledger`: UPDATE, DELETE and TRUNCATE are refused, except TRUNCATE in a `*_test` database.
   - Payments' `db:fixtures:dev --clean` still works on a dev database (checked on a throwaway one named `sirat`, with ledger rows): it deletes only registrations, payments and attempts, and no ledger row depends on them.
6. **Web:**
   - **The panel:** the held branch `feat/ui-ambassador` was merged in (lead's OK), not rewritten; its page now calls `requireAccess`. `data/http/ambassador.ts` reads the panel and the admin list with shape checks and explicit picks.
   - **Admin:** approve and revoke buttons with a reason dialog, in the student detail and the ambassadors list, through `lib/api.ts`.
   - **The student home falls back per section.** Only the profile is required. Exams, announcements and the registration card each show their own empty or "could not be loaded" state when their call fails, so an outage in one area does not take the whole home down.
     - `DashboardHome.registration` is null when payments' answer could not be read.
     - A redirect or not-found raised inside a section is passed on, never swallowed.
     - Payments' book card (#42) reads its own data, so the home wraps it (`BookSection`): when `GET /book-order/me` fails, only that card says it cannot be shown. Checked in a control run: without the wrapper the whole home failed.
7. **The leak check** follows the lead's conditions:
   - `check:leak` also scans the pages only an ambassador may open, with `CHECK_AMBASSADOR_EMAIL` / `_PASSWORD`; missing variables fail the run.
   - In CI the admin approves `student2@fixtures.invalid` through the real endpoint, in the job's throwaway database only (no fourth fixture user). A failed approve fails the job with its HTTP status and refusal code.
   - The ambassador's password is the fixture password, set and masked in the same step as the others.
8. **The role in the access token** (lead's review):
   - **The window:** the web's session reads the role from the database (`GET /auth/me`, cached up to 30 s), but the API's guard reads it from the access token. A token issued before an approval still says `student` until it is renewed (at most the access TTL, 15 minutes).
   - **What the student sees:** within 30 s of the approval the Ambassador menu item appears. The panel's 403 sends them once through `/refresh` (`isRoleBehind`); the new token carries the new role and the panel opens. No error state and no wait. `/refresh`'s own loop guard ends at `/login`.
   - **After a revoke:** an old ambassador token gets the same renewal and then the not-found page. Within 30 s the menu item is gone.
   - Checked end to end on the real API with a throwaway database. In a control run without the renewal the panel did not render: the refused read goes to its error state until the token expires.
9. **Tests:**
   - `ambassadors.int-spec.ts` (9): only admins; each refusal; one transaction (role, profile and audit together); an idempotent approve; revoke and re-approve; the list and the panel from rows; a revoked ambassador's old token; the CHECK and the ledger triggers.
   - **The promo rule** runs through payments' real `RegistrationService.referrer()`, the same check `POST /registrations/start` makes, in any letter case. It does not run the whole start route: that needs a full form and the gateway, and payments' own tests cover it.
   - **web:** `http/ambassador.test.ts` (canaries, shape refusals, the admin pick), `ambassador-problem.test.ts`, and `http/home.test.ts` (each section falls back on its own; a redirect is not swallowed).

## 2026-11-01 — Maintenance switch: a flag file nginx checks on every request (L5; exam session, LAUNCH-PLAN §7)

1. **The flag** is `infra/nginx/maintenance/on`, inside the folder compose already mounts at `/etc/nginx/sirat`: no compose change and no reload, because nginx looks for the file on every request. The folder stays in git (`.gitkeep`), so the mount always has it; the flag itself is ignored. `scripts/maintenance.sh on|off|status` touches only that file.
2. **Server level, public servers only** (`infra/nginx/maintenance.conf`, included by sites/tls and sites/plain). The internal listener never includes it, so checks from the server always reach the app.
3. **What passes:** `/healthz`, the PayStation IPN and the callback.
   - The lead asked for both PayStation paths; §7 named only the IPN. The callback only records the return and redirects to the result page, which then shows the maintenance page, and letting it through queues the status check sooner.
   - A map on the raw `$request_uri` decides `pass`, `json` or `page`. A request passes only when the path it sent is exactly an exception: on `$uri`, a path that nginx normalises into one (`/dashboard/../api/payments/paystation/ipn`) passed, and nginx sends the path upstream as sent. The callback takes one plain segment (letters, digits, `_`, `-`).
   - Regexes only: `map` compares plain strings without regard to case, so `/API/...` passed to the web (found by the test).
4. **Pages get the page through `error_page`:** it keeps the status and turns any method into GET (a static file answers a POST with 405). That internal redirect runs the server-level check again, so the page's own path is exempt. Other `/api` calls get JSON `code: MAINTENANCE` in the API's error shape.
5. **The same page replaces nginx's own 502/504** on pages and on the callback, with the status kept so checks see the real code. Other `/api` calls, the IPN included, keep the JSON errors: PayStation retries.
6. **Both answers** carry `Cache-Control: no-store` (Cloudflare must not keep them), `Retry-After: 120` and each security header once.
7. **The text:** a generic bn/en "we'll be right back" with the "your payment is safe" line and no contact details (LAUNCH-PLAN §10 default; Rasel checks the Bangla). Plain HTML with inline styles and no scripts or fonts, so it needs nothing from the web container.

## 2026-11-01 — Free book on the web (Claude; payments PR 6b, plan §16.4, lead's rules)

1. **`/dashboard/book`:** the title and the cover, then the address form, pre-filled from the student's own name, phone and district.
   - The form posts and waits for hydration.
   - Once an order exists, every save sends the version the page showed (`expectedVersion`). An old tab then gets 409 `BOOK_ORDER_CHANGED`; it never overwrites a newer address (lead, 2026-11-01).
   - After shipping the page is read only (409 `BOOK_ORDER_SHIPPED` if a stale form tries).
2. **The result page sends a paid student to log in, then to the book:** `/login?next=/dashboard/book`. There is no session after paying (D2), and A2's `safeNext` accepts the path (`links.test.ts`).
3. **The dashboard card** (`components/book/BookOrderCard.tsx`) is a server component core's home composes with one line (`<BookOrderCard data={data} locale={locale} />`); whoever lands second adds it (lead). It shows the status and the district only, never the address.
4. **Admin only** (`/admin/book`, `/admin/book-orders`):
   - the title with `expected` and a reason;
   - the cover with a local preview and a quick size and type check before sending (the API decides by the bytes);
   - the orders list with GET filters;
   - "Export for courier" (the current status and district, saved as a file; the page reminds the admin to delete it afterwards);
   - "Mark shipped" for the ticked confirmed orders, after a confirmation that says it cannot be undone.
5. **`lib/api.ts`:** a `FormData` body keeps the browser's multipart type (the cover upload); JSON bodies still get `application/json` (A2's file, one line plus a test).
6. **Data layer:** `data/http/book.ts` picks fields one by one. A cover URL is accepted only as our own `/api/book/cover/<uuid>` path, so a page never loads an image from elsewhere. The mock serves the demo student's order, and `?mock=leak` covers the student methods.
7. **`e2e:register`** now continues after "Registration complete": it logs in from the result page, confirms an address on `/dashboard/book` and changes it. The dev web needs `DATA_SOURCE=http` for that step (RUNBOOK §0).

## 2026-11-01 — Server checks: ops-check, monitor.sh and the daily digest (L11; exam session, A2's plan and handover)

1. **Thresholds in TypeScript** (`apps/api/src/modules/ops/ops-rules.ts`, the launch defaults of LAUNCH-PLAN §6): pure functions with table tests for every threshold, the two-run rules (CPU, memory, containers, workers) and the alert transitions. L14 retunes the numbers after k6.
2. **Alerts on transitions:** an `ops.<check>` alert when a check changes level, an hourly reminder while it stays warn or critical, and one "resolved" alert (`level: 0`). They go through the ops category's own cap (L10); the digest counts the held-back ones from the audit log.
3. **State in a file on the host,** kept by `monitor.sh` (`/var/lib/sirat/monitor-state.json`) and handed to ops-check on stdin: no table and no cache key. A lost state means one repeated alert at worst.
4. **ops-check reads the app facts from the queue Redis only:**
   - workers per queue;
   - waiting jobs and the oldest one's age;
   - jobs failed for good since the last run (BullMQ keeps a job in "failed" only after its last attempt);
   - payments' reconciliation, from its job scheduler's next run time: late by more than 3 intervals is critical;
   - the queue Redis memory.

   It touches no payments file.
5. **Host facts in bash** (`scripts/monitor.sh`):
   - plain awk only (Ubuntu's mawk has no capture groups); nginx's access line is split on double quotes, so retried upstreams (`"0.002, 0.004"`) and nginx's own answers (`"-"`) parse;
   - memory from MemAvailable, so the page cache does not count;
   - the backup age from a root-owned, world-readable `/var/lib/sirat/last-backup` (`created_at` and `sha256` only), which `backup.sh` writes after each upload that worked: the backup directory stays root-only, and a failed run never makes the check look fresh.
6. **The heartbeat:** success only with no critical check; otherwise `/fail` with the check names (never values). ops-check that cannot run counts as critical (`monitor`). While `deploy.sh` holds its lock, `/fail` is held back.
7. **The digest:** once per Asia/Dhaka day, guarded by an `ops.digest` audit row carrying the date (YYYYMMDD), not by a cache key that could be evicted. Counts and kinds only.
8. **The ops commands read their settings explicitly** (`apps/api/src/cli/ops-env.ts`). `validateEnv` cannot run outside the Nest app: it converts numbers through decorator metadata, which tsx does not emit and which needs `reflect-metadata`.
   - This also fixes L10's `ops-alert`, whose `main()` failed on every numeric setting; its integration test called `raiseOpsAlert` directly and never ran `main()`. Both commands now ran end to end against the test database and Redis.
   - Their email queue is created after the Redis clients connect: BullMQ connected the client itself first, so `connect()` threw.
9. **`healthcheck.sh`'s exact 200** came with L3 (#37), so L11 leaves it alone.

## 2026-11-01 — Free book: API, schema and the cover upload (Claude; payments PR 6a, plan §16, owner B1–B5)

1. **Schema:** `book_orders` (one per student) and `book_images` (covers in Postgres, bytea), migrations `*_book_orders` (generated) and `*_book_checks` (hand-written).
   - The composite foreign key `(registration_id, user_id)` → `registrations (id, user_id)`: an order exists only for the student's own registration, and a registration only for a paid payment.
   - CHECKs: the phone, the 64 districts, lengths, and shipped ⇔ `shipped_at` and `shipped_by` both set (both empty otherwise).
   - Trigger `book_orders_locked_after_shipping`: a new order starts `confirmed`; once shipped, the address, the recipient, the title and the status cannot change.
2. **One list of districts:** the CHECK holds `BD_DISTRICTS` (the registration form's list); `districts-check.spec.ts` fails if the migration and the constant ever differ.
3. **The student's routes are "me" only** (`GET /book`, `GET/PUT /book-order/me`; roles student and ambassador).
   - The user comes from the session. 403 `BOOK_NOT_ELIGIBLE` without a registration. 409 `BOOK_ORDER_SHIPPED` after shipping. 409 `BOOK_ORDER_CHANGED` for a stale `expectedVersion` (or two first saves at once).
   - The order keeps the title it was confirmed with (B7).
4. **The cover** (`book-image.ts`, no new dependency):
   - the type from the magic bytes only (JPEG, PNG, WebP); at most 800 KB (multer memory storage, 413 above); 100–4000 px from the header;
   - metadata stripped (JPEG APP1/APP13/COM, PNG text/eXIf/tIME, WebP EXIF/XMP with the flags fixed), and bytes after the image's end dropped;
   - stored once per content (sha256).
   - Served by `GET /book/cover/:imageId` (public, the only new public route) with the stored type, `nosniff`, `default-src 'none'` and a one-year immutable cache (the id changes with each cover).
5. **Admin only** (a manager gets 403): the title (with `expected`, 409 `SETTING_CHANGED`), the cover, the orders list (phone in any form, matching the recipient's or the student's; email in any case; district; status), the courier CSV and shipping.
   - **The CSV:** core's `common/csv.ts` (BOM, CRLF, formula-injection prefix); streamed in batches of 500, never stored; audited with the filter and the count, never the rows.
6. **No address in logs:** the request logger keeps only the method, the path and the status; the book module has no logger (`book-no-logs.spec.ts`); audit rows carry ids, counts and filters only.
7. **Seed:** `book_title` ("Sirat Leadership Olympiad book" until an admin sets the real one) and `book_cover_image_id` (null). RUNBOOK §9 asks for both before registration opens.

## 2026-11-01 — Next's runtime caches are writable by the web's runtime user (Claude; lead's bug report)

1. **The bug:**
   - Since #25 the public pages revalidate every 60 s, so Next regenerates them at runtime. It writes the pages to `.next/server/route-cache` and fetch results to `.next/cache`.
   - The image copied `.next` as root and runs as `node`.
   - So every regeneration logged `Failed to update prerender cache … EACCES` and stored nothing. The pages still answered 200, but every request after the 60 s tried to regenerate again.
2. **The fix:** the image creates only those two folders and gives them to `node`. The rest of `.next` stays root-owned, so a compromised server process cannot rewrite the built app.
3. **Proof:**
   - CI's docker job requests a public page, waits past the 60 s revalidation, requests it again, and fails on any EACCES in the web log.
   - A/B with the same image: with the two folders handed back to root (main's state), 6 EACCES lines; with this change none, and the regenerated pages appear under `route-cache/APP_PAGE`.
   - No write was attempted anywhere else in `.next`.

## 2026-11-01 — Alert categories, their own caps, and the ops-alert command (L10; exam session, A2's plan and handover)

1. **Categories:** `security`, `payments`, `ops`. `ALERT_CATEGORY` is a `Record<SecurityAlertKind, AlertCategory>`, so a new kind without a category fails typecheck (payments' kinds included). The email subject names the category. The "Account:" line names the account when there is one. Without one, a login alert keeps "no account with that email" (owner-approved, #7: someone is trying an email that has no account). Payments and ops alerts then have no Account line: they carry their own details, and the login wording would mislead there (a payment set aside for `email_taken`, for example).
2. **Caps per category (owner Q2, launch-plan default 6 each):** the limiter's hourly key is per category, so a flood of failed logins can never use up the cap and silence a payment or backup alert. `SECURITY_ALERT_EMAILS_PER_HOUR` keeps its name and now means "per category". The 10-minute pause per kind is unchanged.
3. **Audit actions keep `security.<kind>`** (for example `security.ops.backup_failed`), so payments' and A2's existing queries and tests stay valid.
4. **Boot warning:** a production server (`NODE_ENV=production`) with a blank `SECURITY_ALERT_EMAIL` logs one warning at boot from `SecurityAlerts.onModuleInit`; `main.ts` is unchanged. It never logs an address.
5. **`ops-alert` CLI** (`apps/api/src/cli/ops-alert.ts`, `pnpm --filter @sirat/api ops:alert`):
   - **Allowed kinds:** only those of the `ops` category, so a script can't forge a security or payments alert. Today that is `ops.backup_failed`, `ops.monitor_failed` and `ops.alert_test`.
   - **Details:** numeric `key=value` only (at most 10), so no text, and so no personal data, reaches an email.
   - **Before raising:** it checks the database and both Redis, because the audit write never throws, and the limiter and the email queue skip a Redis that is not ready yet. Then it waits until the email is queued.
6. **`backup.sh` uses it** on any failure, after the heartbeat's `/fail`: `ops-alert --kind ops.backup_failed --meta step=<n>`, with a number per step and a 60 s timeout.
   - **Best effort (lead):** when the API cannot raise it (the api container down is a likely moment for a failed backup), the run still exits non-zero, and the heartbeat, which does not depend on the app, is the alert.
   - **Tests:** the call and its step number; an ops-alert that fails; no api service at all; successful runs raise nothing.

## 2026-11-01 — TLS behind Cloudflare, security headers and nginx logs (Claude; LAUNCH-PLAN L3, lead review)

1. **Certificate:** Cloudflare SSL mode Full (strict) with a free Cloudflare Origin CA certificate. It needs no ACME client and no API token on the server, and Cloudflare trusts it for 15 years. No Cloudflare Tunnel (an untested component in the critical path). Authenticated Origin Pulls come after launch. A Let's Encrypt fallback (DNS-01) is only documented (RUNBOOK §15).
2. **Two sites, one set of locations:**
   - `infra/nginx/sites/tls` (production):
     - Port 80 answers `/healthz` for any name and redirects only the site's own name. Any other name has its connection closed.
     - A default 443 server refuses any other name during the handshake.
     - So a scanner on the server's IP never sees the host name, on 80 or on 443. A targeted scan that sends the host name can still find the origin, so the Cloudflare-only firewall (L4) and Authenticated Origin Pulls stay the full answer.
     - The real 443 server runs HTTP/2 and TLS 1.2/1.3.
   - `sites/plain` (dev and CI) is plain http, so e2e and the smoke tests on http://127.0.0.1:8080 do not change.
   - Both include `app-locations.conf`. The site is rendered at start by the image's entrypoint. `PUBLIC_HOST` comes from `APP_URL` (`entrypoint/15-public-host.envsh`), one source of truth, and the container stops with a message if it is not `https://<host>`.
3. **A folder mount:** compose mounts the whole `infra/nginx` folder at `/etc/nginx/sirat` and starts `nginx -c /etc/nginx/sirat/nginx.conf`. `nginx -s reload` then sees files that git or the refresh script replaced (single-file mounts kept the old inode). A changed site template or entrypoint hook still needs a recreate, because they are read at start.
4. **IPv4-only published ports** (`0.0.0.0:80`, `0.0.0.0:443`). An IPv6 listener would make Docker's proxy replace the client address.
5. **An internal listener, `127.0.0.1:8081`:** in the container, never published, with no redirect. Checks from the server use it: the deploy smoke, maintenance and restores (LAUNCH-PLAN L5, L7, L9). A client-address exception on the public servers would be unreachable on the VPS, because host requests never arrive from the container's loopback.
6. **Headers:** one include (`security-headers.conf`), at server level and in every location with its own `add_header`, nginx's JSON errors included. API answers are the exception: helmet already sends nosniff, a Referrer-Policy and its own CSP there, so the `/api` locations add only HSTS (`api-headers.conf`, whose `add_header` also stops the server-level set). Each header then appears once (payments' smoke checks this on `/api/book/cover`; the CI smoke checks it on `/api/health`).
   - nosniff and Referrer-Policy.
   - HSTS only on https (a map on `$https`), 300 s at launch, without `includeSubDomains` (owner question Q3 sets the ramp). Helmet's HSTS is off (`strictTransportSecurity: false`): its default of 1 year with `includeSubDomains` would bind every subdomain of the client's domain with the first https answer, and browsers keep it.
   - A fixed page CSP, `Content-Security-Policy-Report-Only` until payments' wizard e2e has passed with it, then enforced. Inline scripts need `'unsafe-inline'`, because nonces would make every Next page dynamic; a nonce or hash policy comes after launch.
   - The API sends `Cache-Control: no-store` on every answer unless a route sets its own, so neither a browser nor a Cloudflare "cache everything" rule can store one student's answer for the next.
7. **Logs** (lead, 2026-10-31):
   - One explicit access-log format: the path is cut at the first `?` and the Referer is dropped. A browser sends the full page URL as the Referer, so an admin's `/admin/users?q=<name or phone>` would otherwise reach the log through the next request.
   - The format adds the Cloudflare edge address, the request and upstream times, the upstream status and the request id. `/healthz` is not logged.
   - Error logs: nginx appends the whole request line and the referrer to every error line written for a request, at any level (an upstream failure is error, a full temp disk crit, running out of connections alert). So request-level errors log only at `emerg` (inside `http`), and the main error log keeps `crit` for process-level problems such as a worker that died. Lost: the request-level crit and alert diagnostics. The access log (status, upstream status, times) and the host monitor (disk, connections) cover them.
   - `infra/nginx/test/check-sites.sh` (in CI) and the CI smoke test assert that random `?q=` values in the URL and in the Referer appear in no log: for a 200, for an upstream-down 502 (error level), and for a full temp disk, a 500 at crit level (a 64 KB tmpfs). Mutation checks: the `combined` format, the default error level, or no `emerg` inside `http` fails them.
8. **`APP_URL` must be https in production,** except for localhost, 127.0.0.1 and [::1]. The local stack runs in production mode on http://localhost:8080.
9. **CSP in the browser tests:** the CDP driver (`scripts/lib/cdp.mjs`) records every `securitypolicyviolation` through a binding added before any page script. `e2e.mjs` and `e2e-exam.mjs` pass the CSP step (`cspReport`) only if every document carried nginx's page policy, at least one did, and no violation was seen. A run against a bare Next therefore fails instead of passing without testing anything. Payments' wizard e2e will use the same check (LAUNCH-PLAN §13).
10. **Not used:** a per-IP `limit_conn` (it would refuse a school behind one address; `limit_req` already covers RULEBOOK §11) and Cloudflare Turnstile.

## 2026-11-01 — Announcements and the student home on the API (core C4; plan `docs/plans/CORE-PLAN.md` section 5, D5, D6)

1. **Announcements are data, not a message system** (D5):
   - **Text:** plain, with its line breaks kept; never HTML, and links are not made clickable.
   - **Audience and time:** everyone (`category` null) or one category, published now or at a chosen time (at most 1 minute in the past).
   - **Never deleted:** an announcement is archived and can be restored.
   - **No email to students** (SES quota).
   - **Schema:** one migration pair, `*_core_announcements` (generated: `category`, `archived_at`) and `*_core_announcements_checks` (length CHECKs, `archived_at >= created_at`, a partial index for the students' list).
   - **Module:** `AnnouncementsModule` adds one line to `app.module.ts` (lead's OK).
2. **Writes:**
   - **Locking:** every admin write re-reads the admin, locks the row and compares `expectedUpdatedAt` (409 `stale`), so two admins never overwrite each other.
   - **Audit:** the row is written in the same transaction (title and changed field names).
   - **Refusals:** an archived announcement is not edited (`archived`); restoring a live one is refused (`not_archived`); a PATCH that changes nothing is `nothing_to_update`.
3. **Students' reads are cached** per category and page for 60 s in the cache Redis. Every admin write bumps a generation number in the key after its commit, so a change shows at once.
   - **Schedules:** a scheduled announcement appears within 60 s of its time.
   - **Redis trouble:** the list falls back to Postgres; if the bump fails, a change waits for the TTL.
4. **The student home** (D6, and A2's L1 needs it before launch) is composed on the web server from existing endpoints, so no team's module changes:
   - **The calls:** `/users/me`, `/exams`, `/exams/:id` (only for the next exam's grace), `/announcements` (3) and payments' `/registrations/me`.
   - **The next exam:** one in progress, else one open, else the earliest upcoming (`pickNextExam`, tested).
   - **Rounds:** `currentRound` stays null until core C6.
   - **The registration card** (lead's option (a); payments builds none): status, invoice, fee and date, picked field by field.
     - A registration exists only for a paid payment (trigger) and there are no refunds, so the card never offers a payment action.
     - Without a registration, it links to payments' `/register`.
     - It shows payments' own wording, so it matches their result page: `REGISTRATION_STATE_LABELS.completed` for a paid registration, the common payment-status text otherwise. It renders payments' `MyRegistration` (`registration.ts`), and core's first copy of that type was dropped in the merge.
5. **Web:**
   - `data/http/announcements.ts` and `data/http/home.ts` read with shape checks and explicit picks. `DataSource.admin.listAnnouncements` now returns `AdminAnnouncement` with a status filter.
   - The admin page has status tabs, "New announcement", and edit and archive/restore per row, all writing through `lib/api.ts`.
   - `TextAreaField` joins `packages/ui`.
6. **Tests:**
   - `announcements.int-spec.ts` (11): visibility by time, archive and category; paging; the cache showing a write at once; roles and a blocked or demoted user; create with its audit row; refused input and back-dating; stale, nothing-to-update, archive and restore; the status filter; the database CHECKs and the index.
   - web: `http/home.test.ts` (composition, next exam, picks, a refused part), `announcement-problem.test.ts`.
   - **Mutation checks:** without the category filter, without the generation bump, without the stale check, and without the registration pick, each makes a test fail.

## 2026-11-01 — Encrypted off-server backups (L6; exam session, A2's plan and handover)

1. **Configuration only in `/etc/sirat/backup.env`** (root, 0600; `backup.sh` refuses anything else), never the app's `.env`, which reaches every API replica: the put-only upload key and the heartbeat URL stay with root. The file is read as `KEY=VALUE` lines, never run as shell. Every compose call passes `-p` from `BACKUP_PROJECT`.
2. **Counts from the dump itself:** the manifest's row counts and migration list come from reading the whole archive back (`pg_restore --data-only`), so they describe the same snapshot as the dump. A second query would not, because writes happen in between. That read also refuses a truncated dump, which `--list` alone would pass.
3. **Encryption:** `age` to public keys in `infra/backup/recipients.txt`; the private keys stay offline with the key holders (Q1). The manifest's `sha256` is of the encrypted file, so anyone can check a copy without decrypting it. The local copies are encrypted too. A completed run, failed or not, leaves no plain dump. A run killed mid-dump leaves its partial plain dump in an owner-only `.work.*` directory under the 0700 backup directory, until the next run removes it.
4. **Upload:** with a put-only key, `rclone` cannot list, read back or delete. It uploads the dump first and the manifest last, so a manifest always names a complete file. Locally the newest 3 are kept.
   - **Tier prefixes (lead's review):** a lifecycle on one prefix can only expire by age, so it cannot keep hourly, daily and weekly copies. Every run goes to `hourly/`; the first run of the Asia/Dhaka day at or after 03:00 also goes to `daily/` (the same file, a second put); that run on a Sunday also goes to `weekly/`.
   - Three bucket lifecycle rules (2, 8 and 35 days; RUNBOOK §5) then keep 7 daily and 4 weekly copies (RULEBOOK §6) and work with the hourly timer and the later 03:30 daily drop-in.
   - "At or after 03:00, once a day", rather than "in the 03:00 hour": a failed 03:00 run is made up by the next one. `.last-daily` in the backup directory remembers the day.
   - Dhaka time is computed as UTC+6 (no daylight saving since 2009), so no time zone database is needed.
5. **Refusals:** a run whose dump is under half the last one's size fails (`BACKUP_MIN_SIZE_PERCENT`, default 50), because a sudden drop means lost data more often than cleanup.
   - **The way out (lead's review):** after a deliberate big delete, `backup.sh --accept-smaller` once, by hand. It is logged; the timer never passes it.
   - **A failure** pings `/fail` with the step's name only and exits non-zero, so `deploy.sh` stops before migrate. Before the store step it leaves no new copy; a failed upload keeps the local encrypted copy, stored first.
6. **`BACKUP_REMOTE=none`** is an explicit local-only mode, until the bucket exists: it warns and pings nothing. An empty value is refused.
7. **The verify timer** (A2 named one; the plan does not describe it): daily at 07:30 Asia/Dhaka, `backup.sh --verify` checks the newest local copy against its manifest, that it is an age file, that its `created_at` has the `YYYY-MM-DDTHH:MM:SSZ` shape (an empty one would read as today's midnight), and that it is under 26 h old; it pings `/fail` if not. The upload itself cannot be read back with a put-only key; the drill (L7) reads the bucket with a read-only key.
8. **Schedule:** the timer is hourly while registration is open; afterwards a drop-in makes it daily (RUNBOOK §5). The units expect the clone at `/srv/sirat` (L12 can change the path).
9. **Tests:** `scripts/test/backup.test.sh` (24 cases, on a fixed clock given by `SIRAT_BACKUP_NOW`, which only tests set) runs in a throwaway Alpine container with the tools (age, rclone, Docker CLI) against its own compose project `sirat-backup-test`: a Postgres with no port and no bind mount, a throwaway key, an rclone `local` remote, and fake `curl` and `docker` shims. The same runner runs in CI's docker job, whose image scan now also refuses `*.age`.

## 2026-11-01 — Registration and payment pages, admin payments and settings (Claude; payments PR 4, plan 6.7, lead's rules)

1. **The wizard** (`/register`): three steps on one form, then PayStation.
   - Nothing is stored in the browser. The form goes once to `POST /registrations/start`; the API keeps it server-side.
   - The form posts (never GET) and its button waits for hydration (A2's rule).
   - The browser checks the DTO's rules first, so a mistake shows on its own step. The owner's duplicate texts (`REGISTRATION_MESSAGES`) appear next to the email or the phone.
2. **One `startRequestId` per submit.** It is kept after a network error (the outcome is unknown, so a repeat replays) and renewed after a definite refusal or a changed field. After "the payment could not start" the attempt exists (the API set `sirat_reg`), so the button retries it (`current/retry`, a new invoice) instead of starting another; a repeated start of that attempt answers `NOTHING_TO_RESUME` and switches to the same retry.
3. **This browser's earlier attempt** is read once on load (`GET /registrations/current`; the cookie's path means only the browser has it, never the Next server). It offers to continue a checkout in progress, to try again or start over after a failure, or to see the status.
4. **The result page** (`/register/result`; the API's callback 303s here with nothing in the URL):
   - it never reads a result from the address;
   - it polls `current` every 2 s, then 5 s, then 10 s, stops after 2 minutes, and then offers "Check my payment status" (`current/recheck`), which starts the schedule again.
5. **The checkout URL is followed only when it is https** (or http outside production, for the fake), so an unexpected scheme can never run in the page.
6. **`GET /registrations/info` is read by the page's server** with no cookie and no client header, cached 30 s (the API caches 30 s too): the same for every visitor, so traffic never multiplies the calls.
7. **The dashboard card is core's** (C4, lead 2026-11-01): core composes it from `GET /registrations/me`. Its short bn/en state labels are `REGISTRATION_STATE_LABELS` in `@sirat/shared`, and the API shapes (`MyRegistration`, `CurrentRegistration`, …) are there too.
8. **Admin payments and settings are admin only** (page roles as the API). The data layer picks fields one by one: an event's stored gateway answer and the admin's id never reach the page (only "by an admin").
   - Filters reach the API only when well formed: a typo is ignored, not a 400 error page.
   - The manual reconcile is offered only for a success without a trx_id, in a pending, failed or expired payment; the API checks the rule again.
9. **The fee is typed in whole taka** (Bangla digits and thousands commas accepted) and sent in paisa with `expected` and a reason. The dialog shows ৳old → ৳new and says that started payments keep their amount. A 409 asks the admin to reload.
10. **The dev `/api` rewrite follows `API_INTERNAL_URL`** (default `localhost:4000`), so a session running its own API port can run its own dev web.
11. **`e2e:register`** drives the whole flow in a browser against the fake PayStation (RUNBOOK §0): a payment to "Registration complete" and the first login, then a failed checkout and "Try again". Once A2's L3 driver records CSP violations, it fails on any (`browser.cspViolations()`, used when present).

## 2026-11-01 — Student profile and the admin's grade correction (core C3; plan `docs/plans/CORE-PLAN.md` section 4, Q1 default)

1. **What a student may change (Q1 default, until the owner answers):** name, phone, district, institution, education type. Not email (a verified change with A2's tokens, later), not the grade (it sets the category and so the exam), not role, category, promo code or payment fields.
   - The limits are the registration form's (`PROFILE_LIMITS`, the 64 districts, the 5 education types). A unit test feeds payments' `StartRegistrationDto` and `UpdateProfileDto` the same samples and expects the same verdict and the same normalised value.
   - **Every field is optional, but none can be cleared:** a sent field is validated with `@ValidateIf(v !== undefined)`, not `@IsOptional()`, because `@IsOptional()` also skips `null`. A `{ "phone": null }` reached the phone checks and found a staff account with no phone (409). The test caught it.
2. **The owner's phone rule** (one number, one student), in one transaction:
   - another account has the number → 409;
   - an `open` registration attempt holds it (payments' table, read only) → 409;
   - the UNIQUE index decides when two claims meet; the loser gets the same 409.
   All three answer `PHONE_REGISTERED` with the owner's text (`REGISTRATION_MESSAGES`), never a 500. The race is tested deterministically: another transaction takes the number and holds its commit for a second, so the PATCH passes its check, waits on the index and gets the violation. That test failed with the mapping removed; the earlier two-PATCH race did not.
3. **Audit:** `user.profile_updated` with the changed field names only, never the values (core plan D8). Sending the same values changes nothing and writes no row.
4. **Grade correction** (`POST /admin/users/:id/grade-level`, admin only, reason 3–200):
   - **One transaction:** re-read the admin, lock the student's row, refuse staff (`not_a_student`) and a student with any exam attempt (`has_attempt`; exam's table, read only), set the grade and the category from `grade_levels`, and write `user.grade_corrected` (both labels, the category, the reason).
   - **Residual race:** an exam started between the check and the commit would keep the old category. The student's row lock does not block exam's start (it does not lock users), so this is a window of milliseconds, noted and not closed.
5. **Web:**
   - **The save** goes from the browser through `lib/api.ts` (DECISIONS "Web data layer over HTTP" rule 5). The Server Action `profile/edit/actions.ts` and `DataSource.updateProfile` are gone.
   - **The form** keeps `method="post"` and its submit disabled until hydrated (web session #10), so an early submit never puts the fields in a URL.
   - **The fields:** the grade is shown read only with the reason; the district is a list.
   - **The admin side:** the detail dialog gets "Correct grade level". `GET /content/profile-options` admits admins for its grade table (no personal data); managers and jury stay out.
   - **Client props are picked, never whole objects:** the props of a client component are serialized into the page. CI's `check:leak` found the canaries on `/dashboard/profile/edit` because the whole option-list object reached `ProfileForm`. `toProfileFormProps()` (`data/profile.ts`) now picks every field, and a unit test with canary-filled inputs fails if it spreads instead. The admin grade dialog gets `{ id, label }` only. The whole "Dashboard pages" job then ran clean on this worktree's own services: a throwaway Postgres with the test marker, the API on 4300, `next dev` on 3300 and `next start` on 3301.
6. **Tests:**
   - `users-me.int-spec.ts` (12): own profile, options, roles, blocked, allowed fields and the audit, the phone in all forms, the three phone conflicts, refused fields, the grade correction and its refusals.
   - `profile.dto.spec.ts` (the same rules as registration); web: `profile.test.ts`, `http/profile.test.ts`, `save-problem.test.ts`, `grade-problem.test.ts`.
   - **Mutation checks:** without the open-attempt check, without the unique-violation mapping, and without the attempt check, each makes a test fail.

## 2026-11-01 — Results on the web (E5a; exam session, lead's rules)

1. **E5 is two pull requests (lead):** E5a results on the web (review, leaderboards, results panel, attempts); E5b admin authoring (create, edit, versions, publish dialogs).
2. **Leaderboards per exam:** the web's round-based leaderboard types (`LeaderboardView`, `LeaderboardRound`, `AdminLeaderboardView`, `AdminLeaderboardQuery`) are gone; the pages use E3's `ExamLeaderboard` and `AdminExamLeaderboard` with `?exam=`.
   - **Student tabs** are the student's own exams with published results, from `GET /exams` (`resultsPublished` now passes the pick), newest window first. With none, the page asks the API for nothing.
   - **No category select** (the plan had one, the lead agreed to drop it): each category has its own exam, and a student lists only their own.
   - **Admin tabs:** the 8 most recent non-draft exams plus the one shown (older ones open from their exam page). The category tabs are gone; the status card now says whether this exam's results are published.
   - The mock ranks each exam's participants on their own (1, 2, 2, 4), as the real snapshot does.
3. **Review:** `StudentExamDetail.attempt` gains `attemptId`, the student's own attempt only; the review route checks ownership. The page calls `GET /attempts/:id/review` only when the results are published and an attempt exists; 404 and 403 both mean "no review". The exam list shows "Results", and the receipt links to the review once results are out.
4. **Admin reads over HTTP** live in `data/http/admin-exams.ts`, a second file in the exam area so `exams.ts` stays readable. `admin.getExam` returns the API's `AdminExamView`, whose `updatedAt` is the write token. `admin.listExams` is connected too: the admin leaderboard tabs need it.
5. **Results actions** are browser writes through `lib/api.ts`. Publish and unpublish send `expectedUpdatedAt`. Refusals are shown in words by code: `window_open`, `attempts_unfinished`, `no_snapshot`, `results_published`, `stale`. The buttons only follow `canBuild` and `canPublish`.
6. **Attempts (owner Q4):** filters "ended by violations" and "3 or more violations" (half way to the 6th), search by name or email, paging, and a URL dialog (`?attempt=`) with the events and their times; violations are marked.
7. **Proof:**
   - `check:leak` OK on 10 pages, `check:prod` on 27 (8 still show the polite error state: not connected yet), `check:api-down` on 3, all on the exam session's own services.
   - Extra page checks for the attempt dialog, both filters, both leaderboards, the review, the list link and the receipt link.

## 2026-11-01 — Payments queue name per test run (Claude; A2's finding, lead's order)

**What:** `PAYMENTS_QUEUE_NAME` (optional, validated `^[A-Za-z0-9_-]{1,64}$`; blank means `payments`) names the BullMQ queue that both `PaymentQueue` (API) and `PaymentsWorker` read from one provider, so the two can never disagree. Production leaves it blank. The payments test harness gives each run its own name (`payments-test-<random>`).

**Why:** A2 found that with the test queue on Redis DB 0, the shared dev stack's worker (now running the payments code) took the tests' `payments` jobs, and payments-settle and payments-hooks failed.

**Also:** the verification-email test now catches the email at `EmailQueue.enqueue` (a spy) instead of reading the shared `email` queue back, for the same reason.

## 2026-10-31 — Settle, callback, IPN, reconciliation and admin payments (Claude; payments PR 3, plan 6.2–6.7; reconcile rule: lead)

1. **Only the worker asks PayStation.** One BullMQ queue `payments` on the queue Redis:
   - job id `verify.<paymentId>`, so one check per payment at a time (a callback and an IPN together make one status call);
   - priority 1 for callback, IPN and rechecks, 10 for reconciliation; 4 at a time per worker;
   - a job that throws (the database) is tried 3 times from 5 s and then removed at once: a kept failed job would hold its id and swallow every later hint. An unreachable PayStation is a recorded outcome, not a throw.
2. **The settlement** (`verify/payment-settlement.ts`) is the only code that marks a payment paid or failed: the verify job and the admin reconcile both go through it.
   - One transaction: `FOR UPDATE` on the payment, then on the attempt. `decide()` runs again on the locked row (not on the row read before the PayStation call).
   - Paid consumes an open attempt: the account (role always `student`, category from the class), the registration, the payment's user, `registration.completed` in the audit log and the payment event, all in that transaction. The stored form, password hash included, is cleared. The verification email (A2's) is queued after the commit.
   - **Money taken always wins**, set aside with a review reason and a critical alert (`security.payments.needs_review`):
     - `email_taken` / `phone_taken`: an account got that email or phone meanwhile. The payment is paid with no account; the attempt becomes `conflict`; the result page says `needs_help`.
     - `duplicate_payment`: the attempt was already completed by another payment. The payment gets the same user; no second registration.
     - `abandoned_attempt_paid`: a late success on an attempt the student gave up. No account is made from it, since the student may already have started again.
     - `attempt_invalid`: the stored form is unusable.
   - **A trx_id another payment holds is never paid here** (`trx_id_reused`, critical; the UNIQUE index refuses it anyway).
   - **Warnings** (`late_success`, 2001 or an unknown status at expiry, `account_mismatch`) go to the audit log (`payments.warning`) and the log, without an email, so the alert-email budget stays for the critical ones.
3. **Callback:** `GET /payments/paystation/callback/:invoice` (the client already appends our invoice to the callback URL).
   - It records the query (at most 10 keys, 200 characters each) and asks for a check only while the payment is watched (active, or failed/expired with a checkout until 48 h after expiry).
   - It always answers 303 to `APP_URL` + `/register/result` and never reads a result from the query.
   - An unknown invoice is recorded; a malformed one is only redirected.
4. **IPN:** `POST /payments/paystation/ipn`, the only CSRF-exempt route.
   - At most 16 KB (413). A database failure answers 503, so PayStation retries.
   - Unknown invoice: 200, and only the documented fields are kept.
   - Paid with the same `trx_id`: 200 `duplicate`, no check.
   - Anything else for our invoice asks for a check, even outside the late watch (an IPN means money).
5. **Windows on outside signals** (cache Redis; fail open like the other limiters): the callback and the IPN share one 30 s window per payment; a student's recheck and an admin's recheck have 10 s each. With the job id, unsigned IPN spam cannot become a flood of status calls.
6. **Reconciliation:**
   - every 2 minutes (one job scheduler, so one run at a time); at most 100 payments a run, of the current PayStation account only;
   - which payments: active ones older than 2 minutes, and failed/expired ones that reached a checkout, until 48 h after their expiry;
   - back-off by `check_count`: 2, 2, 5, 10, then 30 minutes;
   - the claim (`last_checked_at`) is a short transaction with `SKIP LOCKED`.
   These timings are constants in `verify/payment-timing.ts`, not env: tests pass their own clock.
7. **A payment started on another PayStation account** (`gateway_account` differs from `PAYSTATION_ACCOUNT_LABEL`) is not asked about: the new account would answer 2001 and could expire a real payment. It is recorded (`account_mismatch`) for an admin.
8. **Manual reconcile** (lead, 23:32; a technical safety valve, not a money-policy change: it only confirms what PayStation already reported). `POST /admin/payments/:id/reconcile { trxId, reason }`, admin only.
   - Allowed only when, under the row lock:
     - the payment is pending, failed or expired, and the automatic rule stopped on `success_without_trx_id`;
     - its latest `status_v1` answer shows a success with our invoice, our reference (when echoed) and exactly our amount, but no trx_id.
   - The admin types the trx_id from PayStation's panel (UNIQUE applies: 409 `TRX_ID_IN_USE`) and a reason (10–200 characters).
   - Then the settlement runs exactly as the automatic path. Audit `payments.reconciled`, plus an `admin` payment event.
   - A payment already paid answers its current state (`applied: false`), never a second settle.
   - trx_id reuse, amount or invoice mismatches and refunds stay on the manual path (RUNBOOK §11).
9. **Admin settings** (`GET /admin/settings`, `PUT /admin/settings/:key { value, expected, reason }`, admin only):
   - allow-listed keys only, each with its own rule. The fee: 10–10,000 BDT in whole taka, with a reason. Registration must open before it closes.
   - The row is locked, and `expected` must still be the current value (409 `SETTING_CHANGED`).
   - The audit row `settings.changed` (old, new, reason) is written in the same transaction; the registration info cache is cleared after it.
   - Payments already started keep their fee snapshot.
10. **Admin only, not manager,** for payments (payers' contact data) and settings; admin writes 20/min per IP, besides the per-user limit.
11. **Not in this PR:** an alert for 2001 repeating across payments, and queue depth (LAUNCH-PLAN monitoring); abandoning stale open attempts and clearing their stored form (the cleanup job, plan 4.3).

## 2026-10-31 — Admin students list and CSV export (core C1; plan `docs/plans/CORE-PLAN.md` section 2)

1. **Read only, admins only,** and the acting admin is re-read on every call, reads included: a demoted or blocked admin stops at once, not after the token's 15 minutes, because these pages show minors' data. Lives in `UsersModule`, so `admin.module.ts` (payments' admin routes) and `app.module.ts` do not change.
2. **Search:** name or email contains the term (case-insensitive), plus the phone exactly when the term reads as a Bangladeshi mobile in any form, plus the registration's invoice exactly when the term has the invoice shape with a digit (a long name never counts as an invoice). `q` is 1–100 characters, as the web's search box sends it. **Measured** (`EXPLAIN ANALYZE`, 35,157 users in `sirat_core_test`, 25,000 of them generated): a term that matches nothing 40 ms (sequential scan, the worst case), its count 35 ms, a term matching 5,000 rows 6 ms for page 1, page 1,250 without a filter 18 ms, not-registered 5 ms, one export batch of 1,000 rows 5 ms. All under the 50 ms target, so no `pg_trgm` index.
3. **Phone masked in the list** (`phoneLast3`), full in the detail and in the CSV (core plan D2).
4. **Export is a POST** with a reason (3–200 characters), so neither the reason nor the search reaches a URL (nginx logs query strings) and the CSRF header applies.
   - **Audit before the first byte:** `users.exported` with the admin, IP, filters (the search term only as its kind), row count and reason. If it cannot be written, 503 and no file.
   - **Only students and ambassadors** are exported; at most 50,000 rows (400 `too_many_rows`); 5 per admin per hour. The throttler runs before validation, so refused requests count too.
   - **Rows in keyset batches of 1,000** (`created_at`, `id`): a fixed number of queries per batch, far below the 10 s statement timeout. The id breaks ties, so equal timestamps neither repeat nor drop a row (tested with 2,500 rows of one timestamp).
   - **Nest's `StreamableFile` logger is replaced,** not its handler. Nest still cuts a download short when a batch fails after the headers went out, but its default logger printed the error's message, and a Prisma message quotes query values (A2.0 gate 1).
   - **CSV rules** (`common/csv.ts`, for every export): UTF-8 BOM, CRLF rows, quotes for commas/quotes/line breaks, a `'` before a cell starting with `=`, `+`, `-`, `@`, tab or CR. Times in Asia/Dhaka.
5. **Web:**
   - **The page:** `data/http/users.ts` reads the list and the detail with a shape check and an explicit pick. A detail id that is not a UUID is "not found" without a call.
   - **Filters:** a GET form (works without JavaScript). Booleans travel as `true`/`false` in the URL, because `hrefWith` drops a plain `false`.
   - **The export:** it goes from the browser through `lib/api.ts`, which gains `as: 'blob'` (DECISIONS "Web data layer over HTTP" rule 5). `Blob.text()` drops the BOM while the bytes keep it, so the test compares bytes.
6. **Tests:**
   - unit: `csv.spec.ts`; `admin-users.service.spec.ts` (search kinds, filters, the row limit before any write, no file without the audit row and no error message in the log, only the term's kind audited);
   - web: `users.test.ts`, `export-problem.test.ts`, the blob case in `api.test.ts`;
   - integration: `admin-users.int-spec.ts` (roles, a blocked or demoted admin, every search kind and filter, paging bounds, masked phone, detail, CSV content and escaping, audit row, batches, the hourly limit).
   - **Mutation checks:** without the explicit pick, a hash canary reaches the page; without the formula prefix, the CSV test fails.

## 2026-10-31 — Exam player in the browser (E4; exam session, lead's rules)

1. **Logic without React:** `components/exam/exam-controller.ts` (state, local copy, checkpoints, the one submit), `violations.ts` (leave and return, DevTools keys), `exam-storage.ts`, `exam-api.ts` (browser calls), `exam-logout.ts`. The plan named state/storage/sync/time modules; one controller with an injected clock, timers and API keeps every rule in one place, and `node --test` drives it with a fake clock.
2. **Reads and writes (lead):** the waiting room is a server read (`data/http/exams.ts` `getExam`: shape check, explicit pick, null for 404 and for a malformed id, which sends no request). Start, resume, checkpoint and submit go from the browser through `lib/api.ts` ("Web data layer over HTTP" 5). Checkpoint and submit use `onExpired: 'throw'`: an ended session keeps the answers and the pending submit on the device, and the page asks for a login.
   - **Client props are picked by name:** the page hands `ExamRoom` only `toRoomExam(exam)`, because everything given to a client component is serialized into the page. CI's `?mock=leak` page check found the whole object there; a unit test now fails without the pick.
3. **Local and server copies:** the newer answers win by `seq`; the violation count is the higher of both; a pending submit is sent again after a reload with its request id. Time-up locks the answers and submits them after a 0–20 s spread. The countdown is display only and re-syncs when the server's remaining seconds differ by more than 1.5 s.
4. **The violation rule as built (owner Q4):** a leave counts once until the page has focus again; a warning on screen does not pause counting; reloading or closing the page (`beforeunload`, `pagehide`) and network changes do not count. The DevTools keys are F12, Ctrl+Shift+I/J/C and Cmd+Opt+I/J/C. Opening the tools from the browser menu cannot be seen, and the rules text claims nothing about it.
5. **Logout on shared devices (lead):** before the logout request, an unsent final submit gets one try of at most 3 s; after a logout that worked, every `sirat.exam.v1.*` key is removed and no other key (A2's `LogoutButton.tsx`, lead's approval).
6. **Start waits for hydration**, like the auth forms: a click before React ran did nothing (found by the e2e).
7. **Proof:** `scripts/e2e-exam.mjs`. An admin publishes a 15-minute exam; a fixture student takes it up to the 6th violation, with a reload in between; every response, the HTML and localStorage are searched for explanations, correct keys, scores and question or lineage ids. On a throwaway Postgres with the exam session's own API: 6/6. With the API changed to add `correctKey` and the question id to the start answer, the leak step fails.
8. `Countdown` shows h:mm:ss from one hour on (`formatCountdown`, unit-tested); `@sirat/ui` gets a `test` script (lead's approval).

## 2026-10-31 — Public entry page and legal pages (core C2; plan `docs/plans/CORE-PLAN.md` section 3)

1. **Why now, before Phase D:** PayStation's merchant review asks for a live site with an about page, terms, a privacy policy, contact details (one email and at least one phone number) and the registered business name; a refund policy depends on the business. So only these five pages are built (entry, about, privacy, terms, refund policy): no design work, no other marketing sections.
2. **One source each:**
   - **The facts:** `content/site.ts` holds the registered name, address, email, phone, effective date and a `placeholder` flag. The client sends the values; until then they are null and the footer says the details follow.
   - **The texts:** `i18n/messages/legal.ts` (bn mirrors en at compile time, sentence for sentence).
   - **Placeholder texts claim only what the system does:** the data collected, PayStation for payments, the cookies, the exam rules. The refund page states the owner's rule: "The registration fee is non-refundable." / "রেজিস্ট্রেশন ফি ফেরতযোগ্য নয়।"
3. **While `placeholder` is true,** every public page carries `noindex` and a visible draft note. Turning it off is part of putting the client's texts in.
4. **Routes:** English at `/`, `/about`, `/privacy`, `/terms`, `/refund-policy`; Bangla at the same paths under `/bn`, with `hreflang` alternates and a language link on each page.
   - **Static:** each route file only picks its page and locale, and no cookie or header is read (tested).
   - **The fee and the open state** on the entry page come from payments' `GET /registrations/info`, fetched server-side without any cookie and revalidated at most every 60 s (ISR). On any failure, including a build with no API, the page shows no fee and keeps its buttons.
   - **`<html lang>`** stays "en" in the shared root layout (UI port #16); Bangla pages set `lang` on their wrapper.
5. **No HTML strings:** legal texts are structured data rendered by `Prose` (`packages/ui`). A unit test fails on any `dangerouslySetInnerHTML` in `apps/web/src`.
6. **Checks:** `check-pages.mjs prod` also opens the ten public routes without a cookie (200, the brand, a heading, no error state, no raw error) (lead's OK). `public.test.ts` covers the routes, the refund sentence in both languages, the HTML scan and the info parser.

## 2026-10-31 — Web data layer over HTTP (Lead's order; core session implementation)

1. **Production reads the API:** `getData()` returns the HTTP source (`apps/web/src/data/http/`). Development keeps the mock unless `DATA_SOURCE=http` (a local web against a local API). The literal `NODE_ENV` check still drops the mock from production builds (`assert-no-mock.mjs`).
2. **One file per area, one owner each:** `http/exams.ts` (exam session; the example, `student.listExams` → `GET /exams`), and later core's `users.ts`, `announcements.ts`, `ambassador.ts`, payments' own file. `http/index.ts` spreads each area into its group of `DataSource`. A method no area implements stays `unavailable`, so its page keeps the polite error state; the test checks that every method exists.
3. **Area file pattern:**
   - `getJson` / `getJsonOrNull` (`http/request.ts`) take the path and a shape check. 404 is null only where the page shows not found. Every other status, or a shape that fails the check, throws `DataRequestError`, so the page shows its error state. The error names a class and a status, never the path, a query value or a body (logs).
   - The area then picks the fields of the shared type explicitly, so a field the API adds later never reaches a page.
   - Query strings go through `withQuery`.
4. **Binding** (`http/server.ts`): only the access cookie, the student's IP and nginx's request id go along (`serverGet`, `lib/server-api.ts`). No cookie or a 401 goes to `/refresh`, as the session lookup does. The access token can expire after the 30 s `/auth/me` cache answered, so a read can see 401. `refreshUrl` is now exported from `lib/session.ts` for this.
5. **Reads only (Lead):** `data/http` is for server-side reads in Server Components.
   - **Writes from the browser:** browser-initiated writes, and anything that sets or needs cookies on the student's side (exam start/checkpoint/submit, registration start/retry/cancel, profile save, announcement forms), go through `lib/api.ts`. Same origin, the cookies, and #12's 401 → refresh retry.
   - **One small file per feature,** such as `components/exam/exam-api.ts`.
   - **Never proxied through the Next server.**
   - **The profile edit:** its Server Action (mock only today) moves to this pattern with its API (core plan C3), and `updateProfile` then leaves `DataSource`.
6. **Tests** (`http/http.test.ts`): query encoding; status and shape refusals; 404 → null; the error text carries no path or value; every `DataSource` method present; `listExams` passes on only the card fields (a canary `score` is dropped); an unknown state, category or type is refused. **Mutation checks:** without the explicit pick, the canary reaches the card; without the status check, a refusal passes as data.

## 2026-10-31 — Registration start and status (Claude; payments PR 2, plan 6.1 and 6.7)

1. **Application error codes:** the global error filter passes on a machine code that a service sets on purpose (`{ code, message }`, `^[A-Z][A-Z0-9_]{2,40}$`, e.g. `EMAIL_REGISTERED`). Every other error keeps its status name. The codes and the owner's bn/en texts live in `@sirat/shared` (`RegistrationErrorCode`, `REGISTRATION_MESSAGES`), so the web maps codes and never raw text.
2. **District is one of the 64**, in the current official English spelling (`BD_DISTRICTS`). Education type is one of the old wizard's 5. The class comes from `grade_levels`. Free text would break the book's courier list (plan 16) and any later district statistics.
3. **No route before an account takes an id.** The `sirat_reg` cookie (only its SHA-256 is stored) is the proof of "my attempt"; `current` returns no personal data.
   - A repeated `startRequestId` hands that browser a fresh cookie token and the same payment: only the browser that sent the form knows the id.
   - The same browser with a payment in progress for the same email gets its checkout back.
   - Another browser gets 409. Any phone conflict gets the owner's one phone text.
4. **Concurrency:**
   - one start locks the open attempts of the email or phone (`FOR UPDATE`);
   - an attempt with an active payment means 409; an idle one is abandoned;
   - two starts at the same moment fall to the partial unique indexes, which become the same 409s;
   - an invoice collision draws a new number (at most 3 times).
5. **PayStation is called outside every transaction.** The payment row (with the fee snapshot) exists before the call. The answer is recorded in `payment_events`.
   - created: `pending` with the URL;
   - refused or timed out: `failed` (502), and retry works;
   - `"1001"`: `failed`, a 10-minute pause in the cache Redis with a critical alert, and 503 `PAYMENTS_PAUSED` for every start or retry during the pause.
6. **Limits:** 300 starts or retries per minute per IP (route tier, sized for shared IPs: a school lab or a mobile operator CGNAT on opening day; lead review), 3,000 per minute for info/current/resume/cancel (the result page polls) and 10 an hour per email and per phone (Redis, failing open like the login limiter). New alert kinds: `payments.fee_invalid`, `payments.credentials_rejected`.
7. **Recheck moves to PR 3:** `POST /registrations/current/recheck` and `POST /payments/:id/recheck` need the verify job.
8. **Until reconciliation exists (PR 3)**, a payment past its expiry still counts as in progress for the 409 rule. The reconciliation job then expires it, so no second checkout can start while money may still arrive.

## 2026-10-31 — DECISIONS.md merges as a union (Lead)

1. Every session adds its entries at the top of this file, which conflicted on every merge that day. `.gitattributes` now gives `docs/DECISIONS.md` git's built-in union merge driver: both sides' added lines are kept, and nobody has to resolve the same conflict again. A union can drop the blank line between two new entries; `pnpm format` restores it, and CI's format check catches it. Only this file: in OPEN-QUESTIONS or other tables, a union could duplicate or garble rows.

## 2026-10-31 — Who merges pull requests (owner)

1. **Only the lead session merges,** with the owner's GitHub account: `gh pr merge <n> --merge --match-head-commit <reviewed sha>`, a merge commit (no squash, rebase or admin bypass). No other session ever merges.
2. **Conditions:**
   - CI 4/4 green on the head commit;
   - the lead's own review;
   - the PR description lists every local check and ends with one line `Ready to merge: <sha>`.
   A push after that means a new review.
3. **Never during a live exam window.** The owner is told after each merge.
4. **The owner can hold any PR, or merge one themselves.**

## 2026-10-31 — Per-user API limits (Lead's order; Claude implementation)

1. **Key:** `UserOrIpThrottlerGuard` replaces the global `ThrottlerGuard`.
   - A request whose access cookie **verifies** (signature and expiry, the same check as AuthGuard) counts against its user.
   - Anything else counts against the client IP: no cookie, or a forged, expired or malformed token. The IP is the one nginx recorded, grouped by /64 for IPv6 as the library does. So nobody can spread one IP's requests over invented user keys.
   - It only counts requests: authorization stays with AuthGuard.
   - The Redis storage and the key shape (route, throttler, tracker) are unchanged.
2. **Signed-in users:** 120 requests per minute per route each (`API_LIMIT_PER_USER_PER_MINUTE`), whatever IP they share. That leaves room for:
   - the exam checkpoint (every 60–120 s);
   - a signed-in payment status poll (every 2–10 s);
   - the web's `/auth/me` (cached 30 s).
   A route's own `@Throttle()` tier still wins.
3. **Per client IP, for routes used without a session.** Thousands of students can share one IP: a school, or a Bangladeshi mobile operator's carrier-grade NAT.
   - **login:** no request limit at the API (unchanged). The login limiter counts only failures (10 per account+IP pair, 50 per account per hour, 100 per IP per minute), and nginx's auth zone caps the rate. Tested: 500 different accounts log in from one IP within a minute, none refused.
   - **refresh:** 3,000 per minute, above nginx's api zone (30 r/s), so behind nginx the API never refuses a renewal first. The refresh token is 256-bit, and reuse is detected.
   - **resend-verification, reset-password, verify-email:** 300 per minute each (were 60 and 30). Unverified students may all ask for a new link at once; reset and verify take 256-bit single-use tokens, refused before argon2.
   - **forgot-password:** 120 per minute (was 60). It sends email too, and it needs far less headroom than resend.
   - **Email volume:** the per-address caps (1 a minute, 5 an hour) limit each inbox, not the total, and nginx's auth zone allows about 1,400 a minute per IP. So one IP can trigger at most 420 link emails a minute (forgot 120 + resend 300), up from 120.
   - **Follow-up:** a global cap on link emails sent, set below the SES daily quota and raising an alert when reached. It needs the quota figure from the owner.
   - **every other anonymous route:** 600 per minute (the module default, unchanged).
4. **Registration routes (payments, later)** need their own tiers sized for shared IPs. The public payment status poll `GET /registrations/current` (every 2–10 s for up to 2 min) would share 600 per minute per IP, which is about 20 people paying at once behind one IP.
   - Proposal for the payments PR: an explicit tier keyed on the registration cookie, with a high per-IP cap behind it.
5. **Risks, not changed in this PR:**
   - nginx's per-IP zones under carrier-grade NAT:
     - `auth` (20 r/s, burst 200: login and the email-link routes) refuses an operator IP beyond 200 at once and 20 per second after. Students see "busy" and retry.
     - `api` (30 r/s, burst 60) covers every signed-in browser call, including the coming exam checkpoint and submit, and is shared by every student behind the IP.
     - Proposal: measure in the load test, then raise both per-IP zones (for example api 200 r/s burst 2,000; auth 100 r/s burst 1,000) and leave the precise per-user limits to the API, or give known operator ranges a higher limit through a `geo` map.
   - The login limiter's 100 failures per IP per minute (owner rule) can also refuse a large operator IP for up to a minute if many students mistype at exam start. Changing it is an owner decision.
   - When nginx's per-IP zones are raised, the API's per-IP tiers (600 default, refresh 3,000, email links 300 and 120) must be raised with them, or the API refuses first.
   - A browser call to a protected route without a valid access cookie counts against the IP. While that bucket is full, the call gets 429 instead of 401, and the web renews only on a 401. The exam player should renew before the access token expires.
6. **Tests:**
   - unit: `user-or-ip-throttler.guard.spec.ts`;
   - integration (`api-per-user-limits.int-spec.ts`, each case on its own client IP through X-Forwarded-For):
     - two users behind one IP each get their own budget;
     - 600 anonymous requests then 429, while a session from that IP still passes;
     - 600 forged tokens naming 600 different users, plus an expired real-key token, all share the IP bucket, and the named real user's budget is untouched;
     - 500 logins from one IP within a minute, none counted by the limiter (no `X-RateLimit-Limit` header);
     - every anonymous auth route answers with its own tier in `X-RateLimit-Limit` (refresh 3,000, forgot 120, resend/reset/verify 300, `/auth/me` 600 per IP or the user's own limit).
   - **Mutation checks:** a tracker that decodes instead of verifies lets the forgeries spread (401 instead of 429); the plain ThrottlerGuard shares one budget (200 instead of 429).

## 2026-10-31 — PayStation client, fake server, selfcheck and decision rules (Claude; payments PR 1b)

1. **The client speaks only v1** (initiate, transaction-status by invoice). v2 is not used, because the merchant bears the charge.
   - **Initiate `"1001"` is `credentials_rejected`:** a configuration error, logged as an error. The pause and alert follow in the start flow (plan 6.1).
   - **Transport failures are only "unavailable":** timeouts (read from the signal itself, not the error's name), network errors, HTTP errors and non-JSON answers. They never lead to a decision.
   - **Logs** carry the operation, the failure kind and an HTTP status, never a body, credential or customer field.
   - **Stored answers** (for `payment_events`) drop credential and token fields, mask phones to the last 3 digits and stay within 16 KB.
2. **`decide()` is pure and matrix-tested**, with mutation checks: removing the amount, refund or reused-`trx_id` rule each makes a test fail. The non-obvious choices:
   - expiry applies only when PayStation shows no success: past `expires_at`, `pending` becomes `expired` and `initiated` becomes `failed` (`initiated → expired` is not a transition);
   - an unavailable gateway never expires a payment;
   - a success on an `initiated` payment is `mark_paid`, and the settle step moves it through `pending`;
   - a stale "failed" on a paid payment only warns.
3. **The TS state table and the DB trigger are compared pair by pair** in `payment-state.int-spec.ts`.
4. **The fake PayStation lives in `apps/api/test/fake-paystation/`**, not `tools/`, because `.dockerignore` already keeps that folder out of every image.
   - Its compose service is not added until the web e2e needs it: `infra/docker-compose.dev.yml` is shared.
   - The contract test runs the real adapter against it.
5. **`paystation:selfcheck`** (one line in `apps/api/package.json`): one 10 BDT `X…` initiate, exit codes 0/1/2, never any part of a credential.
   - It reads env without `validateEnv`, because `tsx` emits no decorator metadata.
   - Run against Rasel's sandbox account: created.
6. **S10 is half done:** a 400 BDT `pay_with_charge=0` checkout shows "Pay BDT 400.00". Paying with the test card needs Rasel at a browser; the lead is arranging it.

## 2026-10-31 — E3: scoring, the server-side finalize and results (Claude; plan `docs/plans/EXAM-PLAN.md` 3.9–3.12)

1. **One queue, `exam`, in the worker** (`ExamWorkerModule`, one import line in `worker.ts`): `score-attempt` after each submit (job id `score.<attemptId>`), a sweep every minute (one BullMQ job scheduler, so one sweep per minute across workers) and admin-requested `build-results`. The API only enqueues and never throws for it: a submit succeeds with the queue down.
2. **The sweep does the safety work itself:** it submits attempts still running past `ends_at + grace + 30 s` from the last checkpoint (`server_checkpoint`, with its violation count and events) or with an empty sheet (`server_empty`, owner Q3), scores finalized attempts left unscored for 5 minutes (a lost job), and builds the snapshot of a closed exam once nothing is unfinished. The finalize locks the attempt with `FOR UPDATE SKIP LOCKED` and re-checks status and the existing submission, so two sweeps or a late client submit never make two submissions (mutation-checked). The margins are a provider (tests use 0), not env variables.
3. **Scoring reads correct keys from Postgres**, maps each answer through the attempt's layout and compares it with the version the student saw (one mark each, no negative marking, owner Q1). Idempotent: only `submitted`/`expired` → `scored`.
4. **The snapshot** is one `INSERT … SELECT` with `rank()` over `score DESC, time_taken_seconds ASC` (the DECISIONS leaderboard query form), blocked accounts left out, in one transaction that bumps `results_generation`. A rebuild adds a new generation; readers use the current one.
5. **Publishing is an admin action** with `expectedUpdatedAt`, needs a snapshot and a closed window (the database CHECK refuses an early `results_published_at` too), and is audited; unpublishing hides the board and the reviews again. `settings.leaderboard_public` is not used by the exam board (EXAM-PLAN D7).
6. **Students:** `GET /leaderboard` returns rank, name and institution only (no score, time or email; owner Q5), pages cached in Redis per generation; `GET /attempts/:id/review` returns the own score, rank and the correct options with explanations, only after publishing.
7. **Not built:** the delayed warm-up before a window opens (the publish warms the pool, and a cold pool is loaded once under a lock); answer-key corrections with re-scoring (E7).

## 2026-10-31 — E2: the exam engine for students (Claude; plan `docs/plans/EXAM-PLAN.md` section 3)

1. **Start is one statement on the database's clock:** `INSERT … SELECT … ON CONFLICT (user_id, exam_id) DO NOTHING`, only while the exam is published, the window open and the content version the one the layout was drawn from; `ends_at = LEAST(now() + duration, window_end)`. No lock on the exam row, so a window-open surge never queues on it. A double click or a second tab gets the same attempt.
2. **POST on an existing attempt answers 200 with its view in any phase** (a submitted one: its receipt, no questions). The plan said 409 `already_submitted`; the view is idempotent and tells the client everything it needs.
3. **The client never sees a question id, an option key or a correct key:** questions are texts in the attempt's order, options are texts in their shuffled order (`crypto.randomInt`), answers are positions. A chi-square test over 200 starts checks that the correct option's position is spread evenly.
4. **The exam cache never holds a correct key or an explanation** (only text, options and the keep-order flag), so a cache leak cannot reveal an answer. Pools are keyed by content version, loaded once under a 3 s lock (a cold cache cannot stampede Postgres); Redis trouble falls back to Postgres. A publish warms the pool in the API; the delayed warm-up before the window comes with the worker (E3).
5. **Checkpoints are one Lua step in the cache Redis, with no database read or write** (tested with a query counter on the app's Prisma client). Answers are stored only for a newer `seq` and at most every 20 s (429 `too_soon`); the violation count only rises and is kept even on a 429. The interval is a Nest provider (tests shorten it), not an env variable, so `env.ts` stays untouched.
6. **Submit locks one attempt row,** answers the first receipt to any repeat, refuses a request id another attempt used (409), and stores `end_reason`, the highest violation count (body, events, server) and the events. `violations` needs more than `EXAM_VIOLATION_WARNINGS` (5). `time_taken` is the server's and never passes `ends_at`.
7. **Paid registration** (after payments PR 1a): a start needs the student's registration with its payment `paid` (403 `registration_required`), read only from payments' tables. There are no refunds (owner), so nothing else ends access. **Not yet:** scoring and the server-side finalize (worker, E3).

## 2026-10-31 — Refresh rotation inside a time budget (Lead's order after PR #12; Claude implementation)

1. **The gap:** the API's 25 s request timeout answers 503 but cannot cancel the handler, so a rotation could commit after its answer was gone. The browser kept the retired token, and its next try got 409 (inside the grace) or 401 with the family revoked as reuse. A slow API ended the session.
2. **Rule:**
   - A rotation commits only within `REFRESH_ROTATION_BUDGET_MS` (default 8 s, at most 10 s) of the handler's start, so its answer (the only copy of the new cookies) always goes out.
   - **Margins:** even with Prisma's 5 s margin below, the commit stays far before the 25 s request timeout and nginx's 30 s, and the budget is no longer than the 10 s reuse grace.
   - **Inside the transaction:**
     - before each statement the time left bounds it, a wait for a row lock included (`set_config('statement_timeout', …, true)`, transaction-local and safe behind PgBouncer). It only ever lowers the database's own 10 s;
     - the budget is checked again just before commit;
     - Prisma's transaction timer runs 5 s past the deadline, so it never cuts a commit the check allowed.
   - **Past the budget,** or when the database refuses for a passing reason (its 5 s `lock_timeout`, a statement timeout, a serialization failure, a deadlock: `common/db-errors.ts`), the transaction rolls back and the API answers 503.
     - Nothing changed and the old cookies still work.
     - The answer has no `Retry-After`, so `/refresh` treats it as "unavailable" and retries with its own growing, jittered pause, which spreads the retries while the database is slow.
   - **A COMMIT that fails may still have committed.** The successor's row is then looked up: if it exists, the cookies go out (204); if not, 503.
3. **Reuse detection is unchanged:**
   - Two tabs inside the 10 s grace get 409.
   - A retired token after the grace still revokes the family and is audited.
   - The retirement time is stamped again just before commit, not when the UPDATE was sent (it may have waited for a lock), so the grace counts from when the token really stops working.
4. **Not chosen:** keeping the successor token (encrypted) in Redis so that a retry gets the same cookies. RULEBOOK §5 stores refresh tokens hashed only, and it would change what a replay inside the window gets.
5. **Tests:**
   - `auth-refresh-timeout.int-spec.ts`, scaled down (budget 500 ms, request timeout 1.5 s; another connection holds the session row locked):
     - the rotation is rolled back: 503, no cookies, no `Retry-After`, and no new row even after the lock is released. The same token then renews and `/auth/me` answers 200;
     - a short wait inside the budget still rotates, and the token counts as retired from after the wait;
     - real reuse after the grace still ends the family and is audited.
   - `auth-refresh-lock-timeout.int-spec.ts` uses the real values (8 s budget, 25 s request timeout). The database's 5 s `lock_timeout` cuts the wait first: 503 and nothing changed, then the token renews.
   - `db-errors.spec.ts` covers which database errors count as passing.
   - **Mutation checks:** without the budget, a second session row appears after the timeout's 503. Without the stamp before commit, the retirement time lands before the lock wait. Without the error mapping, the lock timeout answers 500.
6. **Not covered:**
   - a COMMIT that stalls for more than the margin before the request timeout (over 10 s);
   - an answer lost in the network after it was sent. That is not the API being slow.

## 2026-10-31 — E1: exam schema and exam admin (Claude; plan `docs/plans/EXAM-PLAN.md`, owner's exam rules)

1. **One row per question version.** A question's versions share a `lineage_id` (a random UUID); a partial unique index allows one active version per lineage. Once the exam has left draft, a trigger refuses any change to a question except its deactivation, and refuses DELETE: an edit inserts version + 1 and deactivates the old row, so an attempt that was given the old version keeps it. In a draft, questions are edited and deleted in place (no attempt can exist: `attempts_guard` only accepts attempts for a published exam).
2. **The lock is in the database, not only in the API:** `exams_frozen_after_publish` (timing, count, grace, category, round and pool rule frozen; the window only grows while open; back to draft only without attempts; archived never changes), `attempts_guard` (timer and layout never change, status only forward, never deleted), `submissions` append-only. The API checks the same rules first and answers 409 with reason codes; if a trigger still refuses (a race), the admin gets the same 409.
3. **Results cannot leak early by construction:** a CHECK refuses `results_published_at` before `window_end + grace`.
4. **`submissions` refuses TRUNCATE except in a `*_test` database.** `truncateAll` empties users with CASCADE, which reaches attempts and submissions; `audit_logs` can simply be skipped (no foreign keys), `submissions` cannot. A production database is never named `*_test`.
5. **Every admin write** runs in one transaction that locks the exam row (a publish and a question edit cannot interleave), re-reads the acting user (a demoted or blocked admin gets 403 within the token's 15 minutes), checks `expectedUpdatedAt` (409 `stale`), and writes its audit row in the same transaction: no change without its record.
6. **Owner Q2 in code:** publish needs exactly `questions_per_attempt` active questions, or at least that many with `random_draw`; a published fixed pool takes no new question and retires none (versions only).
7. **Refusal codes** travel in `ApiError.details` (a list), so the exception filter stays unchanged.
8. **`leaderboard_entries` ships now** (empty until E3), so the exam schema lands in one migration pair (`*_exam_engine`, generated, with a guard that stops on existing exam rows; `*_exam_checks`, hand-written).
9. **Old test databases** (lead review): main's earlier constraint tests left attempts and submissions (`answers: {}`) in every `*_test` database. `prepare-test-db.mjs` now runs payments' cleanup as a list of guarded migrations (payments, then exam): while `*_exam_engine` is not applied, it empties `submissions`, `attempts` and `questions` of a `*_test` database. Payments' log line and counts are unchanged (their migration test still passes). Test: `prepare-test-db.int-spec.ts` builds a scratch `*_prep_test` database at the state before the exam migration with such rows and runs the real script. Development databases need nothing (main's fixtures create no exam rows).

## 2026-10-31 — PayStation settings at boot, and the sandbox host check S11 (Claude; plan section 3.5)

1. **S11 (Rasel's sandbox account, 10 BDT `XS11…` invoices, never paid):**
   - sandbox credentials work only on `sandbox.paystation.com.bd`; on `api.paystation.com.bd` they get `"1001"` "Invalid Credential.";
   - the merchant id works only exactly as issued, with its "-".

   So the host allow-list in `payment.config.ts` stays as it is. The docs' curl example (no "-") and the Postman URL text (`api.…`) are wrong for the sandbox (`SANDBOX-CHECKLIST.md`).
2. **`PAYSTATION_ENV` blank = payments disabled.** Other environments and sessions without these variables (A2's and the exam session's `.env` files, CI) still boot. Once it is set, every rule applies at boot: `PaymentsModule` builds the settings and a wrong value stops the app.
3. **Boot log without any part of a credential.** It shows env, host, account label, invoice prefix, callback and IPN. The account label identifies the account, so the plan's "last 4 characters of the merchant id" is dropped.
4. **Callback:** `http://localhost` is allowed outside production (a browser redirect on the same machine); https otherwise. **IPN URL:** required only in production; blank locally until a tunnel exists.
5. **`.env.example`:** the PayStation host leaves both files; the values are blank, and `PAYSTATION_PAY_WITH_CHARGE=0`.
6. **Lead review (19:26)** accepted points 2 and 3, and added:
   - **Blank `PAYSTATION_ENV` on a production server:** a WARN line and the operator alert `payments.disabled_in_production` at every start (built; a new kind in `SecurityAlerts`). The RUNBOOK launch checklist compares the boot line.
   - **Initiate `"1001"` is a configuration error, not a failed payment:** a critical alert, a short pause of further initiate calls, "Payments are paused right now" for the student, and no blind retry (built with the gateway client, plan 6.1).
   - **PR 1 is split:** 1a (schema, fixtures, config) goes to `main` first, because the exam session's migrations build on it; 1b holds the gateway client, the fake server and the selfcheck.

## 2026-10-31 — Free book after payment (owner, via the lead)

1. Every student who pays gets one free book. After a successful payment the student confirms a delivery address. The admin can change the book's title and cover later.
2. It is part of the 15 November release unless the owner says otherwise. It gets its own migration and PR after the payments work, not PR 1's migrations.
3. The plan is in `docs/plans/PAYMENTS-PLAN.md` section 16.
   - **Owner's answers (18:17):**
     - (ক) Yes: the student may skip the book page after payment and give the address later from the dashboard, which reminds them until they do.
     - (খ) Yes: the address can change after confirming, until an admin marks the order shipped; after that it cannot.
   - The other defaults are accepted: the fields, Bangladesh only, one book per student, the admin list and the courier CSV.
4. **The cover is the system's first upload** (Claude's proposal, in the plan): bytes in Postgres, not on disk or in a pay-per-request service.
   - The API runs as 4 replicas, which do not share a disk.
   - `pg_dump` and the restore drill already cover the database.
   - JPEG, PNG or WebP only, up to 800 KB, decided by magic bytes; metadata stripped; served with `nosniff` and a `default-src 'none'` CSP.

## 2026-10-31 — Payments foundation, database part (Claude; plan section 4, lead review of 17:05)

1. **Three migrations:**
   - M1 `*_payments_registration`: generated, with a guard at the top;
   - M2 `*_registration_fee_400`: data;
   - M3 `*_payments_checks`: CHECKs, partial unique indexes and triggers.
2. **M1 refuses a database that holds payments or pending registrations.** The new NOT NULL columns have no backfill, and it never deletes data.
   - **Old dev database** (main's fixtures left 3 paid payments): `db:fixtures:dev --clean`, behind the fixtures' guards, removes only the fixture students' payments and registrations. Then migrate, seed and reload the fixtures (RUNBOOK section 0). On the shared `sirat`, only after Rasel says so.
   - **`*_test` databases:** `prepare-test-db.mjs` empties the three payment tables while M1 is pending, and marks a failed try rolled back, so `test:int` stays green after a merge.
   - Proven by `payments-migration.int-spec.ts` and once on `sirat_pay`.
3. **`payment_events.payment_id` is not a foreign key**, unlike the plan's first text, and follows `audit_logs.actor_id`. With a FK, the table's TRUNCATE trigger makes `payments` untruncatable, which breaks `truncateAll` in every integration test; unknown invoices need NULL anyway. `truncateAll` skips the table.
4. **Partial-index predicates compare enum literals.** Postgres requires IMMUTABLE functions there, and enum-to-text is only STABLE (error 42P17, checked). A future migration that recreates `PaymentStatus` or `RegistrationAttemptStatus` must drop and recreate the three partial indexes (05-DATABASE).
5. **The `registrations_payment_paid` trigger also checks the owner:** the payment must be paid and belong to the registration's user.
6. **Fixtures follow the real rules:** a completed attempt, initiated → pending → paid, 40000 paisa, invoice `FX…`, phones `0170000000n`. A fixture student who lost the registration gets one again. Emails, password and guards are unchanged.

## 2026-10-31 — No refund handling (owner)

1. **The system has no refund flow** (OPEN-QUESTIONS P8, plan Q4). No code moves a payment to `refunded`, the admin reconcile has no refund option, and the dashboard has no refund text; none of this gets tests. The enum value `refunded` stays (no migration), and the status-transition trigger never allows it.
2. **A refund reported by PayStation** for a paid payment (status API or IPN) does not change the status. `payment_events` records `refund_reported` and a critical alert is raised, with a test. S26 is tried only if it is easy in the sandbox, to see this alert.
3. **Duplicate payments:** a second or late paid payment (`duplicate_payment`) is still detected, raises a critical alert and shows in the admin list. Whether money is returned is outside our system (client, PayStation panel). This replaces the plan's D3 (refund by an admin).
4. **So preventing a double charge matters more:** at most one attempt in progress per email and per phone, and the checkout expiry is never shorter than PayStation's link lifetime (S12).

## 2026-10-31 — Duplicate email and phone at registration (owner)

1. **Email with an account:** bn "এই email দিয়ে আগেই রেজিস্ট্রেশন হয়েছে। অনুগ্রহ করে login করুন।", en "Already registered. Please log in." No password-reset wording; the login page link stays as it is. Rate limits as planned (per IP and per email).
2. **A payment in progress for the same email:** the plan's default stays (plan Q3 b).
3. **Phone numbers are unique:** one number, one student. This replaces the plan's "phone not unique".
   - Stored in one form, `01XXXXXXXXX`. The server normalises `017…`, `+88017…` and `88017…` to it, with tests.
   - `users.phone` is UNIQUE; NULL stays allowed, e.g. admins made by the CLI.
   - One attempt in progress per phone, via a partial unique index like the email one. Both are in the first payments PR's migrations.
   - Message: bn "এই ফোন নম্বর দিয়ে আগেই রেজিস্ট্রেশন হয়েছে। অন্য নম্বর দিন।", en "This phone number is already registered. Please use another number." Rate limits as for the email.
   - The fixture students get distinct phone numbers.
4. **Final (owner, 2026-10-31 17:35):** email and phone are both unique, and nobody can use another person's email or phone. Nothing beyond that is built: no OTP, no admin tool to free a number, no extra flow.
   - **Any phone conflict gets that one phone message,** whether the number already has an account or has an attempt in progress under another email.
   - The partial unique index on open attempts per phone stays. It is not extra logic: it is what makes the rule hold, and with no refunds it stops two people being charged for one number.
   - The two email messages stay as in points 1 and 2.

## 2026-10-31 — Exam rules: format, pool, window and grace, rule violations, results (owner)

Answers to OPEN-QUESTIONS #4–#10, through the lead (2026-10-31). Plan: `docs/plans/EXAM-PLAN.md` (section 9; violations in 3.15).

1. **Format (#4):** multiple choice with one correct answer, 4 options (2–6 allowed), 1 mark each, no negative marking, text only, each question in the language the admin types. The option order is shuffled per student, except questions marked "keep order".
2. **Pool (#5):** everyone gets the same questions (pool = questions per attempt), so the olympiad ranking stays fair; only the question order and the option order are shuffled. Different questions per student from a larger pool only if the admin chooses it for an exam (`random_draw`). The lead's proposal, approved by the owner.
3. **Window, time, grace (#6–#8):** the admin sets each exam's window (at least one exam long); 30 minutes stays the hard maximum; grace 30 s; a late starter gets only the time left in the window; the timer keeps running during a disconnect; if no submit arrives by the end of the grace, the server submits the last checkpoint (or an empty sheet).
4. **Rule violations (#9; the plan's log-only default is replaced):**
   - **What counts:** a tab or app switch (window blur) and the developer-tools keys (F12, Ctrl+Shift+I/J/C, Cmd+Opt+I/J/C). Reload, close and offline do not count.
   - **What the student sees:** each violation blurs and greys the exam with "Warning n/5" and "Return to exam". After 5 warnings, the 6th violation ends the exam and submits the current answers, with the reason recorded (`violations`), as in the old Zero Olympiad.
   - **On for every exam, always;** there is no admin switch. Right-click and text selection are off in the exam area.
   - **The count is kept in the browser and on the server,** so a reload or another device never resets it. The admin sees each student's count, end reason and events.
   - **The rules text** claims nothing the system does not do, and asks students to use Do Not Disturb on phones.
   - If the 5th violation should end the exam instead, only the shared constant changes.
5. **Results (#10):** students see rank, name and institution only (no scores, times or emails); an equal score is ranked by time, and equal score and time share a rank (1, 2, 2, 4). After an admin publishes the results, each student sees their own score, rank and a review with the correct answers and explanations.

## 2026-10-31 — Web session: the real session replaces the mock (Lead approved the plan; Claude implementation)

1. **Server-side lookup:** `getSession()` asks `GET /api/auth/me` straight from the web server to the API inside the stack (`API_INTERNAL_URL`, compose inline `http://api:4000`; required in production, dev default `http://localhost:4000`). Only the access cookie goes along, plus the student's IP and nginx's request id.
2. **Client IP (Lead's condition a):** nginx sends `X-Real-IP $remote_addr` and `X-Forwarded-For $proxy_add_x_forwarded_for`, whose first entries the client can write. The web reads only `X-Real-IP` and sends exactly one `X-Forwarded-For` value. The API (trust proxy 1) takes the last entry, so it sees the client address that nginx recorded in `X-Real-IP` (`$remote_addr`), never the web container or an entry the client wrote. This applies only in production, behind nginx; in dev, `X-Real-IP` is client input and nothing is forwarded. A test sends a forged `X-Forwarded-For`.
3. **Failures never log anyone out:** no cookie or a 401 goes to `/refresh`. Anything else (API down, 429, timeout) goes to the error page and never to `/login`, because a busy API must not log a whole exam hall out. `check-pages api-down` proves it with the API stopped.
4. **/me cache (condition c):**
   - It lives in the web process for 30 s and is keyed by the SHA-256 of the access cookie, never the cookie itself.
   - It holds at most 5,000 entries and stores only 200 answers, never errors.
   - **Trade-off:** a block or a role change can take up to 30 s to show in the web. The API's guards trust the role in the access token and do not check blocks until it expires, up to 15 min (as A2.1d #9 records); `/auth/me`, refresh and login read the database at once.
5. **One access table (`apps/web/src/lib/access.ts`):** it drives the page guards, the sidebars and the page checks.
   - Every dashboard page and Server Action calls `requireAccess()` first, because layouts do not re-render on client-side navigation.
   - The other area sends the user to their own home. A page of their own area that the role may not open is not found.
   - Under a `loading.tsx` the not-found answer is already streaming with HTTP 200, so the checks look for the not-found page rather than the status.
   - **Public site (Lead):** that 200 is accepted for the dashboards only. The public site needs a real 404 for search engines, so where its `loading.tsx` files sit is reviewed again in Phase D (the root `app/loading.tsx` wraps the public pages too).
6. **Proxy (`src/proxy.ts`, condition b):**
   - The matcher covers `/dashboard` and `/admin` only. `/refresh`, the auth pages, `/api`, `/_next` and the public site are outside it, so it cannot loop and the public pages pay nothing.
   - A GET or HEAD without the access cookie goes straight to `/refresh?next=`. Server Actions pass through and check the session themselves.
   - `x-sirat-path` is always overwritten. Next relativizes the redirect Location, so nginx's http/https does not matter.
7. **Renewal in the browser (`/refresh`, `api()`):** the refresh cookie is only sent to `/api/auth`, so a server render cannot renew the session.
   - **One refresh at a time:** per tab, plus across tabs with Web Locks. Older phone browsers have no Web Locks, so there it is per tab only (condition d, tested).
   - **Answers:** 204 is ok. 409 means another tab just rotated; it waits 300 ms and is ok. 401 goes to `/login`. 429, 5xx, a network error or a stuck lock wait count as "unavailable": the browser backs off (honouring Retry-After) and never goes to `/login`.
   - **A slow API never ends the session (Lead):** the refresh POST has no time limit in the browser and is never aborted. Once the API has rotated the token, the new cookies exist only in its answer; cutting it short would lose them, and the next try would send the retired token, which the API treats as reuse and ends the session. After 10 s without an answer, `/refresh` says the server is slow and keeps waiting (nginx answers within its 30 s `proxy_read_timeout`). A unit test pins that the POST carries no abort signal. An e2e case holds the answer 15 s and checks that the page waits, never offers or goes to `/login`, and lands with a live session (Chrome stores the cookies when the headers arrive, so the case cannot replay the lost-cookie path itself).
   - **No way out while a renewal is in flight:** "Try again now" and "Sign in instead" show only between tries. The POST outlives the page (keepalive), so its late answer would overwrite or clear the cookies of a login made meanwhile; on a shared computer, even another student's.
   - **Gap on the API side (closed by the next PR):** the API's 25 s request timeout answered 503 while the handler could not be cancelled, so a rotation that committed after it was lost. See "Refresh rotation inside a time budget".
   - **Loop guard:** only renewals that worked count. After 2 within 2 minutes for the same page in one tab, the next arrival goes to `/login`. Reloads while the API is unavailable count nothing, so an outage never sends anyone to `/login`. No storage, or storage that throws even when read, fails closed to `/login`.
   - Every browser POST sends `X-Requested-With`, the refresh included (condition f).
8. **`next=`:**
   - After one decode, any control character or backslash is refused.
   - The value is parsed against this origin, and only `/dashboard` and `/admin` pages are allowed (never `/login`, `/refresh` or `//`).
   - The unit tests cover the attack strings.
9. **Logout in both shells (shared school computers):**
   - An expired access token is renewed first.
   - The browser goes to `/login` only after a 204, or after a refresh 401 that cleared the cookies. Otherwise it shows "not logged out yet".
   - `BroadcastChannel('sirat-auth')` sends the other tabs to `/login`, and a page restored from the back-forward cache reloads.
10. **Auth pages:**
    - **Login:** a 429 is the account lock only when the API says "Too many attempts" or Retry-After is a minute or more. nginx's flood 429 (Retry-After 1) reads as "busy".
    - **Reset and verify:**
      - The `#token` is read on load, and again when a new emailed link (a hash with `token=`) is opened in the same tab; the form then starts over. Any other hash, such as an in-page anchor, keeps the current token. The token is then dropped from the address bar.
      - A token that is not the 43-character base64url shape gets the bad-link state with no request.
      - The POST goes out only on a button press, one at a time.
      - A bad link is recognised by its exact message.
    - **Login, forgot, reset and verify forms:** each uses `method="post"` and keeps submit disabled until hydrated. The register form (Phase C, payments) must follow the same rule when it is rebuilt: today a submit before hydration would put its fields in the URL.
11. **Jury (Lead):** a plain placeholder at `/admin`, with its text from i18n and no stats call.
12. **Checks (Lead):**
    - **CI page checks:** real sessions (option A). The API runs in the job with a fixture student and an admin made with the create-admin CLI. The fixtures guard is unchanged; the CI Postgres runs with `-c sirat.environment=test`.
    - **Browser driver:** one CDP driver (`scripts/lib/cdp.mjs`, option A, no dependency) serves both `check-pages` and `e2e.mjs`.
    - **e2e only on this machine (Lead):** it changes a student's password, so a base URL or `MAILPIT_URL` whose host is not 127.0.0.1, localhost or ::1 stops it before any request, the same idea as the fixtures guard (tested).
    - **Web logs (condition e):** no cookie, token, `#token`, `next` value or `/me` body; server-side fetch errors carry class and status only. A CI step greps the production log.
13. **Per-user API limits (Lead):** not an open question; DECISIONS A1 #8 and 06-API already settle it. It follows as its own small API PR before 2026-11-15: the key is the user id when a verified session exists, otherwise the IP. nginx's `api` zone stays per IP (30 r/s, burst 60); that PR records it as a risk to measure in the load test.

## 2026-10-31 — Gateway charge: the merchant pays it, `pay_with_charge = 0` (owner)

1. The student pays exactly the fee (400 BDT); the merchant bears PayStation's charge: `pay_with_charge = 0` (OPEN-QUESTIONS P6, plan Q1). This replaces the default `pay_with_charge=1` in OPEN-QUESTIONS #1.
2. **Only this path is built.** `PAYSTATION_PAY_WITH_CHARGE` must be `0`; any other value stops the API at boot (fail closed). The v2-based amount rule and the charge calculation for `1` are not built, which saves time and tests. `payments` gets no `charge_minor` column; `paid_amount_minor` records what PayStation reported.
3. **Amount rule:** paid only when v1 `payment_amount` equals the payment's `amount_minor` exactly. A lower or higher amount is never paid: `rejected_amount` and a critical alert.
4. Still verified in the sandbox (S10): with `0`, `payment_amount` is exactly 400 and the checkout shows the student 400.

## 2026-10-31 — Registration form fields (owner)

The plan's default is approved (plan Q2): name, phone (BD mobile), district, institution, education type, grade level (one of the 17), email, password, and an optional promo code. All are required except the promo code. No date of birth, gender, guardian or photo (minimum personal data for minors).

## 2026-10-31 — First release: registration and payment by 15 November 2026 (owner, via the lead)

1. **Target 15 November 2026.** The first release is registration and payment only. It ends when a student logs in and sees their own registration and payment status on the dashboard. No part of the exam engine is needed.
2. **Order change:** this release comes before the exam engine. For it, the phase order of `10-BUILD-PLAN.md` (A backend → B dashboards → C registration/payment) is replaced: the registration and payment API, the web wizard, the payment result page and the dashboard status are built now. The public marketing site stays Phase D. The Phase C Definition of Done (17 points) applies in full.
3. Plan, day-by-day order and the proof for each DoD point: `docs/plans/PAYMENTS-PLAN.md`. The plan and these decisions reach `main` in a docs-only pull request before any code (lead review, 2026-10-31); the code pull requests follow the split in the plan's section 10.

## 2026-10-31 — Registration fee: 400 BDT, stored in settings (owner)

1. **The fee is 400 BDT**, stored as `settings.registration_fee_minor = 40000` (paisa, integer), not in `.env`. Replaces the same day's `REGISTRATION_FEE_BDT` idea (never built) and the placeholder 0 of A1 #6.
2. **Set by a migration** that inserts the key when it is missing and changes it only while it is still the placeholder 0. Why: the `migrate` job runs migrations before the seed and the seed only inserts missing keys, so an UPDATE alone does nothing on an empty database and the seed would then write 0. The seed default becomes 40000 too.
3. **Only an admin changes it**, after a confirmation: a dialog shows the old and new value, and the server requires the value the form showed and answers 409 if it changed in the meantime, so an old form never overwrites someone else's change. Every change is audit-logged with the old value, the new value and a reason.
4. **Snapshot:** a payment copies the fee when it starts. An amount from the client is never accepted. The amount PayStation reports must match the payment row.
5. **A fee of 0 or less, or not whole taka, stops payments:** the server does not start one, and a DB CHECK refuses such a value.
6. The currency stays BDT (`settings.currency`); a payment refuses to start with anything else.

## 2026-10-31 — PayStation account settings from env (owner)

1. Sandbox work uses the owner's own PayStation test account now; the client's account replaces it later. Credentials, account label, invoice prefix, callback URL and IPN URL come from `.env`, so switching accounts changes `.env` only.
2. **The host is not free in `.env`** (lead review, 2026-10-31). PayStation's host is the same for every merchant, so `payment.config.ts` holds a two-entry allow-list (sandbox, live) and `PAYSTATION_ENV` picks the entry, as decided on 2026-10-30. `live` is refused unless `NODE_ENV=production`. If `PAYSTATION_BASE_URL` is set for `sandbox` or `live`, it must equal that label's host or the API does not boot. Only `fake` (the dev/CI fake server, never in production) accepts any URL. Why: with a free base URL, a dev machine with `PAYSTATION_ENV=sandbox`, the live host and live credentials would take real money, and no guard would notice. No other source file contains a PayStation host (a source scan checks this). If the sandbox shows a different host (S11), one line of the allow-list changes. This replaces the same day's first idea of a free base URL from `.env`, which was never built.
3. Each payment records the account it belongs to, and invoice numbers carry an account prefix, so test data never mixes with live data. The switch checklist (what to re-verify, how test data stays apart): `docs/plans/PAYMENTS-PLAN.md` section 13.

## 2026-10-31 — Launch target and how the next work is split (Lead, through the owner)

1. **Launch on 2026-11-15 with registration and payment only.** Students log in after paying, so the first-admin CLI and the web session are on the critical path.
2. The first-admin CLI is its own small PR. The web session (the mock replaced) follows on its own branch from `main` after a short plan to the owner, so it does not collide with the UI work.
3. `apps/api/package.json` is shared by several sessions: keep changes to single lines. A new dependency or a `pnpm-lock.yaml` change is announced to the owner first.

## 2026-10-31 — First-admin CLI (Claude; owner's A2 order)

1. **Admins are created only from the command line** (`apps/api/src/cli/create-admin.ts`, RUNBOOK §13): there is no admin sign-up and the web never accepts a role (RULEBOOK §18). The same CLI creates later admins.
2. **The password is never an argument or an environment variable** (shell history, process list): a hidden prompt asked twice, so the command needs a terminal; without one it stops at once (exit code 2) instead of waiting for input with no prompt on screen. Any `--password…` argument is refused and never repeated back, and neither is a stray value. `--password-stdin` reads piped stdin for the automated tests only (Lead, 2026-10-31: the prompt is the main path, a piped password stays in shell history). Same policy as every password (length, common-passwords list), hashed with argon2id.
3. **Created verified**, with no verification email: an operator typed the address. One transaction writes the user and an `admin.created` audit row (`meta.via = cli`; no actor, there is no session).
4. **An existing email is refused, never changed:** the CLI cannot promote a student or reset someone's password. Role changes stay a later, audited admin feature.
5. It prints only the new user id; errors are fixed messages (never the password or a raw database error).

## 2026-10-31 — A2.1e email-link endpoints and operator alert emails (Claude; owner rules of 2026-10-31)

Each protection has a test that fails without it (mutation-checked); forgot/resend are tested end to end through a worker and Mailpit.

1. **forgot-password, resend-verification:** always 204 at once with an empty body. The account lookup, the token and the email run in the background (`BackgroundTasks`), so neither the answer nor its timing reveals whether an account exists. Only an existing, unblocked account gets a reset link; only an existing, unblocked, unverified one gets a verification link. At most `AUTH_LINK_EMAILS_PER_MINUTE` (1) and `AUTH_LINK_EMAILS_PER_HOUR` (5) link emails per address and kind; the answer is the same either way.
2. **reset-password:** a bad link is refused before argon2 runs. One transaction uses the token, sets the hash, marks the email verified (the link proved the inbox), retires the other reset links and ends every session; only after the commit is the account unlocked everywhere (owner). No automatic login. A password refused by the policy leaves the link usable.
3. **verify-email:** sets `email_verified_at` in the same transaction that uses the token; never creates a session or sets a cookie (tested). A valid link for an already verified address answers 204 and changes nothing.
4. **Bad links:** unknown, malformed, used, expired, other-type and blocked-account links all get one 400 ("This link is invalid or has expired"). Exactly one of two simultaneous uses of a link succeeds.
5. **Throttle tiers** (superseded by "Per-user API limits": 300/min each now) (per route and client IP, on top of the per-address caps): 60/min for the two link requests (sized for a school behind one IP), 30/min for reset and verify.
6. **Operator alert emails** (owner): the `security.<kind>` audit row and a warn log line marked `alert` come first and are the source of truth. The email to `SECURITY_ALERT_EMAIL` (unset: no email) goes out from the background, so it never slows or blocks a login: at most one per alert kind per 10 minutes and `SECURITY_ALERT_EMAILS_PER_HOUR` (6) in all, through the cache Redis. If that limit cannot be checked, the email is held back. It names the kind, the time, the account id and counts; never an email address or an IP.
7. **BackgroundTasks:** work after the response logs failures by class only and may finish on SIGTERM (up to 10 s); a crash in between loses that email, and the user asks again.

## 2026-10-31 — UI port of the dashboards (owner decisions; Claude implementation)

The client accepted the old dashboard UI, so student and admin screens were ported before their APIs exist. Details and the endpoint map: `07-UI-MIGRATION.md`.

1. **Mock data layer first (owner).** For this port only, this replaces `10-BUILD-PLAN.md` rule 4 ("dashboards are real, not mock"): pages read `getData()` (`apps/web/src/data`); development gets a mock source, production an `unavailable` source, so pages show their error state until the HTTP source is added behind the same interface. Why: the look was approved and the APIs are not built yet.
2. **Types come from the schema (owner).** `@sirat/shared/records.ts` mirrors `schema.prisma` field names and nullability (compile-time check) and `dashboard.ts` is the response contract for web and API; `data/schema-sync.test.ts` fails CI on drift. The web does not import `@prisma/client` (no new dependency, no Prisma in the browser bundle).
3. **Mock never ships (owner).** `getData()` gates the mock behind a literal `NODE_ENV` check and `scripts/assert-no-mock.mjs` fails `next build` if mock code is in the output; `?mock=` is ignored in production (unit test).
4. **Leak check on rendered output (owner).** `?mock=leak` feeds canary scores, times, other people's emails and answer keys into student data; `scripts/check-pages.mjs leak` fails if any of them shows up in a student page or its RSC payload. `check-pages.mjs prod` opens every dashboard page of a production build in headless Chrome/Edge and fails on a blank page or raw error text.
5. **i18n without a library.** Typed TS dictionaries per feature (`bn` must mirror `en` at compile time), locale from an httpOnly `locale` cookie set by a Server Action, then Accept-Language, default English. Dates and times in Asia/Dhaka, 24-hour clock, Bangla digits in bn. `lang` is set on the dashboard wrapper, so marketing pages stay static. The plan said JSON files; TS modules avoid shared-file conflicts and give key parity. Root boundaries (`app/error.tsx`, `loading.tsx`, `not-found.tsx`) are bilingual because they sit above every translated layout and must not read cookies; dashboards have their own translated 404.
6. **Charts (owner):** own server-rendered SVG in `@sirat/ui/charts` (separate entry point), no chart library.
7. **Colour (owner):** the old emerald accent maps to the brand primary; no accent token.
8. **Contrast (owner, 2026-10-31):** WCAG AA (4.5:1) for all text. New `-strong` tokens for text and filled buttons (primary #B4470F, hover #963A0B; danger #B91C1C); the brand orange #E3621C stays for icons and large accents. Rank names are badges with a light background and dark text. `ink-muted`/`ink-faint` are darker. `apps/web/src/design/contrast.test.ts` fails on any tone or bg+text pair below 4.5:1.
9. **Admin screens are read-only (owner):** action buttons are hidden, not greyed, until the audited admin APIs exist.
10. **Tests:** `node --test` with Node's type stripping (no new packages); `apps/web` sets `allowImportingTsExtensions` for that.
11. **Error boundaries call `retry()`** (Next 16.3+), which re-fetches server data; `reset()` would only re-render the same failed result.
12. **Profile edit** posts to a Server Action that reads only the allow-listed fields (`data/profile.ts`). Phone numbers accept Bangla digits and a +88 prefix and are stored as 01XXXXXXXXX. No photo upload: the schema has no photo field.
13. **Ambassador panel (owner):** its commit is the last one, on its own branch `feat/ui-ambassador`, not pushed and not in the first two PRs (no backend yet). The rank card tells apart no tiers, the real top rank and climbing, including a new ambassador at 0 points.
14. **Process for this branch (owner):** light checks per commit (web/ui type-check, lint of changed files, the mock-gate and no-score tests), full lint/type-check/test/build before each PR; every commit is type-checked in isolation from a `git archive` copy in the git-ignored `.verify/` (one offline install). Rebased onto `main` once, before the first push (2026-10-31); after pushing, no rebase and no force-push. Branches: `feat/ui-student` (PR to `main`), `feat/ui-admin` (PR to `feat/ui-student`), `feat/ui-ambassador` (local only).
15. **`notFound()` for an unknown exam (owner):** `/admin/exams/:id` calls `notFound()` and renders the translated not-found card with `noindex`, but the status stays HTTP 200: the response starts streaming from the `loading.tsx` boundaries above the page (root, admin, exams) before the page can call it (Next 16 docs, `loading.md` "Status codes"). Removing those skeletons was ruled out; a real 404 needs a request-time check in Proxy once the exams API exists.
16. **Follow-ups (owner, 2026-10-31):** `<html lang>` follows the locale together with the public pages (the root layout is static and shared with the auth pages; dashboard content already carries `lang` on its wrapper); nginx access logs drop the query string in a separate infra commit (the default `combined` format logs `$request`, so admin search terms such as names and emails reach the logs; this UI work does not touch nginx); the `LoginForm.tsx` error text (`text-danger`, below AA) is a small follow-up after the student PR merges.
17. **Known limitations:** error states appear after hydration (Next behaviour), so page checks use a headless browser; `next dev` writes `apps/web/AGENTS.md` (git-ignored) and rewrites `next-env.d.ts` (never commit it).
18. **Open:** leaderboard tie rule (the mock shares a rank: 1, 2, 2, 4); default UI language (English for now); new endpoints to add to `06-API.md` (`GET /dashboard/home`, `/content/profile-options`, `/admin/leaderboard`).

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
10. **Not yet:** the web pages (reset, verify) and the web refresh flow, the first-admin CLI, and the cleanup job for old sessions and tokens. *(forgot/reset/verify/resend and the per-address caps: done, A2.1e; the first-admin CLI: done, see "First-admin CLI".)*

## 2026-10-31 — Login limits and locks (owner)

1. The per-IP limit counts **only failed** logins, about 60–100 per minute, changeable in config; the IP comes only from Cloudflare's trusted header (nginx restores it; the API trusts one proxy hop).
2. Failures are counted per account+IP pair. **During a lock even the correct password does not log in.** A lock ends by itself after 15 minutes, longer step by step when locks repeat. Without a lock, a correct password resets the failure count to zero. A completed password reset unlocks the account. Messages never reveal whether an account exists.
3. A separate, larger account-wide limit: about 50 failures per hour.
4. Now build login, forgot, reset, verify, resend and change-password.

## 2026-10-31 — Email provider: Amazon SES (owner)

1. **Amazon SES** is the production email provider. Supersedes "Email provider (owner)" of 2026-10-30 (Resend); the Resend adapter built that day was removed before merge.
2. SESv2 through the AWS SDK v3 (`@aws-sdk/client-sesv2`). Credentials come from env only (`SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`) and are passed to the client explicitly, so the SDK never reads `~/.aws`, instance metadata or other `AWS_*` variables.
3. The IAM user may call **`ses:SendEmail` only**, scoped to the sending identity (policy in RUNBOOK §12). The worker accepts long-term IAM user keys (`AKIA...`) only and refuses AWS's documentation example keys. Keys are never logged or committed.
4. The worker refuses to start when no provider is configured. Locally it always uses Mailpit (the dev override pins it).

## 2026-10-31 — A2.1c email: queue, worker, SES and Mailpit (Claude; owner's email rules of 2026-10-30)

1. **Only the worker sends.** The API enqueues (`EmailQueue.enqueue`) on the queue Redis; `apps/api/src/worker.ts` (same image, compose service `worker`, 02-SYSTEM-DESIGN) consumes. Only the worker requires the email settings (`validateWorkerEnv`); the API boots without them.
2. **Never blocks** (owner): `enqueue` never throws. It returns false at once when the queue Redis is not ready and after 2 s when it hangs, and logs kind and key only. Callers carry on either way; the user can ask for the email again.
3. **Idempotency:** the caller's key (e.g. `verify-email.<token id>`; BullMQ forbids colons) is the job id, so a key still waiting or failed is not queued twice. SES has no idempotency key, so a retry after a lost SES response can send twice (rare); Mailpit shows the key as a header.
4. **Retries:** 8 attempts, exponential from 30 s (about 2 h in all). Failed jobs are kept 3 days; sent jobs are removed at once, because they hold the address and the link. A permanent provider error fails the job immediately.
5. **Providers:** SES (SESv2 `SendEmail`, SDK retries off so the queue is the one retry layer, 10 s abort signal per call). `MessageRejected`, `BadRequestException` and `NotFoundException` are permanent; throttling, quota, paused or suspended sending, an unverified MAIL FROM domain, service and network errors are retried. Mailpit (`POST /api/v1/send`, plain fetch) in development and CI. Errors carry status codes and SES error names only; keys, addresses and content are never logged.
6. **Config:** `EMAIL_PROVIDER` (ses|mailpit), `EMAIL_FROM`, `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `MAILPIT_URL`. The scaffold's unused `EMAIL_API_KEY` is gone.
7. **Infra:** the worker publishes no port; its health endpoint (`WORKER_HEALTH_PORT`, 4001) serves only the container healthcheck. Mailpit `v1.32.0` runs in the dev override (UI `http://127.0.0.1:18025`) and in CI's database job.
8. **No real email from a local stack:** the dev override pins the worker to Mailpit, whatever `.env` says. On the VPS the email settings start blank, so the worker refuses to start until a provider is configured. A blank `KEY=` in any env file now counts as not set (class-validator's `@IsOptional()` only skips undefined; blank lines copied from an old example would otherwise stop the API).
9. **Not yet:** the emails themselves (verify, reset, welcome) and their templates arrive with their endpoints; the SES setup (verified domain, DKIM, MAIL FROM, DMARC, production access) before any production sending (RUNBOOK §9 and §12).

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
4. **No direct pushes to `main`** until OPEN-QUESTIONS #25 is decided: branches and pull requests only; the owner merges (superseded by "Who merges pull requests (owner)", 2026-10-31).
5. **OPEN-QUESTIONS #27** (non-superuser runtime DB role) is on the pre-launch checklist (RUNBOOK §9).
6. **PayStation, from the official docs** (summary: `docs/paystation/PAYSTATION-NOTES.md`). The docs confirm RULEBOOK §8's endpoints; a grant-token flow does not exist. Rules for the code:
   - **paid** only when `status_code` is `"200"`, `lowercase(data.trx_status)` is `success` or `successful`, the amount and invoice match, and `trx_id` is non-empty and unused. `failed` → failed. **Any other value is neither paid nor failed**: it stays pending, the reconciliation job looks again, and an alert is raised. The accepted list is updated after the sandbox shows the real values.
   - Our invoice number goes into the `callback_url` path (at most 200 characters). It is a hint only; verification is always through transaction status.
   - An empty `trx_id` is stored as NULL. **`2001` never marks a payment failed.**
   - `PAYSTATION_ENV=sandbox|live` → `https://sandbox.paystation.com.bd` / `https://api.paystation.com.bd`; live credentials are refused unless `NODE_ENV=production`.
   - The PDF and the Postman export stay local and git-ignored (shared sandbox credentials inside); `PAYSTATION-NOTES.md` is the committed, credential-free summary.
   - PayStation has **no refund API**: refunds are reconciled by an admin (RUNBOOK §11); what a refund does to a student's access is OPEN-QUESTIONS P8.

## 2026-10-30 — Email provider (owner) *(superseded 2026-10-31: Amazon SES)*

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

Hosting fallback (Malaysia/AWS), email provider, domain/Cloudflare, `manager` role duties, ambassador approval flow, client confirmation of grade bands / fee / rank thresholds, VPS specs.

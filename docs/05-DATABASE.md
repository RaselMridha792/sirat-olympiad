# 05 — Database

Source of truth: `apps/api/prisma/schema.prisma` (validated; see note at bottom). PostgreSQL 17 behind PgBouncer (transaction pooling).

## Conventions

* Migrations only. Never edit the schema by hand on the server. A fresh environment must be rebuildable from the repo alone.
* UUID primary keys, `created_at`/`updated_at` as `timestamptz` (UTC). Admin UI displays Asia/Dhaka.
* Money = integer minor units + currency code. Never floats.
* Real FKs, `NOT NULL`, `UNIQUE`, `CHECK`. Multi-step writes (payment confirmation, registration, submission, promotion) are transactions.
* Every FK and every hot-path `WHERE/ORDER BY` column has an index; verify with `EXPLAIN ANALYZE`.

## Tables (by area)

| Area | Tables | Notes |
|---|---|---|
| Identity | `users`, `sessions`, `auth_tokens`, `audit_logs` | `sessions` = refresh families (rotation + reuse detection). Tokens stored as hashes |
| Config | `grade_levels`, `settings`, `rank_thresholds` | Grade→category mapping and runtime settings are DATA |
| Payments | `pending_registrations` (one registration attempt), `payments` (N per attempt), `registrations`, `payment_events` | One paid payment ↔ one registration; the form lives server-side in the attempt; `payment_events` is append-only (plan: `docs/plans/PAYMENTS-PLAN.md` section 4) |
| Exams | `exams`, `questions`, `attempts`, `submissions`, `leaderboard_entries`, `answer_key_corrections` | `attempts` UNIQUE(user, exam); `submissions` idempotent and append-only; `questions` = one row per version; `leaderboard_entries` = the results snapshot (EXAM-PLAN D8); `answer_key_corrections` = append-only key corrections after publish, the newest per question is the key in effect (E7b) |
| Rounds | `rounds`, `round_entries`, `jury_scores`, `certificates` | Data-driven rounds; append-only jury history |
| Ambassadors | `ambassador_profiles`, `point_ledger`, `teams`, `team_members`, `admin_tasks`, `task_assignments` | Ledger append-only |
| Content | `announcements` | |
| Free book | `book_orders` (one per paid student), `book_images` (covers, bytea) | `book_orders` UNIQUE(user_id) and a composite FK `(registration_id, user_id)` → `registrations (id, user_id)`: an order only for the student's own paid registration. CHECKs: the phone, the 64 districts (the same list as `BD_DISTRICTS`, pinned by `districts-check.spec.ts`), lengths, shipped ⇔ `shipped_at` and `shipped_by`. Trigger `book_orders_locked_after_shipping`: a new order starts `confirmed`; once `shipped` nothing changes. `book_images` CHECKs: JPEG/PNG/WebP, ≤ 800 KB, 100–4000 px, sha256. Migrations `*_book_orders` + `*_book_checks` (PAYMENTS-PLAN §16.2) |

## Constraints that MUST exist (asserted by `apps/api/test/db-constraints.int-spec.ts`)

| Constraint | Why |
|---|---|
| `attempts UNIQUE(user_id, exam_id)` | One attempt per student; timer cannot be reset |
| `submissions UNIQUE(attempt_id)`, `UNIQUE(request_id)` | Idempotent final submit |
| `payments UNIQUE(invoice_number)`, `UNIQUE(trx_id)` | No reused invoice; no double-applied transaction |
| `registrations UNIQUE(user_id)`, `UNIQUE(payment_id)` | One payment ↔ one registration |
| `registrations.participant_id` NOT NULL, UNIQUE, DEFAULT `gen_participant_id()`, CHECK `participant_id_check` | The participant ID (admit card; with the email, the student's login; DECISIONS "The participant ID"): `ON` + 10 random digits + a Damm check digit, drawn by the database from `gen_random_uuid()` bits (strong random, never sequential), re-drawn while taken. Every insert path gets one without naming the column; existing rows were backfilled. `participant_damm` and `participant_id_check` mirror `@sirat/shared` (cross-checked in `participant-id.int-spec.ts`). Never logged or audited. Migration `*_registrations_participant_id` |
| `payments` one active (`initiated`/`pending`) payment per attempt (partial unique index) | "Try again" never runs two checkouts at once |
| `pending_registrations` one `open` attempt per email and per phone (partial unique indexes) | No double charge from two browsers (owner, DECISIONS "No refund handling") |
| `users UNIQUE(phone)` (NULL allowed) and `phone ~ '^01[3-9][0-9]{8}$'` on `users` and `pending_registrations` | One phone number, one student, in one stored form (owner) |
| `users.password_hash` nullable; `users_password_for_staff`: `password_hash IS NOT NULL OR role IN ('student','ambassador')` | Students and ambassadors log in with email + participant ID and have no password; admin, manager and jury always have one (DECISIONS 2026-11-11). The reverse rule comes with payments' P2 |
| `payments` status transitions follow the state machine; a new row is `initiated`; `refunded` is never entered (trigger) | A stale answer never downgrades `paid`; no refund handling (owner) |
| `payments` CHECKs: whole taka, `currency = 'BDT'`, paid ⇒ `paid_amount_minor = amount_minor`, invoice `^[A-Z0-9]{10,20}$`, `trx_id <> ''`, account label format | Raw SQL (`*_payments_checks`) |
| `payments.gateway_env` in (`sandbox`, `live`, `fake`, `demo`): the PayStation environment at start, or demo data | Raw SQL (`*_payments_gateway_env`); start always writes `PAYSTATION_ENV`; no default after the backfill, so a write that forgets it fails; the demo loader refuses a database with a paid `live` row |
| `pending_registrations` CHECK: `completed` ⇔ `user_id` and `completed_at` set | Raw SQL |
| `payment_events` append-only (UPDATE, DELETE, TRUNCATE refused); `payment_id` deliberately not a FK, like `audit_logs.actor_id` | The gateway log keeps unknown invoices and is never blocked by payment rows |
| `settings` CHECK: `registration_fee_minor` is a positive whole-taka number | Raw SQL; the fee is 40000 (owner) |
| Partial-index predicates compare enum literals (Postgres needs IMMUTABLE there; `::text` is only STABLE) | A migration that recreates `PaymentStatus` or `RegistrationAttemptStatus` must drop and recreate those three indexes |
| `point_ledger UNIQUE(event_key)` | Points never awarded twice |
| `point_ledger` append-only: UPDATE, DELETE and TRUNCATE refused (TRUNCATE allowed only in a `*_test` database); `ambassador_profiles` promo code `^[A-Za-z0-9_-]{3,40}$` (`*_core_ambassador_checks`) | Corrections are compensating rows; codes fit payments' registration form (core C5a) |
| `round_entries UNIQUE(user_id, round_id)` | Promotion never duplicates/overwrites |
| `task_assignments UNIQUE(task_id, user_id)` | |
| `promotion_runs UNIQUE(from_round_id, category)`; `rounds` name 2–60, `sort_order` 1–10, `closes_at > opens_at`, criteria 1–20, a video round with its window and criteria; `round_entries` score 0–100, video link ≤ 500 with its time; `promotion_runs` top N 1–25,000, from ≠ to, the source fields (`*_core_rounds_checks`; asserted in `rounds.int-spec.ts`); `promotion_runs` append-only: UPDATE, DELETE and TRUNCATE refused, TRUNCATE allowed only in a database named `*_test`, `sirat_app` without UPDATE or DELETE (`*_core_rounds_append_only`) | One promotion per round and category, and a run is never changed; the rules hold for every writer (core C6a) |
| `certificates UNIQUE(user_id, type, round_id)`, `UNIQUE(serial)`, `UNIQUE(verification_code)`; the type one of three, the serial `^SLO-[0-9]{4}-[0-9]{6,}$` (from `certificate_serial_seq`), the code `^[0-9A-F]{12}$`, the name 1–200, the revoke fields all three or none with a reason 3–200 (`*_core_certificates_checks`; asserted in `certificates.int-spec.ts`) | One certificate per student, type and round; a revoked one keeps who, when and why (core C6c-1) |
| `jury_assignments UNIQUE(round_id, judge_id, category)`; `jury_scores` total 0–100, criteria a JSON object, comment ≤ 1,000, append-only (UPDATE, DELETE and TRUNCATE refused, TRUNCATE allowed only in a database named `*_test`), `sirat_app` without UPDATE or DELETE (`*_core_jury_checks`; asserted in `jury.int-spec.ts`) | A judge per category once; the scoring history is never changed (core C6b) |
| `teams UNIQUE(name)`, `UNIQUE(join_code)` (both CITEXT), `UNIQUE(owner_id)`; `team_members UNIQUE(user_id)`; name 3–60 characters, code `^TM-[0-9A-HJKMNP-TV-Z]{6}$` (`*_core_ambassador_teams_checks`; asserted in `ambassador-teams.int-spec.ts`) | One team per ambassador and per student; a code or a name differs in more than its case (core C5b-3) |
| `admin_tasks` title 3–120, description 1–2,000, points 0–1,000, `archived_at >= created_at`; `task_assignments` proof ≤ 1,000 and note ≤ 500 characters, and the status rules (`*_core_ambassador_tasks_checks`) | The limits hold for every writer; an approved assignment always names its admin and time |
| `ambassador_profiles UNIQUE(user_id)`, `UNIQUE(promo_code)` (CITEXT, case-insensitive) | Promo code uniqueness enforced by DB (old code raced) |
| Foreign keys `ON DELETE RESTRICT` (only `sessions`, `auth_tokens`, `team_members` cascade) | Deleting a row never silently rewrites history |
| CHECKs on enum columns compare `col::text` | Enum-literal CHECKs break Prisma enum migrations (catalog test) |
| Every FK has a covering index | Catalog test |
| `audit_logs` append-only: UPDATE, DELETE and TRUNCATE refused (triggers) | The security trail cannot be rewritten by an app bug or an injected statement |
| `audit_logs (created_at DESC, id DESC)` and `(actor_id, created_at DESC)` indexes (`*_core_audit_index`) | The admin audit viewer pages newest first by keyset and filters by actor without scanning the log |
| Session defaults: `statement_timeout 10s`, `lock_timeout 5s`, `idle_in_transaction_session_timeout 60s` (database level, migration `*_db_session_timeouts`) | No statement outlives the 25 s request timeout; lock waits fail fast; a stuck transaction cannot hold locks or a PgBouncer connection |
| `registrations.payment_id` must reference a `paid` payment of the same user (trigger `registrations_payment_paid`) | A CHECK cannot look at another table |
| `exams CHECK (duration_minutes BETWEEN 1 AND 30)` | **Raw SQL migration** (Prisma cannot express it) |
| `exams CHECK (window_end > window_start)` | Raw SQL |
| `exams CHECK (results_published_at >= window_end + grace)`, grace ≤ 300 s, `published` needs `published_at` | Results can never be published before the window closed for everyone (`*_exam_checks`) |
| Trigger `exams_frozen_after_publish` | A published exam keeps its start, duration, count, grace, category, round and pool rule; the window only grows while open; back to draft only without attempts; an archived exam never changes |
| `questions UNIQUE(lineage_id, version)`, partial UNIQUE `(lineage_id) WHERE is_active`, options 2–6, correct key among the option keys | One row per version, one active version per question |
| Triggers `questions_frozen_after_publish`, `questions_bump_exam_content_version` | Once the exam left draft a question is never rewritten or deleted (only deactivated, replaced by a new version); every question write raises `exams.content_version` |
| Trigger `attempts_guard`, CHECKs on `ends_at` (≤ 30 min after start), score ≤ question count, status ↔ `submitted_at`/`score` | An attempt starts only for a published exam; its timer, layout and count never change; status only moves forward; never deleted |
| `submissions` append-only (trigger); CHECKs on the answers format, `request_id`, events size | UPDATE and DELETE refused; TRUNCATE refused except in a `*_test` database (test cleanup cascades through users) |
| `answer_key_corrections` CHECKs: keys `^[A-Z]$`, `to_key <> from_key`, reason 3–200; trigger `answer_key_corrections_valid` (the question is in that exam, the exam is not a draft, both keys are options of that version); append-only (`answer_key_corrections_append_only`: UPDATE, DELETE and TRUNCATE refused, TRUNCATE allowed only in a `*_test` database; `sirat_app` without UPDATE or DELETE) (`*_exam_key_corrections_checks`; asserted in `exam-key-corrections.int-spec.ts`) | A published question is never rewritten (DON'T 8); a wrong key is fixed by a new row, kept with who, when and why; a revert is another correction (E7b) |
| `payments CHECK (amount_minor > 0)` | Raw SQL |
| `jury_scores`: criteria range validated in service; `total` server-computed | |
| `announcements` CHECKs: title 3–150 and body 1–5,000 characters, `archived_at >= created_at`; partial index `(published_at DESC) WHERE archived_at IS NULL` (`*_core_announcements_checks`) | Raw SQL; the students' list repeats the predicate. Archived, never deleted (core C4) |

## Demo data (exam; DECISIONS 2026-11-08 "Demo data, loaded and removed with one click")

Migrations `20261108120000_demo_data` (tables, columns, indexes) and `20261108120001_demo_data_clear` (CHECKs, triggers, `demo_clear`); phase 2: `20261109100000_demo_task_round_roots` and `20261109100001_demo_task_round_clear` (`demo_clear` v3). Asserted by `apps/api/test/demo-clear.int-spec.ts` and `demo-roots-dto.int-spec.ts`.

| Object | Rule |
|---|---|
| `demo_batches` (status `loading`, `loaded`, `failed`, `clearing`; reason 3–200; `created_by_id` NULL for the CLI; counts) | One batch at a time (unique index on `((true))`) |
| `demo_records (table_name, row_id, batch_id)`, PK `(table_name, row_id)` | Every row a load inserted. `sirat_app` may only SELECT and INSERT (no UPDATE or DELETE; re-asserted by `runtime-role.ts`) |
| `users`, `exams`, `announcements`, and since phase 2 `admin_tasks` and `rounds`, `.demo_batch_id` (the root marker) | Written only by the loader at insert; trigger `demo_marker_immutable` refuses any change. `users_demo_email_check`: the marker is set exactly when the email is on `@demo.sirat.invalid`; `users_demo_role_check`: a demo account is never admin or manager |
| `demo_clear(batch)` SECURITY DEFINER (`search_path = public, pg_temp`), EXECUTE for `sirat_app` only (not PUBLIC) | The only way demo rows go. Locks the batch (`demo_clear_busy` while loading). A root counts only when it is registered AND marked, both. Refuses `demo_clear_blocked: {counts}` and deletes nothing when real rows use demo rows (real attempts on demo exams, demo attempts on real exams, demo accounts on real leaderboards, real accounts or forms referred by a demo ambassador, mixed teams, real entries from a demo promotion, mixed jury scores; since v3 also real assignments or points on a demo task, and real entries, exams, jury assignments or certificates on a demo round). Otherwise deletes children first (demo tasks after their assignments and points, demo rounds after their entries, runs, jury assignments, certificates and exams), also what demo accounts made after the load, under the transaction-local setting `sirat.demo_clear`, then the registry and the batch |
| `demo_run_root` | A promotion run is demo when its source exam is a demo root, when it runs from or into a demo round (v3), or when every entry it made is a demo user's |
| `rounds_sort_order_check` (phase 2) | Real rounds 1–10, demo rounds 101–110: the sides never meet on the unique sort_order, so "the next round" or "max + 1" over real rounds never lands on a demo round |
| `task_assignments_same_side`, `round_entries_same_side` (core, `20261109120000_core_demo_side_triggers`) | BEFORE INSERT or UPDATE of the task/round and the user: a demo task or round takes only demo accounts and a real one only real accounts (`task_side_mismatch`, `round_side_mismatch`, SQLSTATE 23514). The services refuse first; the triggers stop a mix whoever writes it. Asserted by `demo-guards.int-spec.ts` |
| `certificate_serial_seq` MAXVALUE 899999 (phase 2) | Real serials stay below `SLO-YYYY-900000`; demo certificates use `SLO-YYYY-9NNNNN` and never take a number from the sequence |
| The append-only and guard triggers (`attempts_guard`, `submissions_append_only`, `questions_frozen_after_publish`, `answer_key_corrections_append_only`, `point_ledger_append_only`, `jury_scores_append_only`, `promotion_runs_append_only`) | Let a DELETE through only inside `demo_clear` and only for a demo root's rows (for attempts and submissions: a demo account on a demo exam). A forged registry row or the setting alone deletes nothing real |

## Seed data (needed at first boot)

* `grade_levels`: the 17 labels from the old wizard (see `reference/zero-olympiad-ui/app/registration-full/Step2_Auth.jsx`) mapped to categories **Activist / Ambassador / Achiever** (grade bands to confirm with the client; SDG numbers are dropped).
* `settings`: `registration_open=false`, `registration_fee_minor=40000` (400 BDT; also set by the data migration `*_registration_fee_400`, which runs first), `registration_opens_at` and `registration_closes_at` (`null`), `currency=BDT`, `leaderboard_public=false`, `payment_expiry_minutes=60`. Inserted per missing key; values are never overwritten. The submit grace lives only in `exams.grace_seconds`.
* `grade_levels`, `rank_thresholds`, `rounds` are NOT in the seed: they ship as the data migration `*_reference_data_baseline` (each INSERT only while its table is empty), so they run in a fixed order with later data migrations on every database. Later data migrations match rows by natural key (label, sort_order, name), never by id.
* `rank_thresholds`: Bronze 0 / Silver 100 / Gold 250 (placeholders; owner confirms with the client).
* Seed code: `apps/api/prisma/seed.ts` (insert-only, never overwrites admin edits; runs in the compose `migrate` job). Dev-only test users: `apps/api/prisma/fixtures` (see RUNBOOK section 0).
* Rounds: Round 1 (quiz); later rounds when defined.

## Indexes to review with EXPLAIN ANALYZE

Leaderboard query form (index verified): `WHERE exam_id = $1 AND score IS NOT NULL ORDER BY score DESC, time_taken_seconds ASC` (never omit the NULL filter, never add NULLS LAST). `payments(status, created_at)` (reconciliation) · `attempts(exam_id, status)` · `exams(status, window_start)` · `round_entries(round_id, status)` · `point_ledger(user_id, created_at)` · `users(referred_by_id)` · add for leaderboard snapshot build: `(exam_id, score DESC, time_taken_seconds ASC)` on `attempts` · `attempts (ends_at) WHERE status = 'in_progress'` (finalize sweep; queries must repeat that predicate; an enum literal, because index predicates need IMMUTABLE expressions: recreating `AttemptStatus` must drop and recreate it) · `leaderboard_entries (exam_id, generation, rank)`.

## Roles (OPEN-QUESTIONS #27, LAUNCH-PLAN L2 and L8)

| Role | Who uses it | Rights |
|---|---|---|
| The bootstrap superuser (`POSTGRES_USER`, `sirat`) | The migrate job, backup and restore, psql | Owns every object and runs every migration |
| `sirat_app` | The API, the worker, the seed and the CLI, from L8 (today the app still connects as the owner) | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on every table; only `SELECT` and `INSERT` on the append-only tables (those with an `*_append_only` trigger: `audit_logs`, `payment_events`, `point_ledger`, `submissions`); nothing on `_prisma_migrations`; no `TRUNCATE`, DDL, temporary tables, trigger switches, `session_replication_role` or `COPY … TO PROGRAM`. Like every PostgreSQL role it can still change its own session defaults and password, and drop the privileges granted to it (`DROP OWNED`); the migrate job clears its role-level settings on each run |

- **The migration `*_runtime_role`** creates `sirat_app` (NOLOGIN) and its grants, and takes `TEMPORARY` on the database away from PUBLIC. `ALTER DEFAULT PRIVILEGES` gives every table and sequence a later migration creates the same data rights. A later append-only table needs its own `REVOKE UPDATE, DELETE` in its migration: CI checks the migrations' result before `runtime-role.ts` runs, and a local `test:int` (`test/db-runtime-role.int-spec.ts`) finds such tables by their `*_append_only` trigger.
- **`prisma/runtime-role.ts`** runs in the migrate job after `migrate deploy`, on every run:
  - it re-asserts the restrictions a restore can undo (CONNECT for `sirat_app`, no `TEMPORARY` for PUBLIC, nothing on `_prisma_migrations`, no `UPDATE` or `DELETE` on the append-only tables), and adds no other right;
  - it clears every role-level setting of `sirat_app` (role-wide and for this database), whoever set it. So `sirat_app` carries none: per-database values go in `ALTER DATABASE … SET`, per-job values in `SET LOCAL`;
  - it puts back a missing database timeout: statement 10 s, lock 5 s, idle in transaction 60 s (`DATABASE_TIMEOUTS` in the script, the values of migration `20261030165953_db_session_timeouts`). A timeout that is present stays as a migration set it;
  - it sets the login and password from `POSTGRES_APP_PASSWORD`, sending a SCRAM verifier, never the plaintext, on a connection that keeps statement text out of the server log (`QUIET_SESSION`);
  - all steps run in one transaction behind an advisory lock, so two runs at once on one database follow each other;
  - `--ensure` only creates the role, for a restore on a fresh cluster before `pg_restore`.
- **One password per cluster:** roles are cluster-wide. On the cluster marked `sirat.environment=development`, the script sets the password only while the role has none.
- **The boot line** `database role=<name> superuser=<bool>` (API and worker) shows which role is in use. In production it warns while that is a superuser.

## PgBouncer + Prisma

Runtime `DATABASE_URL` → pgbouncer:6432 with `?pgbouncer=true&connection_limit=5`. `DIRECT_URL` → postgres:5432 (migrations only). No session-level features (advisory locks across statements, `LISTEN`) on the runtime connection. Use `SELECT … FOR UPDATE` inside a transaction (works in transaction mode).

Timeouts are database defaults (see the constraints table), so they reach every session, including through PgBouncer. Work that needs longer sets its own value first: a migration starts with `SET statement_timeout = '15min';`, a worker job uses `SET LOCAL statement_timeout = …` inside its transaction.

## Data that does NOT live in Postgres

Exam checkpoints (Redis, TTL = exam end + grace), cached questions (Redis), leaderboard pages (Redis; the snapshot rows themselves are in `leaderboard_entries`, so the server can search them and a Redis flush loses nothing: EXAM-PLAN D8), rate-limit counters (Redis), BullMQ jobs (Redis queue instance).

## Importing old Zero Olympiad users (only if the owner decides)

Supabase password hashes can be exported and verified once on first login, then re-hashed with argon2id (store only the new hash). Validate with a small export first. Schema reference for the old DB is in `reference/zero-olympiad-ui/FEATURES.md` §2; take a schema-only dump of the live Supabase DB first (two DB functions exist only there).

## Verification note

Done in A1 (2026-10-30): `prisma/migrations/*_init` (generated, plus a hand-added `CREATE EXTENSION citext`) and `*_db_checks` (hand-written CHECKs). CI fails if `schema.prisma` and the migrations drift (`prisma migrate diff --exit-code`). Prisma ignores CHECK constraints and extensions when diffing, so they are never dropped by later migrations.

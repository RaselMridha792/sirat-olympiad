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
| Exams | `exams`, `questions`, `attempts`, `submissions`, `leaderboard_entries` | `attempts` UNIQUE(user, exam); `submissions` idempotent and append-only; `questions` = one row per version; `leaderboard_entries` = the results snapshot (EXAM-PLAN D8) |
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
| `payments` one active (`initiated`/`pending`) payment per attempt (partial unique index) | "Try again" never runs two checkouts at once |
| `pending_registrations` one `open` attempt per email and per phone (partial unique indexes) | No double charge from two browsers (owner, DECISIONS "No refund handling") |
| `users UNIQUE(phone)` (NULL allowed) and `phone ~ '^01[3-9][0-9]{8}$'` on `users` and `pending_registrations` | One phone number, one student, in one stored form (owner) |
| `payments` status transitions follow the state machine; a new row is `initiated`; `refunded` is never entered (trigger) | A stale answer never downgrades `paid`; no refund handling (owner) |
| `payments` CHECKs: whole taka, `currency = 'BDT'`, paid ⇒ `paid_amount_minor = amount_minor`, invoice `^[A-Z0-9]{10,20}$`, `trx_id <> ''`, account label format | Raw SQL (`*_payments_checks`) |
| `pending_registrations` CHECK: `completed` ⇔ `user_id` and `completed_at` set | Raw SQL |
| `payment_events` append-only (UPDATE, DELETE, TRUNCATE refused); `payment_id` deliberately not a FK, like `audit_logs.actor_id` | The gateway log keeps unknown invoices and is never blocked by payment rows |
| `settings` CHECK: `registration_fee_minor` is a positive whole-taka number | Raw SQL; the fee is 40000 (owner) |
| Partial-index predicates compare enum literals (Postgres needs IMMUTABLE there; `::text` is only STABLE) | A migration that recreates `PaymentStatus` or `RegistrationAttemptStatus` must drop and recreate those three indexes |
| `point_ledger UNIQUE(event_key)` | Points never awarded twice |
| `point_ledger` append-only: UPDATE, DELETE and TRUNCATE refused (TRUNCATE allowed only in a `*_test` database); `ambassador_profiles` promo code `^[A-Za-z0-9_-]{3,40}$` (`*_core_ambassador_checks`) | Corrections are compensating rows; codes fit payments' registration form (core C5a) |
| `round_entries UNIQUE(user_id, round_id)` | Promotion never duplicates/overwrites |
| `task_assignments UNIQUE(task_id, user_id)` | |
| `ambassador_profiles UNIQUE(user_id)`, `UNIQUE(promo_code)` (CITEXT, case-insensitive) | Promo code uniqueness enforced by DB (old code raced) |
| Foreign keys `ON DELETE RESTRICT` (only `sessions`, `auth_tokens`, `team_members` cascade) | Deleting a row never silently rewrites history |
| CHECKs on enum columns compare `col::text` | Enum-literal CHECKs break Prisma enum migrations (catalog test) |
| Every FK has a covering index | Catalog test |
| `audit_logs` append-only: UPDATE, DELETE and TRUNCATE refused (triggers) | The security trail cannot be rewritten by an app bug or an injected statement |
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
| `payments CHECK (amount_minor > 0)` | Raw SQL |
| `jury_scores`: criteria range validated in service; `total` server-computed | |
| `announcements` CHECKs: title 3–150 and body 1–5,000 characters, `archived_at >= created_at`; partial index `(published_at DESC) WHERE archived_at IS NULL` (`*_core_announcements_checks`) | Raw SQL; the students' list repeats the predicate. Archived, never deleted (core C4) |

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

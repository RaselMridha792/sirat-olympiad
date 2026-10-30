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
| Payments | `payments`, `pending_registrations`, `registrations` | One paid payment ↔ one registration |
| Exams | `exams`, `questions`, `attempts`, `submissions` | `attempts` UNIQUE(user, exam); `submissions` idempotent |
| Rounds | `rounds`, `round_entries`, `jury_scores`, `certificates` | Data-driven rounds; append-only jury history |
| Ambassadors | `ambassador_profiles`, `point_ledger`, `teams`, `team_members`, `admin_tasks`, `task_assignments` | Ledger append-only |
| Content | `announcements` | |

## Constraints that MUST exist (asserted by `apps/api/test/db-constraints.int-spec.ts`)

| Constraint | Why |
|---|---|
| `attempts UNIQUE(user_id, exam_id)` | One attempt per student; timer cannot be reset |
| `submissions UNIQUE(attempt_id)`, `UNIQUE(request_id)` | Idempotent final submit |
| `payments UNIQUE(invoice_number)`, `UNIQUE(trx_id)` | No reused invoice; no double-applied transaction |
| `registrations UNIQUE(user_id)`, `UNIQUE(payment_id)` | One payment ↔ one registration |
| `pending_registrations UNIQUE(payment_id)` | Form data tied to one payment |
| `point_ledger UNIQUE(event_key)` | Points never awarded twice |
| `round_entries UNIQUE(user_id, round_id)` | Promotion never duplicates/overwrites |
| `task_assignments UNIQUE(task_id, user_id)` | |
| `ambassador_profiles UNIQUE(user_id)`, `UNIQUE(promo_code)` (CITEXT, case-insensitive) | Promo code uniqueness enforced by DB (old code raced) |
| Foreign keys `ON DELETE RESTRICT` (only `sessions`, `auth_tokens`, `team_members` cascade) | Deleting a row never silently rewrites history |
| CHECKs on enum columns compare `col::text` | Enum-literal CHECKs break Prisma enum migrations (catalog test) |
| Every FK has a covering index | Catalog test |
| `registrations.payment_id` must reference a `paid` payment (trigger) | **Phase C**; a CHECK cannot look at another table |
| `exams CHECK (duration_minutes BETWEEN 1 AND 30)` | **Raw SQL migration** (Prisma cannot express it) |
| `exams CHECK (window_end > window_start)` | Raw SQL |
| `payments CHECK (amount_minor > 0)` | Raw SQL |
| `jury_scores`: criteria range validated in service; `total` server-computed | |

## Seed data (needed at first boot)

* `grade_levels`: the 17 labels from the old wizard (see `reference/zero-olympiad-ui/app/registration-full/Step2_Auth.jsx`) mapped to categories **Activist / Ambassador / Achiever** (grade bands to confirm with the client; SDG numbers are dropped).
* `settings`: `registration_open=false`, `registration_fee_minor` (placeholder 0), `currency=BDT`, `leaderboard_public=false`, `payment_expiry_minutes=60`. Inserted per missing key; values are never overwritten. The submit grace lives only in `exams.grace_seconds`.
* `grade_levels`, `rank_thresholds`, `rounds` are NOT in the seed: they ship as the data migration `*_reference_data_baseline` (each INSERT only while its table is empty), so they run in a fixed order with later data migrations on every database. Later data migrations match rows by natural key (label, sort_order, name), never by id.
* `rank_thresholds`: Bronze 0 / Silver 100 / Gold 250 (placeholders; owner confirms with the client).
* Seed code: `apps/api/prisma/seed.ts` (insert-only, never overwrites admin edits; runs in the compose `migrate` job). Dev-only test users: `apps/api/prisma/fixtures` (see RUNBOOK section 0).
* Rounds: Round 1 (quiz); later rounds when defined.

## Indexes to review with EXPLAIN ANALYZE

Leaderboard query form (index verified): `WHERE exam_id = $1 AND score IS NOT NULL ORDER BY score DESC, time_taken_seconds ASC` (never omit the NULL filter, never add NULLS LAST). `payments(status, created_at)` (reconciliation) · `attempts(exam_id, status)` · `exams(status, window_start)` · `round_entries(round_id, status)` · `point_ledger(user_id, created_at)` · `users(referred_by_id)` · add for leaderboard snapshot build: `(exam_id, score DESC, time_taken_seconds ASC)` on `attempts`.

## PgBouncer + Prisma

Runtime `DATABASE_URL` → pgbouncer:6432 with `?pgbouncer=true&connection_limit=5`. `DIRECT_URL` → postgres:5432 (migrations only). No session-level features (advisory locks across statements, `LISTEN`) on the runtime connection. Use `SELECT … FOR UPDATE` inside a transaction (works in transaction mode).

## Data that does NOT live in Postgres

Exam checkpoints (Redis, TTL = exam end + grace), cached questions (Redis), leaderboard snapshot (Redis/CDN), rate-limit counters (Redis), BullMQ jobs (Redis queue instance).

## Importing old Zero Olympiad users (only if the owner decides)

Supabase password hashes can be exported and verified once on first login, then re-hashed with argon2id (store only the new hash). Validate with a small export first. Schema reference for the old DB is in `reference/zero-olympiad-ui/FEATURES.md` §2; take a schema-only dump of the live Supabase DB first (two DB functions exist only there).

## Verification note

Done in A1 (2026-10-30): `prisma/migrations/*_init` (generated, plus a hand-added `CREATE EXTENSION citext`) and `*_db_checks` (hand-written CHECKs). CI fails if `schema.prisma` and the migrations drift (`prisma migrate diff --exit-code`). Prisma ignores CHECK constraints and extensions when diffing, so they are never dropped by later migrations.

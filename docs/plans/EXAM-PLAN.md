# Exam engine, exam admin and results: plan

Plan only, no product code (2026-10-31, branch `feat/exam-plan`, worktree `G:\sirat-exam`). Revised the same day after the lead's review (old rows in `*_test` databases, 2.3; no refunds, D3; the same questions for everyone, Q2) and after the owner's answers (section 9; Q4 brings rule-violation warnings and an automatic submit, 3.15). It reaches `main` in a docs-only pull request; Rasel merges it. Code starts only after that, on new branches from `main` (section 8).

**Priority:** the 15 November launch (registration + payment, A2's login) comes first. The exam pull requests may be reviewed and merged after it. This work never touches the A2, payments or lead worktrees or branches.

Sources: RULEBOOK §7, §7.1, §9, §13, §18; `02-SYSTEM-DESIGN.md`; `03-HOW-IT-WORKS.md` §3–4; `04-FEATURES.md` (S5–S9, S11, M1, M3, M4, M6); `05-DATABASE.md`; `06-API.md`; `07-UI-MIGRATION.md` (exam player, quiz management, leaderboard rows); `10-BUILD-PLAN.md`; DECISIONS (A1, A1-review #6, UI port, A2); OPEN-QUESTIONS #3–#10; `plans/PAYMENTS-PLAN.md` (format, shared-environment rules).

From `reference/` only the look and the business rules are taken (`QuizForm`, `QuizQuestion`, `NextButton`, `StartModal`, `TimeUpModal`, `FinalSubmitModal`, `admin/quiz-management/*`). No code is copied: the old exam sent the questions with their answers to the browser, took `user_id`, `time_taken` and the category from the request body, and ran the timer in the browser.

The owner answered all five questions on 2026-10-31 (section 9; DECISIONS "Exam rules (owner)"). Everything else uses the defaults listed there; the owner can override any of them at review.

## 0. Scope and dependencies

**In scope:**
- Exam engine: start, server timer, local save, Redis checkpoints, final submit, grace, server-side finalize, scoring.
- Admin: exams and questions (create, edit, versions), publish, lock, results publish.
- Results: leaderboard snapshot, review page, student and admin leaderboard API.
- UI: exam player (waiting room, rules, player, time-up, receipt), admin create/edit/publish, and the existing exam and leaderboard pages on the real API.
- k6 exam simulation: locally now, the real numbers on the VPS.

**Out of scope:** rounds, promotion, jury and certificates (later in the Phase A order); CSV import and answer-key correction with re-scoring (P1, PR E7); the public marketing leaderboard (Phase D); proctoring beyond the browser-side rule-violation warnings (3.15); admin 2FA (A2).

**Dependencies:**
- **Payments PR 1** (target 1 November) changes `schema.prisma` and adds migrations first. This work's migrations always come after theirs (section 7). The access check (paid registration) is written only after PR 1 merges, and it only reads `registrations` and `payments`.
- **A2's web session (PR #12)**: the player uses its browser API client (`lib/api.ts`, refresh after a 401) and the server helper (`lib/server-api.ts`). #12 merged on 2026-10-31, so the UI pull requests (E4, E5) are no longer blocked by it.
- **A2's per-user limit PR**: the exam routes use its per-user keys. If it is not merged by E2, the checkpoint keeps its own per-attempt minimum interval (section 3.4), which needs no shared file.
- **Owner answers** Q1–Q5: answered on 2026-10-31 (section 9, DECISIONS). Q4 changed the plan: rule-violation warnings and an automatic submit (3.15).
- **VPS** (OPEN-QUESTIONS #22): the real k6 numbers. The client's exam content, dates and the expected peak (OPEN-QUESTIONS #24).
- **No exam date is set yet.** The first real exam still needs RULEBOOK §13's pre-exam checklist: k6 at 1.5–2× peak on the VPS, a restore drill, a 48-hour code freeze.

## 1. API contract (added to `06-API.md` in the pull request that builds it)

Guards as built in A2: the global `AuthGuard` (deny by default), `@Roles(...)`, the CSRF header check on every non-GET. `Owner` is a check in the service: the acting user comes only from the session cookie, never from the body, query or URL. A row of another user answers **404**, not 403, so ids cannot be probed. Every body is a DTO with `whitelist` + `forbidNonWhitelisted`, so `score`, `userId`, `startedAt`, `timeTaken`, `role` or `status` in a body are 400.

**No new public route and no CSRF exemption.** The route inventory test (`app-routes.int-spec.ts`) needs no new allow-list entry.

### 1.1 Student

Roles: `student`, `ambassador` (an ambassador is a student with an extra panel). Admins, managers and jury cannot start an exam.

| Method + path | Ownership and checks | Answer | PR |
|---|---|---|---|
| `GET /exams` | Exams the session user may see: `published`, category `null` or equal to the user's | `StudentExamCard[]`, the state from the server clock (section 3.11), `resultsPublished`. Never questions | E2 |
| `GET /exams/:id` | Same visibility; otherwise 404 | Card + rules (`durationMinutes`, `questionsPerAttempt`, `graceSeconds`, `violationWarnings` = 5) + `serverNow` + the user's attempt summary (status, `endsAt`, receipt). Never questions | E2 |
| `POST /exams/:id/attempts` | Start or resume. Body `{}`. Email verified (lazy verification, DECISIONS 2026-10-30), paid registration (after payments PR 1; D3), not blocked, category match, `published`, window open | 201 new / 200 existing: `AttemptView` (1.3). 403 `email_unverified` · 403 `registration_required` · 404 not visible · 409 `not_open_yet` · 409 `window_closed` · 409 `already_submitted` (with the receipt) | E2 |
| `GET /attempts/me?exam=:id` | The session user's attempt for that exam (`WHERE user_id = sub`) | `AttemptView` in progress; receipt only once submitted; 404 when none | E2 |
| `PUT /attempts/:id/checkpoint` | Owner. Body `{ seq, answers, violationCount, events }` | Redis only. 200 `{ savedSeq, violationCount, remainingSeconds, serverNow }` (the server's count never goes down, 3.15) · 409 `time_over` · 409 `already_submitted` · 429 + `Retry-After` below the minimum interval | E2 |
| `POST /attempts/:id/submit` | Owner. Body `{ requestId (uuid), answers, endReason, violationCount, events }`; `endReason` is `submitted`, `time_up` or `violations` (the last only with more than 5 violations) | Idempotent. 200 `{ receiptId, submittedAt, endReason, alreadySubmitted }` · 409 `time_over` · 409 `request_id_conflict` (the id belongs to another attempt) | E2 |
| `GET /attempts/:id/review` | Owner. 403 `results_not_published` until the exam's results are published (the database refuses that before `window_end + grace`, 2.2) | The attempt's questions in its order: the student's choice, the correct option, the explanation; own score, rank, server time taken | E3 |
| `GET /leaderboard?exam=&round=&category=&page=&q=` | Auth (any role). `round` + `category` resolve to one exam on the server; `category` defaults to the user's | `LeaderboardView`: `unpublished`, or the published snapshot (rank, name, institution; no scores, Q5). Server paging, search by name/institution | E3 |

### 1.2 Admin

All rows: `@Roles('admin')` unless noted, every write audit-logged (`exam.*`, `question.*`, `results.*` with old and new values and the admin id). Writes on an exam carry `expectedUpdatedAt`; a mismatch answers **409** ("changed by someone else, reload"), as payments does for settings.

| Method + path | Rules | PR |
|---|---|---|
| `GET /admin/exams?page=&q=&status=` | `AdminExamCard` (paged) | E1 |
| `POST /admin/exams` | Creates a `draft`. Fields: title, category (or all), round, window start/end, duration (1–30), questions per attempt, grace seconds (form pre-filled from `SUBMIT_GRACE_SECONDS_DEFAULT`), `randomDraw` (default false, Q2). No violation switch: the rule is on for every exam (Q4). The window must be at least one duration long | E1 |
| `GET /admin/exams/:id` | `AdminExamDetail`: active questions **with** correct keys and explanations, version numbers. Admin only, never manager | E1 |
| `PATCH /admin/exams/:id` | Draft: every config field. Published: only `title`, and `windowEnd` extended (never shortened, only before the window has ended; reason required) | E1 |
| `POST /admin/exams/:id/publish` | Checks in 4.2; then the questions are warmed into Redis (E2 adds the warm-up job) | E1 |
| `POST /admin/exams/:id/unpublish` | Only while `now < window_start − 5 min` and no attempt exists | E1 |
| `POST /admin/exams/:id/archive` | A draft, or a published exam whose results are published | E1 |
| `POST /admin/exams/:id/questions` | Adds a question: draft; published only with `random_draw`; never archived | E1 |
| `PUT /admin/exams/:id/questions/:questionId` | Draft: edit in place. Published: a **new version** (new row, same lineage, version + 1); the old one is deactivated; returns the new id | E1 |
| `DELETE /admin/exams/:id/questions/:questionId` | Draft: delete. Published: **retire** (`is_active = false`); never a delete | E1 |
| `GET /admin/exams/:id/questions/:questionId/versions` | Version history of the question's lineage | E1 |
| `GET /admin/exams/:id/results` | Attempts by status, scored count, snapshot generation and time, published or not | E3 |
| `POST /admin/exams/:id/results/build` | Rebuilds the snapshot; only after the window closed for everyone and every attempt is final | E3 |
| `POST /admin/exams/:id/results/publish`, `/unpublish` | Publishing sets `results_published_at`; the database refuses it before `window_end + grace` | E3 |
| `GET /admin/leaderboard?exam=&round=&category=&page=&q=` | `@Roles('admin', 'manager')`: the snapshot with email, score and time, also before it is published | E3 |
| `GET /admin/exams/:id/attempts?page=&status=&endReason=&minViolations=` | Each student's attempt: status, times, end reason, violation count, score; never answers (owner, Q4) | E3 |
| `GET /admin/exams/:id/attempts/:attemptId` | One attempt's violation and connection events with times (`events` of the submission, or the live checkpoint while in progress) | E3 |

Admin exam routes live in controllers inside `ExamsModule` and `LeaderboardModule` (`/admin/...` paths), so `admin.module.ts` and `app.module.ts` do not change (D10).

### 1.3 Shapes (in `@sirat/shared`)

A new file `packages/shared/src/exam.ts` (one export line in `index.ts`) holds the player and admin shapes, so `dashboard.ts` changes only where existing types change:

```ts
/** Student view of an attempt. No question ids, no option keys, no correct answers. */
interface AttemptView {
  attemptId: string;
  examId: string;
  title: string;
  status: 'in_progress' | 'submitted';
  serverNow: string; // ISO; the client keeps an offset, never its own clock
  endsAt: string;
  remainingSeconds: number;
  graceSeconds: number;
  questions: Array<{ text: string; options: string[] }>; // in this attempt's order
  answers: Array<number | null> | null; // option positions from the last checkpoint
  savedSeq: number | null;
  violationCount: number; // the server's count (3.15): a reload or another device never starts again from 0
  violationWarnings: number; // EXAM_VIOLATION_WARNINGS (5): the next violation ends the exam
  receipt: { receiptId: string; submittedAt: string; endReason: EndReason } | null;
}
type AnswerList = Array<number | null>; // index = question position, value = option position
type EndReason = 'submitted' | 'time_up' | 'violations' | 'server_checkpoint' | 'server_empty';
interface CheckpointBody { seq: number; answers: AnswerList; violationCount: number; events: ExamEvent[] }
interface SubmitBody {
  requestId: string;
  answers: AnswerList;
  endReason: 'submitted' | 'time_up' | 'violations';
  violationCount: number;
  events: ExamEvent[];
}
/** Seconds since start. `leave` (tab or app switch) and `devtools` are violations; the rest are only logged. */
interface ExamEvent { type: 'leave' | 'return' | 'devtools' | 'offline' | 'online' | 'resume'; at: number }
```

`EXAM_VIOLATION_WARNINGS = 5` is one constant in `@sirat/shared`, used by the API, the player and the rules text. If Rasel wants the 5th violation to end the exam, only this constant changes (to 4).

Changes to existing types (`dashboard.ts`): `StudentExamCard` gains `resultsPublished`; `LeaderboardQuery` gains `examId` and `category`; `AdminExamCard.locked` becomes "published" (versions only); `AdminLeaderboardView.isPublic` means the exam's results are published (D7).

## 2. Schema changes and migrations

### 2.1 What exists today

| Table | Today |
|---|---|
| `exams` | `title`, `category` NULL, `round_id` NULL, `window_start`, `window_end`, `duration_minutes`, `questions_per_attempt`, `grace_seconds` (default 30), `status` (`draft/published/archived`), `results_published_at`. CHECKs: duration 1–30, `window_end > window_start`, questions > 0, grace ≥ 0. Index `(status, window_start)` |
| `questions` | `exam_id`, `text`, `options` (jsonb `[{key, text}]`), `correct_key`, `explanation`, `version` (default 1), `is_active`. Index `(exam_id, is_active)` |
| `attempts` | `user_id`, `exam_id`, `started_at`, `ends_at`, `status` (`in_progress/submitted/expired/scored`), `layout` jsonb, `submitted_at`, `time_taken_seconds`, `score`. UNIQUE `(user_id, exam_id)`; indexes `(exam_id, status)`, `(exam_id, score DESC, time_taken_seconds ASC)` |
| `submissions` | `attempt_id` UNIQUE, `request_id` UNIQUE, `answers` jsonb, `events` jsonb NULL, `created_at` only |

No enum changes: `ExamStatus` and `AttemptStatus` stay as they are.

### 2.2 Changes

**`exams`**
- add `content_version int NOT NULL DEFAULT 1`: raised by every question write (trigger), so caches and attempts know which pool they used;
- add `random_draw boolean NOT NULL DEFAULT false` (Q2): false = everyone gets the same questions (pool = questions per attempt); true = the admin chose different questions per student from a larger pool;
- add `published_at` NULL, `results_snapshot_at` NULL, `results_generation int NOT NULL DEFAULT 0`;
- CHECKs: `grace_seconds <= 300`; `status::text = 'draft' OR published_at IS NOT NULL`; `results_published_at IS NULL OR results_published_at >= window_end + grace_seconds * interval '1 second'` (**the database itself refuses results before the window has closed for everyone**);
- trigger `exams_frozen_after_publish` (2.4).

**`questions`** (one row = one version; content never changes once its exam has left `draft`)
- add `lineage_id uuid NOT NULL` (the first version's own id), `position int NOT NULL` (admin order), `keep_option_order boolean NOT NULL DEFAULT false` (for "all of the above"), `deactivated_at` NULL;
- UNIQUE `(lineage_id, version)`; partial UNIQUE `(lineage_id) WHERE is_active` (one active version per question); index `(lineage_id)` is covered by the unique;
- CHECKs: `version >= 1`; `is_active = (deactivated_at IS NULL)`; `jsonb_typeof(options) = 'array'` with 2–6 entries; the correct key is one of the option keys (`options @> jsonb_build_array(jsonb_build_object('key', correct_key))`); text 1–2,000 characters, explanation ≤ 4,000;
- triggers `questions_frozen_after_publish` and `questions_bump_exam_content_version` (2.4).

**`attempts`**
- add `question_count int NOT NULL` (N, fixed at start), `content_version int NOT NULL`, `scored_at` NULL;
- `layout` format v1: `{ "v": 1, "q": [questionId…], "o": [[2,0,3,1], …] }`: drawn question versions in order and, per question, the display order as indexes into its `options` array;
- partial index `(ends_at) WHERE status = 'in_progress'` (the finalize sweep);
- CHECKs: `ends_at > started_at`; `ends_at <= started_at + interval '30 minutes'`; `time_taken_seconds BETWEEN 0 AND 1800`; `score BETWEEN 0 AND question_count`; `(status::text = 'in_progress') = (submitted_at IS NULL)`; `(status::text = 'scored') = (score IS NOT NULL)`;
- trigger `attempts_guard` (2.4).

**`submissions`**
- add `end_reason` (new enum `EndReason`: `submitted`, `time_up`, `violations`, `server_checkpoint`, `server_empty`), no default: why the exam ended (Q4: an exam ended by violations says so);
- add `violation_count int NOT NULL` (CHECK `>= 0`): the final count (3.15); `events` holds the violation and connection events with their times, for the admin;
- `answers` format v1: `{ "v": 1, "a": [2, null, 0, …] }`;
- CHECKs: `jsonb_typeof(answers->'a') = 'array'`; `request_id ~ '^[A-Za-z0-9._-]{8,80}$'`; `events` at most 16 KB;
- **append-only**: UPDATE and DELETE refused; TRUNCATE refused too, except in a database whose name ends in `_test` (the trigger deferred to "the exam engine module" in the A1 review). Why the exception: `truncateAll` in the integration tests runs `TRUNCATE … CASCADE` on `users`, which reaches `attempts` and `submissions`. Unlike `audit_logs`, which has no foreign keys and is simply skipped, `submissions` cannot be left out, so a strict trigger would break every session's `test:int` once a submission exists. A production database is never named `*_test` (`prepare-test-db.mjs` uses the same rule).

**New `leaderboard_entries`** (the results snapshot, D8)
- `exam_id` (FK RESTRICT), `generation`, `position` (1…n, unique order), `rank` (shared on ties), `user_id` (FK RESTRICT, indexed), `attempt_id` (FK RESTRICT, indexed), `name`, `institution`, `category`, `score`, `time_taken_seconds`, `created_at`;
- PK `(exam_id, generation, position)`; index `(exam_id, generation, rank)`;
- derived data: the build job writes it in one statement; older generations stay (small, and show what was published).

`User` gets one back-relation line (`leaderboardEntries`). `packages/shared/src/records.ts` mirrors only the new fields the dashboards read (`schema-sync.test.ts` checks mirrored fields only).

### 2.3 Migrations

| # | Name | Kind | Content |
|---|---|---|---|
| EX1 | `<ts>_exam_engine` | generated by Prisma, plus a hand-added first statement | The columns, enums, indexes and table above. The first statement is a guard: it stops with a clear message if `questions`, `attempts` or `submissions` has any row (pre-launch: no product code has written them, and `lineage_id`, `position`, `question_count`, `end_reason` have no meaningful backfill) |
| EX2 | `<ts>_exam_checks` | hand-written SQL, kept apart so regenerating EX1 never loses it | Every CHECK, partial index and trigger in 2.2 and 2.4. Enum CHECKs compare `::text` |

- Both come **after** payments' migrations. If payments merges while E1 is open, E1 runs `git merge origin/main`, deletes its own unmerged EX1, regenerates it on a fresh `sirat_exam` (`prisma migrate dev --create-only`), puts the guard back as its first statement, renames EX2 to a later timestamp and commits that as a new commit. A migration on `main` is never edited; the CI drift check must stay green.
- Integration tests use exam windows a few seconds long where a test needs a closed window. No test disables a trigger.

**Old rows in `*_test` databases (lead review, 2026-10-31).** Main's `db-constraints.int-spec.ts` creates exams, attempts and submissions (with `answers: {}`), and `truncateAll` runs only at the start of a suite. So every existing test database (A2's `sirat_test`, payments' `sirat_pay_test`, CI's) still holds exam rows: EX1's guard would stop, and EX2's CHECKs would fail on them. After E1 merged, every session's `test:int` would stop at `prepare-test-db.mjs`.
- Payments solved the same problem for its own migration in `prepare-test-db.mjs` (their PR 1, not merged yet).
- E1 extends **that** mechanism to the exam tables after `git merge origin/main` (no second path): on a `*_test` database only, the exam tables are emptied before `migrate deploy`, so EX1 and EX2 meet empty tables.
- Test: a scratch `*_test` database is brought to the state before EX1 (the earlier migration files applied in order) and given main's old exam rows; then `prepare-test-db.mjs` runs, and EX1 and EX2 must apply.
- **Dev databases need nothing:** main's dev fixtures create users, payments and registrations, never an exam, question or attempt.
- **Production:** no exam row exists before E1, so the guard passes. If one ever exists, the guard stops the deploy with a clear message before any change; never a silent backfill.

### 2.4 Triggers

| Trigger | Refuses |
|---|---|
| `exams_frozen_after_publish` | Once `status` is not `draft`: any change to `window_start`, `duration_minutes`, `questions_per_attempt`, `grace_seconds`, `category`, `round_id`, `random_draw`; `window_end` shortened, or changed after it has passed; `published → draft` while an attempt exists; any status change out of `archived` |
| `questions_frozen_after_publish` | When the exam is not `draft`: DELETE; UPDATE of anything except `is_active` true → false with `deactivated_at`. INSERT into an `archived` exam |
| `questions_bump_exam_content_version` | Nothing; raises `exams.content_version` after every question INSERT or UPDATE |
| `attempts_guard` | INSERT unless the exam is `published` and the status is `in_progress`; UPDATE of `user_id`, `exam_id`, `started_at`, `ends_at`, `layout`, `question_count`, `content_version` (**the timer can never be reset**); status moves other than `in_progress → submitted/expired`, `submitted/expired → scored`, `scored → scored` (re-score); DELETE |
| `submissions_append_only` | UPDATE, DELETE; TRUNCATE except in a `*_test` database (2.2) |

### 2.5 Not in Postgres (cache Redis)

| Key | Content | Lifetime |
|---|---|---|
| `exam:cfg:{examId}` | Status, window, duration, N, grace, category, round, `random_draw`, `content_version` | 60 s; deleted after every admin write |
| `exam:pool:{examId}:{cv}` | Active question ids of that content version | 3 days |
| `qv:{questionId}` | One version's text and options (keys and texts), `keep_option_order`. **Never the correct key or the explanation** | 3 days; deleted when a draft question is edited |
| `att:{attemptId}` | `userId`, `examId`, `endsAt`, `graceSeconds`, N, status | until `ends_at + grace + 2 h` |
| `ckpt:{attemptId}` | `seq`, answers, violation count (never lowered), events, saved time | same |
| `lb:{examId}:{gen}:{page}` | One rendered leaderboard page | 1 h; a new generation uses new keys |

The worker reads correct keys from Postgres only. A bug that dumps the API cache can therefore never leak an answer.

## 3. The exam flow

### 3.1 One clock

All containers share the VPS clock (chrony, RULEBOOK §11). Time decisions inside a transaction use the database's `now()`; the checkpoint (Redis only) uses the API's `Date.now()`, which reads the same clock. The client never decides time: every response carries `serverNow` and `remainingSeconds`; the client keeps an offset and `Countdown` only displays. Locally, Docker Desktop's VM clock can drift from Windows' clock, so boundary tests read the database clock.

### 3.2 Before the window: waiting room

`/dashboard/exam/[id]` shows the exam card, the rules from its config and a countdown to `window_start`, computed from `serverNow`. Logging in early is fine. The Start button turns on at `window_start`. The questions are already in Redis: warm-up at publish, again at `window_start − 10 min` (delayed job), and on demand with a single-flight lock (`SET NX`, others wait up to 300 ms, then read the database) so a cold cache cannot cause a stampede.

### 3.3 Start: `POST /exams/:id/attempts`

1. An existing attempt of this user for this exam → resume (3.6). One indexed read.
2. Checks: the user row (verified, not blocked, category; one primary-key read), paid registration (one read, after payments PR 1), exam config from Redis.
3. Draw the layout in the API (`crypto.randomInt`, Fisher–Yates) from `exam:pool:{id}:{cv}`:
   - default (`random_draw = false`, Q2): the pool holds exactly N questions; every student gets all of them, in a random order;
   - only if the admin chose `random_draw = true`: N questions at random from the larger pool;
   - per question a random option order, unless `keep_option_order`.
4. One statement, the database's clock, no lock on the exam row:

```sql
INSERT INTO attempts (id, user_id, exam_id, started_at, ends_at, status, layout, question_count, content_version, created_at, updated_at)
SELECT $1, $2, e.id, now(), LEAST(now() + make_interval(mins => e.duration_minutes), e.window_end),
       'in_progress', $3, $4, e.content_version, now(), now()
FROM exams e
WHERE e.id = $5 AND e.status = 'published' AND now() >= e.window_start AND now() < e.window_end
  AND e.content_version = $6
ON CONFLICT (user_id, exam_id) DO NOTHING
RETURNING id, started_at, ends_at;
```

   - A row → `ends_at = min(start + duration, window_end)`: a student who starts late gets less time (Q3).
   - No row → re-read: an attempt appeared (a double click or a second tab) → resume it; the content version moved (an admin saved a question) → draw again once; otherwise `not_open_yet` / `window_closed`.
5. Cache `att:{id}`. Answer `AttemptView`: question texts and option texts in this attempt's order. **No question ids, no option keys, no correct key, no explanation.** Answers are option positions, so the client cannot see that, for example, an admin tends to enter the right answer as "A".

Cost per student: two or three indexed reads and one insert (02-SYSTEM-DESIGN §3).

### 3.4 During the exam: local save and checkpoints

- **Every answer change** is saved at once in the browser (`localStorage`, key `sirat.exam.v1.<attemptId>`: `seq`, answers, violation count, events, a pending submit). Nothing is sent per answer.
- **Checkpoint** every 60–120 s (random, so students do not line up), and also on `online`, on `visibilitychange` → hidden (`fetch` with `keepalive`, which keeps the CSRF header), **as soon as the minimum interval allows after a violation** (3.15), and **once more 30–60 s before time-up**, so the server's copy is fresh if the final submit never arrives.
- **Server:** `att:{id}` from Redis (on a miss, one primary-key read, then re-cached). Owner check; refused after `ends_at + grace` or once submitted. Answers validated: exactly N entries, each `null` or `0 … options − 1`; events capped at 300. Then one Lua script on `ckpt:{id}`:
  - the answers are stored only if `seq` is newer, and a write below the minimum interval (`EXAM_CHECKPOINT_MIN_INTERVAL_SECONDS`, 20) answers 429;
  - the violation count becomes the highest of the stored count, the sent count and the number of violation events, **also on a 429**, so a violation is never lost on the server and the count never goes down.

  **No database read or write** on a warm cache.
- The answer carries `remainingSeconds` and `serverNow`; the client re-syncs its timer.

### 3.5 Disconnect

The timer keeps running on the server (RULEBOOK 7.1). The client keeps answering offline, keeps everything in `localStorage`, shows the connection state (online / saving / saved / offline, retrying) and retries with backoff (2, 4, 8 … 30 s) when the network returns.

### 3.6 Refresh, crash or another device

`GET /attempts/me?exam=` returns the same questions in the same order (from `layout` and the immutable `qv:` versions, even if an admin has since replaced a question), the remaining time, the checkpoint answers and the server's violation count. The client merges: the higher `seq` wins for the answers, and the **higher violation count** wins (`localStorage` or server), so a reload or another device never starts the count again from 0. On another device only the server copy exists, so at most the last 2 minutes of answers are lost. Two open devices are allowed (a dead phone, then a laptop); each resume adds a `resume` event, which the admin sees (D5). A resume whose count is already over 5 submits at once (3.15).

### 3.7 Time-up and auto-submit

When the local countdown reaches 0, the player locks the answers, shows the time-up dialog ("Time is up. Saving your answers…") and, after a random 0–20 s delay (spike control), submits the **current** answers. A test proves it sends the real answers, not an empty set (section 6). There is no "Quit" button: the submission is automatic.

### 3.8 Final submit and grace: `POST /attempts/:id/submit`

One transaction:
1. `SELECT … FROM attempts JOIN exams … WHERE attempts.id = $1 FOR UPDATE OF attempts` (a lock on one attempt row only); not the session user's → 404.
2. A submission already exists → its receipt (`alreadySubmitted: true`), whichever `requestId` was sent.
3. `now() > ends_at + grace` (grace from the exam, default 30 s, Q3), or the sweep has already finalized it → 409 `time_over`. Exactly at `ends_at + grace` is still accepted.
4. Insert the submission: `end_reason` from the body (`submitted`, `time_up`, or `violations`, which is refused with 400 unless the count is over 5), `violation_count` = the higher of the body's count and the checkpoint's, `events` from the body. Set `submitted`, `submitted_at = now()`, `time_taken_seconds = LEAST(now(), ends_at) − started_at` in whole seconds (**server time; grace never adds time**).
5. Commit, then: mark `att:{id}` submitted, enqueue scoring (job id `score.<attemptId>`), answer the receipt. If the enqueue fails, the answer is still 200 and the sweep enqueues it later.

The client keeps its local copy and retries with backoff until a receipt arrives. A `requestId` used by another attempt → 409 `request_id_conflict` (P2002 on the unique).

### 3.9 Server-side finalize (sweep job, every 60 s, one run at a time)

For attempts still `in_progress` past `ends_at + grace + 30 s` (the partial index), at most 500 per run:
1. Read `ckpt:{id}` from Redis.
2. Transaction: lock the row with `FOR UPDATE SKIP LOCKED`; if it is still `in_progress` with no submission, insert a submission from the checkpoint (`end_reason = server_checkpoint`, with its violation count and events) or an empty one (`server_empty`), request id `auto.<attemptId>`; status `expired`, `submitted_at = now()`, `time_taken_seconds = ends_at − started_at`.
3. Enqueue scoring.

The same job re-enqueues scoring for any `submitted`/`expired` attempt still unscored after 5 minutes (a lost job). Two workers can run it safely: `SKIP LOCKED` and the unique `attempt_id` make it idempotent.

### 3.10 Scoring (worker, queue `exam`)

Job `score-attempt`: load the layout, the submission and the correct keys of the layout's question versions (one `WHERE id = ANY($1)` read), map each answer position to its option key through the layout, count correct answers (1 mark each, no negative marking: Q1), then `UPDATE attempts SET score, status = 'scored', scored_at WHERE id = $1 AND status IN ('submitted', 'expired')`. Idempotent; 5 tries with backoff; failures kept for inspection. Scoring runs right after each submit (spreading the load over the window), but no score reaches any client until results are published.

### 3.11 Exam states for the student (`GET /exams`)

| Attempt | Clock | State |
|---|---|---|
| none | `now < window_start` | `upcoming` |
| none | window open | `open` |
| none | `now ≥ window_end` | `closed` |
| `in_progress` | `now ≤ ends_at + grace` | `in_progress` |
| `in_progress` past grace, `submitted`, `expired`, `scored` | any | `submitted` |

Plus `resultsPublished` on the card once results are out.

### 3.12 Window close, results, review

1. When the window has closed and no attempt of the exam is still `in_progress`, `submitted` or `expired` (everything is scored), the sweep enqueues `build-leaderboard` (job id `lb.<examId>.<generation>`). An admin can also rebuild (`results/build`).
2. The build, in one transaction with `SET LOCAL statement_timeout = '120s'`: generation + 1;

```sql
INSERT INTO leaderboard_entries (exam_id, generation, position, rank, user_id, attempt_id, name, institution, category, score, time_taken_seconds, created_at)
SELECT a.exam_id, $2,
       row_number() OVER (ORDER BY a.score DESC, a.time_taken_seconds ASC, a.id),
       rank()       OVER (ORDER BY a.score DESC, a.time_taken_seconds ASC),
       a.user_id, a.id, u.name, u.institution, u.category, a.score, a.time_taken_seconds, now()
FROM attempts a JOIN users u ON u.id = a.user_id
WHERE a.exam_id = $1 AND a.score IS NOT NULL AND NOT u.is_blocked
ORDER BY a.score DESC, a.time_taken_seconds ASC;
```

   (the query form fixed in DECISIONS: the `score IS NOT NULL` filter, no `NULLS LAST`), then `results_generation` and `results_snapshot_at` on the exam.
3. The admin checks the admin leaderboard (scores, emails), then **publishes** (`results_published_at`; the CHECK refuses it before `window_end + grace`). Audit-logged.
4. Students then see the leaderboard (pages from the Redis cache; search reads the snapshot table, throttled per user) and their review: their answers, the correct options, explanations, own score and rank (Q5).
5. Unpublish hides both again (audited).

### 3.13 Ordering cases

| Case | Result |
|---|---|
| Double click on Start, two tabs | One attempt (unique), both get it |
| Submit twice, retry after a timeout | One submission; the same receipt |
| Submit at `ends_at + grace − 1 s` | Accepted; `time_taken` capped at `ends_at` |
| Submit at `ends_at + grace + 1 s` | 409 `time_over`; the sweep finalizes from the last checkpoint |
| Submit while the sweep runs | The sweep skips the locked row; the submit wins inside the grace |
| Admin saves a question while students start | New attempts draw from the new version; started ones keep theirs |
| Redis flushed mid-exam | Questions re-read from Postgres (single-flight); checkpoints lost, local copies and the final submit remain |
| Worker down | Submits still succeed; scoring waits in the queue; alert on queue depth |
| Session expires mid-exam | 401 → refresh → retry (A2's client); if the session is gone, answers stay local, the student logs in and resumes |
| Reload after 3 violations | The count stays 3 (`localStorage` and the server); the next violation is warning 4 |
| 6th violation while offline | The player ends the exam at once and keeps the submit (`violations`) locally until it gets through, within the grace; otherwise the sweep submits the last checkpoint |

### 3.14 Cost per student

| Step | Database | Redis |
|---|---|---|
| Start | 2–3 indexed reads + 1 insert | config, pool, N question versions |
| Checkpoint (every 60–120 s) | **0** | 1 read + 1 script |
| Submit | 1 transaction (lock, insert, update) | 1 write |
| Scoring (worker) | 2 reads + 1 update | — |
| Leaderboard view | 0 for pages, 1 snapshot read for a search | 1 read |

### 3.15 Rule violations: warnings, then an automatic submit (owner, Q4)

On for every exam, always; no admin switch. The idea comes from the old `QuizForm.jsx` and `StartModal.jsx`, not the code.

**What counts as a violation** (only while the exam is running: not before Start, not during time-up or submitting):
- **Leaving the exam:** the window loses focus or the page becomes hidden (a tab or app switch). One leave counts once, until the page has focus again; a warning on screen does not pause counting.
- **Developer tools keys:** F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, and on a Mac Cmd+Opt+I, Cmd+Opt+J, Cmd+Opt+C. The key is blocked and counted. Opening the tools from the browser menu cannot be seen by a page.

**Not a violation (recorded as an event only):**
- the blur of a page that is reloading or closing (`beforeunload` / `pagehide` mark the page as unloading first);
- going offline or coming back online.

**What the student sees:**
- Each violation: the exam area turns blurred and grey, with a dialog "Warning n/5", the reason (left the exam / developer tools) and a "Return to exam" button. The timer keeps running.
- After 5 warnings, the next violation (the 6th) shows "Exam ended" (no way back) and submits the **current** answers at once, with `endReason = violations`; then the receipt says why the exam ended. There is no 0–20 s delay here: such ends are spread out on their own.
- If Rasel wants the 5th violation to end the exam, the lead will say so; only `EXAM_VIOLATION_WARNINGS` changes.
- Right-click and text selection are off in the exam area (the `contextmenu` event and `user-select: none`). Screen readers still read the text.

**The count survives everything (the old count lived only in the page's memory, so a reload reset it to 0):**
1. Every violation is written to `localStorage` at once (count + event with its time).
2. The next checkpoint carries the count and the events; the server keeps the highest count it has seen and never lowers it (3.4).
3. `AttemptView.violationCount` returns the server's count on every start and resume; the player takes the higher of it and the local count.
4. A resume with a count already over 5 submits at once (`violations`).
5. The final submit stores `end_reason`, `violation_count` and the events; the admin sees each student's count, end reason and event times (`GET /admin/exams/:id/attempts`, E3; the screen in E5).

**Honest limits:** the browser detects all of this, so a modified browser or a second device can avoid it. It deters and records; it does not prove cheating. The rules text says only what the system really does (5.1).

## 4. Admin: create, edit, version, publish, lock

### 4.1 What can change when

| State | Exam config | Questions |
|---|---|---|
| `draft` | Everything (DTO + DB CHECKs) | Add, edit in place, delete |
| `published`, before any attempt | `title`; `window_end` extended. Anything else: unpublish first (only before `window_start − 5 min`) | Edit = new version. Add and retire only with `random_draw` (the pool must stay at least N) |
| `published`, attempts exist | `title`; `window_end` extended while the window is still open (e.g. after an outage; reason required) | Edit = new version (new attempts only). Add and retire only with `random_draw`. **Never delete** |
| results published | `title` | Frozen in practice (new versions reach no one) |
| `archived` | Nothing | Nothing |

The database enforces the frozen columns (2.4), so a bug in the API cannot reset a timer or rewrite a question someone has already answered.

### 4.2 Publish checks (server)

- Active questions: exactly `questions_per_attempt` (default, everyone gets the same questions), or at least that many when the admin chose `random_draw` (Q2).
- After publish, adding or retiring a question in a `random_draw = false` exam is refused (the pool must stay equal to the count); replacing one by a version is allowed. With `random_draw`, a retire that would leave fewer than N active questions is refused.
- Every question: 2–6 options with unique keys and non-empty texts, the correct key among them (also a CHECK), no duplicate question text in the exam (the old admin form's rule).
- `window_end − window_start ≥ duration`; `duration ≤ 30` (CHECK).
- `category` and `round` exist.
- Then: `status = published`, `published_at`, audit row, warm-up enqueued.
- The publish dialog shows the window in Asia/Dhaka time and the counts, and requires a confirmation.

### 4.3 Versioning

- One transaction:
  1. lock the old row;
  2. set it `is_active = false`, `deactivated_at`;
  3. insert the new row: same `exam_id`, `lineage_id` and `position`, `version + 1`, `is_active`;
  4. write the audit row (old and new id).
- The partial unique allows one active version, and `(lineage_id, version)` is unique, so two admins saving at once get one success and one 409.
- Attempts keep the exact version ids in their layout. Scoring and review use those versions.
- Answer-key correction for attempts already taken (re-scoring everyone) is P1 (E7): a separate, audited action, not an edit. Built in E7b: append-only `answer_key_corrections`, the newest per question is the key in effect, a re-scoring job per correction, Build and Publish blocked until it is done (DECISIONS "Answer-key correction after publish (E7b)").

### 4.4 Audit actions

`exam.created`, `exam.updated`, `exam.published`, `exam.unpublished`, `exam.archived`, `exam.window_extended`, `question.created`, `question.updated` (draft), `question.versioned`, `question.retired`, `question.deleted` (draft), `results.built`, `results.published`, `results.unpublished`.

## 5. UI

Rules from `07-UI-MIGRATION.md`: `@sirat/ui` components and tokens only, `-strong` colours for text, every text through `src/i18n/messages` (bn + en), loading/empty/error states, mobile-first.

### 5.1 Student

| Screen | Change | PR |
|---|---|---|
| `/dashboard/exam` (exists, mock) | Real `GET /exams`. Buttons by state: Open → "Start", In progress → "Continue", Submitted → "Receipt", results published → "Results" | E4 |
| `/dashboard/exam/[id]` (new) | Server Component reads `GET /exams/:id`, then renders one of: waiting room (countdown to start from `serverNow`), rules dialog, player, receipt | E4 |
| Rules dialog (look of `StartModal`) | Rules from the exam config (duration, number of questions, grace), the violation rule below, an "I agree" checkbox, Start | E4 |
| Player (look of `QuizForm` + `QuizQuestion`) | One question at a time, progress `n/N` with a bar, positional labels (A–D / ক–ঘ), Back/Next and a question palette (unanswered ones marked), `Countdown` from server seconds, connection badge, the warning count once it is above 0. Right-click and text selection off in the exam area | E4 |
| Warning dialog (3.15) | The exam area blurred and grey; "Warning n/5", the reason, "Return to exam" | E4 |
| "Exam ended" dialog (3.15) | After the 6th violation: "Exam ended. Your answers are being submitted." No way back; then the receipt with the reason | E4 |
| Final submit dialog (look of `FinalSubmitModal`) | "Submit now? n unanswered"; confirm | E4 |
| Time-up dialog (look of `TimeUpModal`) | "Time is up. Saving your answers…", then the receipt. No "Quit" | E4 |
| Receipt | Receipt id and time; "Results after the window closes for everyone". No score | E4 |
| Review (S11) | Each question with the student's choice, the correct option, the explanation; own score and rank | E5 |
| `/dashboard/leaderboard` (exists, mock) | Real `GET /leaderboard`; round tabs, category select (default: own), server paging and search, "not published yet" state | E5 |

- **Player logic is in plain modules** (`components/exam/state.ts` reducer, `storage.ts`, `sync.ts`, `time.ts`), so `node --test` covers them without a browser.
- **The player is the one screen that calls `/api` from the browser** (through A2's `lib/api.ts`, refresh after a 401): RULEBOOK 7.1 requires the answers to live in the browser. This is a recorded exception to "no client-side fetching" (DECISIONS, E4).
- **Local copy:** `sirat.exam.*` keys are removed on receipt and on logout. The logout change is one line in A2's `LogoutButton.tsx` (merged with #12), told to Rasel first.
- **Rules text (bn + en), only what the system really does** (the old text claimed "AI detection and screenshot monitoring", which did not exist):
  - "Do not leave the exam. Switching to another tab or app, or opening developer tools, shows a warning."
  - "After 5 warnings, the 6th time ends your exam and submits your current answers."
  - "Every such event is recorded with its time."
  - "On a phone, turn on Do Not Disturb: a call or a notification can count as leaving the exam."
  - "Reloading the page or losing the network does not count. Your answers are saved, and the timer keeps running."
- **Kept from the old player (the idea, not the code):** blur and grey on a violation, the warning dialog, the automatic submit after the warnings run out (now after 5 warnings), right-click and selection off in the exam area.
- **Dropped from the old player:**
  - the 30-minute constant;
  - `time_taken` and `user_id` sent by the client;
  - the violation count kept only in the page's memory (a reload reset it to 0);
  - the claims about AI detection and screenshots;
  - the print blocking;
  - "Next" locked until answered (skipping is allowed, D5).

### 5.2 Admin

| Screen | Change | PR |
|---|---|---|
| `/admin/exams` (exists, read-only) | Real API; "New exam" button; status filter | E5 |
| `/admin/exams/new` (new) | Config form: title, category (all / one), round, window start and end (Asia/Dhaka, stored UTC), duration, questions per attempt, grace, and an unticked "Different questions per student (from a larger pool)" box, with a note that students then get different questions | E5 |
| `/admin/exams/[id]` (exists, read-only) | Edit config (fields frozen by state are shown read-only with the reason); question list with an editor dialog (text, 2–6 options, correct option, explanation, keep order). In a published exam the save button says "Save as version n+1" with a note that started attempts keep theirs. Retire instead of delete. Publish, unpublish and archive dialogs with the server's check results | E5 |
| Results panel on `/admin/exams/[id]` | Counts by status, snapshot time, build, publish/unpublish results (confirm dialogs) | E5 |
| Attempts on `/admin/exams/[id]` (owner, Q4) | Paged table: student, status, end reason, violation count, times, score (after scoring); filters for "ended by violations" and "at least n violations"; a dialog with one attempt's events and times | E5 |
| `/admin/leaderboard` (exists, mock) | Real `GET /admin/leaderboard`; exam and category filters | E5 |

Mutations go through Server Actions that call the API server-side with the session cookie (A2's `lib/server-api.ts`), as `07-UI-MIGRATION.md` requires. The action buttons hidden by the UI port (DECISIONS UI #9) appear only once their audited endpoints exist.

### 5.3 Data layer

- E4 and E5 add `data/http/exams.ts` and `data/http/leaderboard.ts`, behind the same `DataSource` interface.
- Payments' web days also add an HTTP source. Whoever comes first creates the shared `data/http/index.ts` skeleton; the other adds only its own file and a line there. Agreed through Rasel before either starts.
- Pages do not change when the source changes. The mock gains the new methods and the player states for `?mock=` previews.

## 6. Tests and load test

### 6.1 Tests

Each protection gets a test that fails with the protection removed (mutation-checked, as in A2). File names are proposals.

**API unit (`pnpm test`)**
- `layout.spec.ts`: without `random_draw` every layout holds the same N questions, only the order differs; with it, N distinct ids from the pool; permutations valid; `keep_option_order` kept; uses `crypto.randomInt`.
- `answers.spec.ts`: length N, `null` or 0…options − 1, wrong length/type/range → 400; events capped.
- `scoring.spec.ts`: positions → keys through the layout; unanswered; a replaced version scored against the version the student saw.
- `exam-time.spec.ts`: `ends_at = min(…)`, remaining seconds, the grace boundary (equal accepted, +1 ms refused), `time_taken` capped at `ends_at`.
- `exam-state.spec.ts`: the table in 3.11.
- `ranking.spec.ts`: ties (1, 2, 2, 4), time breaks score ties, equal score and time share a rank.
- DTO specs: `score`, `userId`, `startedAt`, `timeTaken`, `role`, unknown fields → 400.

**Integration (`pnpm --filter @sirat/api test:int`, database + Redis)**
- `prepare-test-db` test (2.3): EX1 and EX2 apply on a `*_test` database that holds main's old exam rows.
- `exam-constraints.int-spec.ts` (new file): every CHECK and trigger in 2.2 and 2.4, one active version per lineage, `(lineage_id, version)` unique, `submissions` append-only, results not publishable before `window_end + grace`, attempts not insertable for a draft exam, the timer columns not updatable.
- `exam-start.int-spec.ts`:
  - unverified email → 403;
  - no paid registration → 403 (after payments PR 1, with its payment status names);
  - other category → 404; draft → 404;
  - before / after the window → 409;
  - 10 parallel starts → one attempt, all answers the same;
  - `ends_at` near the window end = `window_end`;
  - N questions drawn.
- **`exam-leak.int-spec.ts` (the required test):** an exam whose correct keys and explanations are canary strings, and whose other students have distinctive scores and times. Every student response before publishing is scanned for those values and for the field names `correctKey`, `correct_key`, `explanation`, `score`, `timeTaken`:
  - `GET /exams`, `GET /exams/:id`;
  - start, resume, checkpoint, submit;
  - `GET /leaderboard`;
  - review before publishing.

  Also: question objects carry no `key` or `id`; over 400 attempts, the correct option's displayed position is spread evenly (a loose chi-square bound), so the option order leaks nothing.
- `exam-checkpoint.int-spec.ts`:
  - another user's attempt → 404;
  - after the grace → 409; after submit → 409;
  - **no database write** (a query counter on the test app's Prisma client sees no INSERT or UPDATE);
  - an older `seq` is ignored; bad answers → 400; below the interval → 429;
  - the violation count never goes down (a lower count is ignored) and is kept even on a 429.
- `exam-violations.int-spec.ts` (owner, Q4):
  - **the count survives a reload:** after checkpoints with 3 violations, resume and a start from a second "device" both return `violationCount` 3;
  - **the 6th violation submits the real answers:** a submit with `endReason = violations`, count 6 and answers `[2, null, 1]` stores exactly those, with the reason and the events;
  - `violations` with a count of 5 or less → 400;
  - the admin attempts list shows each student's count and end reason, and the attempt detail the events; a student or manager → 403.
- `exam-submit.int-spec.ts`:
  - 5 parallel submits with one `requestId` → one row, one receipt;
  - a second `requestId` → the first receipt;
  - grace boundary both sides;
  - `time_taken` from the server;
  - the stored answers equal the sent ones;
  - scoring enqueued after the commit; a failed enqueue still answers 200;
  - another user → 404.
- `exam-resume.int-spec.ts`: same questions and order after a reload and after an admin versioned a question; remaining time keeps falling (never reset); after a Redis flush, questions come from Postgres.
- `exam-finalize.int-spec.ts`: past the grace → `expired` with the checkpoint answers, or empty without one; two sweeps at once → one submission; a submitted attempt is never touched; a lost scoring job is re-enqueued.
- `exam-scoring.int-spec.ts`: correct count, idempotent re-run.
- `exam-results.int-spec.ts`:
  - the snapshot only when everything is scored;
  - ranks and ties, paging, search, blocked users left out;
  - students see `unpublished` before publishing and no score/time/email after it either (Q5);
  - review 403 before publishing, then the correct answers; another user's review → 404;
  - publishing before `window_end + grace` refused by the API and by the CHECK.
- `admin-exams.int-spec.ts`:
  - student and manager → 403 on every write; manager reads the admin leaderboard only;
  - DTO and publish checks (too few questions refused);
  - versioning (old attempts keep the old version, new attempts get the new one);
  - delete after publish = retire;
  - unpublish only before the window and without attempts;
  - stale `expectedUpdatedAt` → 409; an audit row for every write.
- `app-routes.int-spec.ts` passes unchanged (no new public route).

**Web (`pnpm -F web test`, `node --test`)**
- `state.test.ts`: **auto-submit at time-up sends the current answers** (e.g. `[2, null, 1]`), never `{}` or an empty list; a local save after each change; the pre-time-up checkpoint; the 0–20 s jitter bounds; submit retries keep the local copy until a receipt; merging local and server by `seq`; 401 → refresh → retry; the offline badge.
- `violations.test.ts` (owner, Q4):
  - **the count survives a reload** (restored from `localStorage`; the higher of local and server wins);
  - **the 6th violation submits the current answers** (`[2, null, 1]`, `endReason = violations`), never an empty list; warnings 1–5 only warn;
  - **reload, close and offline are not violations** (`beforeunload`/`pagehide` before the blur; `offline`/`online` events);
  - **developer tools keys are caught:** F12, Ctrl+Shift+I/J/C, Cmd+Opt+I/J/C count and are blocked; other keys (Ctrl+C, Shift+I alone, letters) do not count;
  - one leave counts once until focus returns; leaving again while a warning is open counts again;
  - nothing counts before Start or after the exam ended;
  - the rules text in bn and en does not mention AI detection or screenshots.
- Every API error code maps to a Bangla and an English message; i18n parity (existing).
- `check:leak` also renders the waiting room and receipt pages with canary data.

**End to end** (A2's `scripts/e2e.mjs`, headless browser; on the shared stack only when Rasel says so):
- log in as a fixture student, start, answer, reload (resume), go offline and back: no warning;
- switch to another tab: warning 1/5; reload: still 1/5; five more switches: "Exam ended", and the admin attempts list shows `violations` with the answers given;
- a 1-minute test exam reaches time-up and auto-submits; the admin results show the answered count;
- a receipt without a score.

### 6.2 Load test (k6)

`loadtests/exam-simulation.js`, three scenarios:
1. **Window-open surge:** starts ramping to a target rate within 60 s.
2. **Steady exam:** each virtual user logs in once, opens the exam, starts, checkpoints every 60–120 s, submits with a 0–20 s delay. The exam length is set by env, so a local run can use 3 minutes.
3. **Time-up burst:** every user starts shortly before the window ends, so all timers end at `window_end` and all submits land within about 20 s.

- **Checks:** p95 < 500 ms, errors < 0.5 % (RULEBOOK §13); after the run, the admin results count equals the receipts k6 received (**zero lost submissions**); the queue drains; `pg_stat_user_tables` shows no writes during checkpoint-only phases.
- **Users:** a guarded load fixture script (`prisma/fixtures/loadtest-fixtures.ts`, the same four guards as the dev fixtures) creates N verified students with paid registrations in the local database. It builds on payments' new fixture shape, so it comes after payments PR 1.
- **Now (local, E6):** this worktree's API on 4200 and its worker against `sirat_exam`, a few hundred users. The numbers are provisional and catch regressions only.
- **Later (VPS):** from another machine, at 1.5–2× the expected peak (OPEN-QUESTIONS #24 estimates 1,300–3,800 concurrent attempts; 1.5–2× the upper figure is about 5,700–7,600), including the first-hour surge, against a staging stack (own compose project and database). Results and the capacity decision go into DECISIONS. No real exam before this passes.

## 7. Conflict files: what changes when

Git rule: no rebase and no force-push on a pushed branch. Conflicts are resolved with `git merge origin/main` (a merge commit, never the GitHub web editor). Right before every push: `git merge origin/main`, and tell Rasel in one line which shared files the push changes.

| File | When | Handling |
|---|---|---|
| `apps/api/prisma/schema.prisma` | E1 only, one commit | Exam models, two enums, `LeaderboardEntry`, one back-relation line in `User` (next to payments' lines: keep both) |
| `apps/api/prisma/migrations/*` | E1 only (EX1, EX2) | Always after payments'. Whoever merges second regenerates its generated migration (2.3) |
| `apps/api/prisma/seed.ts` | No change | — |
| `apps/api/prisma/fixtures/*` | E2: a new file `dev-exam-fixtures.ts` (a published exam with questions, window now … now + 7 days, for local UI and e2e). E6: `loadtest-fixtures.ts` | New files only; `dev-fixtures.ts` and `guard.ts` (payments' day 1) are not touched |
| `apps/api/package.json` | E2: one script line `db:fixtures:exam`; E6: one line `db:fixtures:load` | One line each, told to Rasel before the push (DECISIONS "Launch target" #3) |
| `pnpm-lock.yaml` | No change planned (BullMQ, ioredis, class-validator present; k6 is a separate binary) | If a dependency becomes necessary: its own commit after `git merge origin/main`, the lockfile regenerated, never hand-merged; told to Rasel first |
| `apps/api/src/app.module.ts` | No change (the modules are already imported; admin controllers live inside `ExamsModule` and `LeaderboardModule`) | — |
| `apps/api/src/worker.ts` | E3: one import line (`ExamWorkerModule`) | Payments adds its worker module next to it: keep both |
| `apps/api/src/config/env.ts`, both `.env.example` | E2: an "Exam engine" block at the end, all with defaults (`EXAM_CHECKPOINT_MIN_INTERVAL_SECONDS`, `EXAM_FINALIZE_SWEEP_SECONDS`, `EXAM_SCORING_CONCURRENCY`) | Payments' block also ends these files: keep both |
| `apps/api/test/helpers.ts`, `db-constraints.int-spec.ts` | E1, after `git merge origin/main` (payments PR 1 changes both): only the exam parts. `examData()` and `makeAttempt()` fill the new required columns, and the "exam attempts and submissions" block (today it inserts `answers: {}` and no `end_reason`) moves into the new `exam-constraints.int-spec.ts`. New exam helpers go into a new `test/exam-helpers.ts` | Payment helpers and payment blocks are not touched |
| `apps/api/test/prepare-test-db.mjs` | E1, after payments PR 1 merges | Extends payments' mechanism for old test rows to the exam tables (2.3); no second path |
| `packages/shared/src/index.ts`, `records.ts`, `dashboard.ts` | E1 (records), E2/E3 (`exam.ts` + one export line; the type changes in 1.3) | The UI and payments sessions may change them too: `git merge origin/main`, keep both |
| `apps/web/src/data/source.ts`, `data/mock/*`, `data/http/*` | E4, E5 | Coordinated with payments' web days (5.3) |
| `apps/web/src/components/auth/LogoutButton.tsx` (A2) | E4, one line | Told to Rasel first |
| `.github/workflows/ci.yml` | No change planned (the integration job runs every `*.int-spec.ts`) | — |
| `infra/*` | No change | — |
| `docs/06-API.md` | E1 (admin), E2 (student), E3 (results, leaderboard) | Payments edits it too (its day 4): merge, keep both |
| `docs/05-DATABASE.md` | E1 | |
| `docs/DECISIONS.md` | E0 (the owner's exam rules, Q1–Q5), then one entry per PR | Entries at the top. Before each push: `git merge origin/main`, keep every entry from both sides, newest first |
| `docs/OPEN-QUESTIONS.md` | E0 (rows #4–#10 marked answered, pointing to DECISIONS) | Payments and A2 may edit other rows: merge, keep both |
| `docs/RUNBOOK.md` | E6 only, one commit (exam-day steps: warm-up check, sweep and queue health, publish results, incidents) | |
| `docs/03-HOW-IT-WORKS.md` §3–4, `07-UI-MIGRATION.md`, `CLAUDE.md` §4 | E3 (03), E4/E5 (07), E6 (CLAUDE.md state, or when the lead says) | |

The docs-only pull request of this plan adds `docs/plans/EXAM-PLAN.md`, one entry at the top of `DECISIONS.md` and the answered rows #4–#10 in `OPEN-QUESTIONS.md` (owner, 2026-10-31). It runs `git merge origin/main` right before each push.

## 8. Pull requests and schedule

### 8.1 Pull requests

**Branches (lead, 2026-10-31 20:10):** the PRs are built one after the other locally, each branch from the previous one (`feat/exam-engine` from `feat/exam-schema`, `feat/exam-results` from `feat/exam-engine`, …), without waiting for merges. Before its PR opens, each branch runs `git merge origin/main` (never a rebase) and the full checks; the PR body says what it is stacked on. E1's PR opens once payments PR #14 has merged.

| PR | Branch | Content | Needs |
|---|---|---|---|
| E0 | `feat/exam-plan` | This plan, the owner's exam rules in DECISIONS, OPEN-QUESTIONS #4–#10 answered (docs only) | Lead review |
| E1 | `feat/exam-schema` | EX1 + EX2, the exam/question admin API (create, edit, version, publish, unpublish, archive), audit, `06-API`/`05-DATABASE`, DECISIONS | E0 merged; opens after payments PR 1 merged (migration order) |
| E2 | `feat/exam-engine` | `GET /exams`, start/resume, checkpoint (with the violation count), submit (with the end reason), Redis caches and warm-up, access check, dev exam fixture, the leak test | E1; payments PR 1 (access check) |
| E3 | `feat/exam-results` | Worker: scoring, finalize sweep, leaderboard build; results publish, review, student and admin leaderboard API; the admin attempts list with violations (owner) | E2 |
| E4 | `feat/exam-player` | Exam list on the API, waiting room, rules, player, violation warnings and the automatic submit, time-up, receipt | E2 (A2 PR #12 is merged) |
| E5 | `feat/exam-admin-ui` | Admin create/edit/publish, results panel, attempts with violations, review page, leaderboards on the API | E1, E3, E4 |
| E6 | `feat/exam-loadtest` | k6 exam simulation (local), load fixtures, RUNBOOK exam day, 03-HOW-IT-WORKS, CLAUDE.md state | E3 |
| E7 (P1) | later | CSV import, answer-key correction with re-scoring | after the launch |

### 8.2 Schedule (estimate, at the measured pace)

Rewritten on 2026-10-31 at the pace this work measured (lead, 20:10). The first version said 27–33 hours and E1 on 1–2 November; E1 was committed the same evening.

**Measured from git (this work, 31 October):**
- E0, the plan, with two review rounds: about 1 hour.
- E1 (contract, schema, two migrations with five triggers, 13 admin endpoints, unit and integration tests, 10 mutation checks): written between #13's merge (19:16) and its commit (19:56). Part of that was waiting for the database password.

**Coding time still ahead (estimate):**

| PR | Estimate | Without cutting |
|---|---|---|
| E2 | 1–1.5 h | the leak test, the violation tests, mutation checks |
| E3 | 1–1.5 h | the worker jobs' idempotency tests, results timing tests |
| E4 | 1.5–2 h | the player's state tests (auto-submit with real answers, the violation rules), the e2e script |
| E5 | 1–1.5 h | the page and leak checks |
| E6 | 0.5–1 h | k6 locally, RUNBOOK |
| **Total** | **about 5–7.5 h** | |

**Order and dates (estimate).** Every PR merges, as the lead assumes, within about an hour of a green CI, but only after the launch PRs (payments, A2's refresh fix) have been reviewed and merged.

| When (estimate) | Work |
|---|---|
| Sat 31 Oct, evening | E2 locally (branch from E1), then E3 locally (branch from E2) |
| Sun 1 Nov | E4, E5, E6 locally. E1's PR right after payments PR #14 merges: `git merge origin/main`, the six steps (2.3, section 7), full checks |
| Sun 1 – Mon 2 Nov | E2 to E6 as PRs one after the other, each after the previous one merged and `main` merged into it. E2 gets the paid-registration check before its PR opens (payments PR 1 is on `main` by then) |
| by Mon 2 Nov | E1–E6 on `main`, if the launch reviews leave the slots |
| later | k6 on the VPS (OPEN-QUESTIONS #22); the first real exam only after RULEBOOK §13 |

**What does not compress** (waits, not coding):
- Payments PR #14's merge (E1's PR, E2's access check).
- The launch PRs' reviews and merges, which come first; then the lead's review of each exam PR and Rasel's merge.
- Shared-stack slots for smoke and e2e (Rasel says "stack তোমার"; `main` merged first, because the shared database will carry payments' migrations).
- The VPS for the real k6 numbers.
- The client's exam content and dates.

## 9. Owner questions (Rasel): answered 2026-10-31

All five are answered (owner, through the lead, 2026-10-31 18:13). Recorded in DECISIONS ("Exam rules (owner)"); OPEN-QUESTIONS #4–#10 point there.

| # | Question (OPEN-QUESTIONS) | Owner's answer | Used in |
|---|---|---|---|
| Q1 | **Format (#4):** question type, marks, negative marking, images, languages? | **Default approved.** Multiple choice, one correct answer, 4 options (2–6 allowed), 1 mark each, **no negative marking**, text only (no images), each question in the language the admin types (no paired bn/en versions). Option order shuffled per student, except questions marked "keep order" (e.g. "all of the above") | E1 (CHECKs), E3 (scoring) |
| Q2 | **Pool (#5):** how many questions in the pool, how many per student? | **Approved with the lead's change.** Everyone gets the same questions (pool = questions per attempt), so the olympiad ranking stays fair; only the question order and the option order are shuffled per student. Different questions per student from a larger pool happen only if the admin ticks that box for an exam (`random_draw`) | E1 (publish check), E2 (draw) |
| Q3 | **Window, time and grace (#6, #7, #8):** window length per exam? 30 minutes a hard maximum? Grace after time-up? What if the final submit never arrives? | **Default approved.** The admin sets each window (any length of at least one exam duration); 30 minutes stays the hard maximum (CHECK); **grace 30 s**; a late starter gets only the time left in the window (`ends_at = min(start + duration, window end)`); the clock keeps running during a disconnect; **no submit by the end of the grace → the server submits the last checkpoint** (saved at most about 2 minutes earlier, plus one shortly before time-up), or an empty answer sheet if there is none | E2, E3 |
| Q4 | **Tab switching (#9):** off, log only, or auto-submit after N? | **Changed by the owner (the plan's log-only default is dropped).** Each tab or app switch, and each developer-tools key, is a violation with a warning ("Warning n/5", blurred grey page, "Return to exam"). After 5 warnings, the 6th violation ends the exam and submits the current answers, as in the old Zero Olympiad. **On for every exam, always; no admin switch.** Reload, close and offline are not violations. Right-click and text selection off in the exam area. The count lives in `localStorage` and on the server, so a reload never resets it; the admin sees each student's count and events. Details: 3.15. (If Rasel wants the 5th violation to end the exam, the lead will say so; one constant changes) | E2, E3, E4, E5 |
| Q5 | **Results (#10):** scores on the leaderboard? Ties? What does a student see of their own result? | **Default approved.** Leaderboard per exam (each category its own): **rank, name, institution only**, no scores, times or emails for students; admins see everything. Equal score: the faster time ranks higher; equal score and time share a rank (1, 2, 2, 4). After an admin publishes the results, each student sees their own score and rank and a review with the correct answers and explanations | E3, E5 |

**Defaults taken in this plan (not blocking; say if you disagree):**

| | Default |
|---|---|
| D1 | One exam per category (`category` null = everyone). A student sees only their category's exams |
| D2 | Only `student` and `ambassador` can start an exam. An admin preview without an attempt is P1: built as `GET /admin/exams/:id/preview` and `/admin/exams/[id]/preview` (DECISIONS 2026-11-03) |
| D3 | Starting needs a verified email (lazy verification), a **paid registration** and an unblocked account. There are no refunds (owner, 2026-10-31, in payments' DECISIONS; not on `main` yet), so access needs only "paid". The payment status names come from payments PR 1, read only |
| D4 | Answers are option positions. The client never sees question ids, option keys or correct keys |
| D5 | Skipping and a question palette are allowed; reload, resume and resume on another device are allowed (RULEBOOK 7.1) and keep the violation count; two devices at once are logged (`resume` events), not blocked |
| D6 | Scoring right after each submit (spreads the load); no score reaches a client before results are published |
| D7 | Students see results when an admin publishes them per exam (`results_published_at`, refused by the database before `window_end + grace`). `settings.leaderboard_public` stays for the public marketing board (Phase D). Review unlocks with the results |
| D8 | The snapshot lives in a Postgres table (`leaderboard_entries`), with leaderboard pages cached in Redis. Why: search on the server, it survives a Redis flush, and the admin and student views read one snapshot. This changes `05-DATABASE.md`'s "leaderboard snapshot (Redis/CDN)". Blocked users are left out |
| D9 | Unpublish only before `window_start − 5 min` and without attempts. After publish, edits create versions; nothing is deleted, only retired |
| D10 | Admin exam endpoints live in `ExamsModule` and `LeaderboardModule`, so `app.module.ts` and `admin.module.ts` do not change |
| D11 | Checkpoints stay in the cache Redis (`05-DATABASE.md`). They are small (a few MB at peak); the final submit is the source of truth, and the server-side finalize is best effort |
| D12 | No extra start jitter; added only if the k6 surge shows a need (RULEBOOK §7) |
| D13 | After publish, an exam's config changes only in `title` and an extended `window_end` (reason audited) |

## 10. Risks

1. **Priority below the launch.** Reviews and merges may come after 15 November. If payments PR 1 slips, E1 and E2 slip with it.
2. **Schema conflicts with payments.** Migration order, `User` back-relations, `env.ts` and `worker.ts` endings: handled by `git merge origin/main` and regeneration (sections 2.3, 7).
3. **The UI builds on A2's web session** (#12, merged 2026-10-31): changes there (refresh, session helper) reach the player; `git merge origin/main` before every push.
4. **No exam date, no VPS.** The real capacity is unknown until k6 runs on the VPS. No real exam before that and the rest of RULEBOOK §13.
5. **Question sharing** inside a two-day window (Q2): with the same questions for everyone, a student who sat early can pass questions on; shuffled order and options make that slower, not impossible. A bigger pool (`random_draw`) reduces it but makes students' question sets differ, so the admin chooses it per exam.
6. **Weak networks at time-up.** A 30 s grace with a 0–20 s spread leaves about 10 s for the network. The checkpoint just before time-up and the server-side finalize limit the loss to the last minute or so.
7. **False violations on phones** (Q4): a call, a notification or a system pop-up takes the focus and counts. Six of them end a student's exam. The rules text asks for Do Not Disturb, and the admin sees every event and its time, so a disputed case can be judged; the exam itself is not reopened by the system.
8. **Violations are detected in the browser** (3.15): a modified browser or a second device avoids them. They deter and record; they do not prove cheating.
9. **The session ends mid-exam.** The access token lasts 15 minutes; the open refresh gap after the 25 s API timeout (the lead's order for A2, before 15 November) would end a student's session. The player keeps the answers locally and resumes after login, but the gap must be closed before a real exam.
10. **Cache Redis** under `allkeys-lru`: an eviction or flush loses checkpoints (only the finalize uses them) and cached questions (re-read from Postgres with a single-flight lock). Memory is measured in k6.
11. **Window-open surge.** Measured in the k6 surge scenario. Per-user limits come from A2's PR; the checkpoint has its own interval.
12. **Correct answers on admin screens.** `GET /admin/exams/:id` is admin only (never manager); covered by the role tests and the leak checks.
13. **Personal data of minors on the leaderboard:** names and institutions are visible to logged-in students (Q5); the snapshot copies them; no emails, phones or scores.
14. **Two sessions on one machine** (section 11): separate database names, Redis DB 2 and ports; the shared stack only after Rasel says "stack তোমার".

## 11. Local environment: working next to A2 and payments

The A2 and payments sessions use the same Postgres, Redis and docker stack on Rasel's PC (payments: `sirat_pay`, Redis DB 1, ports 4100/4101).

**This worktree's `apps/api/.env`** (`G:\sirat-exam`, git-ignored):
- **Source:** built by a script from the committed `apps/api/.env.example`. Nobody else's `.env` was opened, copied or shown, and neither was the old project's. The script printed key names only.
- **Changed:**
  - `DATABASE_URL`, `DIRECT_URL` → database `sirat_exam`; `TEST_DATABASE_URL` → `sirat_exam_test`;
  - `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` end in `/2`;
  - `PORT=4200`, `WORKER_HEALTH_PORT=4201`;
  - a fresh random `JWT_ACCESS_SECRET` (never printed).
- **Local `DATABASE_URL` connects straight to Postgres (`127.0.0.1:15432`).** PgBouncer in the dev stack serves only the database named `sirat` (payments' plan §15), and this way no shared container needs a change. Local k6 numbers therefore leave PgBouncer out; the VPS run includes it.
- **Rasel types the dev Postgres password** into the three database URLs himself. The example's placeholder is still there, and Claude never reads or prints it. `FIXTURE_PASSWORD` stays empty until needed.

**What that gives:**
- this work's migrations never reach A2's or payments' databases;
- BullMQ queues (the same names on another Redis DB) never take each other's jobs;
- cache, throttle and checkpoint keys stay apart;
- integration tests use their own `*_test` database and Redis DB 2.

**Shared docker stack (project `sirat`):**
- no `up`, `down`, smoke test or e2e from this worktree until Rasel says "stack তোমার";
- always with `--build` (the images may come from another branch);
- the result goes to Rasel in one line when done.
- Work on the host against `sirat_exam`, `sirat_exam_test` and Redis DB 2 needs no permission.

**Cleanup after the exam work merges** (only with Rasel's OK): drop `sirat_exam` and `sirat_exam_test`, flush Redis DB 2, remove the worktree.

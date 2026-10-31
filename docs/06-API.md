# 06 — API surface (planned)

Prefix `/api`. Same origin as the web app. JSON only. Errors use the shape in `@sirat/shared` (`ApiError`). Lists return `Paginated<T>`. Every route has an explicit guard; the allow-list of public routes is below and a CI test fails on any unguarded route not in it (`apps/api/test/app-routes.int-spec.ts`, which also fails on a route registered outside a controller).

Guards: `Public` · `Auth` (valid session) · `Role(...)` · `Owner` (resource belongs to session user, or admin). Built (A2.1a): the global `AuthGuard` is deny by default; `@Public()` opens a route, `@Roles(...)` narrows it to roles from the token. `Owner` is a per-endpoint check in the service.

## Public allow-list (reviewed)

`GET /health`, `GET /ready`, `POST /auth/login`, `POST /auth/refresh` (cookie), `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /registrations/start`, `GET /payments/paystation/callback`, `POST /payments/paystation/ipn`, `GET /content/*` (public site content), `GET /certificates/verify/:code`.

## Endpoints

| Module | Method + path | Guard | Notes |
|---|---|---|---|
| auth | `POST /auth/login` | Public, failed-login limits | 204, empty body; sets the httpOnly cookies. 401 one message for any failure; 429 + `Retry-After` during a lock or limit (the password is not checked); 403 for a blocked account, only after the right password. Built (A2.1d) |
| | `POST /auth/refresh` | Public (cookie) | Rotation + reuse detection. 204 + new cookies; 409 = another tab refreshed a moment ago (retry); 503 = the rotation did not finish within its budget, or the database refused for a passing reason, and was rolled back (retry with backoff; the old cookies still work); 401 = log in again (cookies cleared). Built (A2.1b; budget: DECISIONS "Refresh rotation inside a time budget") |
| | `POST /auth/logout`, `POST /auth/logout-all` | Auth | Logout ends this device's session family; logout-all ends all of them (audited). Built (A2.1b) |
| | `GET /auth/me` | Auth | Session user only, read fresh from the DB (`SessionUser`); a blocked user gets 401. No writes in GET. Built (A2.1b) |
| | `POST /auth/forgot-password`, `POST /auth/resend-verification` | Public, 60/min per IP, per-address caps | `{email}`. Always 204 at once, empty body; the email (if any) follows from the background. Nothing tells whether the account exists. Built (A2.1e) |
| | `POST /auth/reset-password` | Public, 30/min per IP | `{token, password}`. 204; ends every session, verifies the email, unlocks the account; no login. 400 "This link is invalid or has expired" for every bad link; 400 "Validation failed" for a refused password (the link stays usable). Built (A2.1e) |
| | `POST /auth/verify-email` | Public, 30/min per IP | `{token}`. 204; never logs in (no session, no cookie). One 400 for every bad link. Built (A2.1e) |
| | `POST /auth/change-password` | Auth, login limits | `{currentPassword, newPassword}`. 204 + fresh cookies for this device; one transaction writes the hash, ends every session and retires reset links. 400 for a wrong current password or a refused new one; 429 + `Retry-After` while locked. Built (A2.1d) |
| users | `GET /users/me`, `PATCH /users/me` | Auth | **Allow-list DTO**: name, phone, district, institution, education, grade, photo |
| registrations | `POST /registrations/start` | Public, throttled | Creates pending registration + payment, returns `payment_url`. No `role` |
| payments | `GET /payments/:id/status` | Owner | Reads our DB |
| | `POST /payments/:id/recheck` | Owner, throttled | Calls PayStation status |
| | `GET /payments/paystation/callback` | Public | Hint only → status API → settle |
| | `POST /payments/paystation/ipn` | Public | Re-confirm via status API; idempotent |
| | `GET /payments/mine` | Auth | |
| exams | `GET /exams`, `GET /exams/:id` | Role(student, ambassador) | Window state, never questions. Exam engine (below). Built (E2) |
| attempts | `POST /exams/:id/attempts` | Role(student, ambassador) + verified email + paid registration | Start or resume (server clock). Built (E2) |
| | `GET /attempts/me?exam=:id` | Owner | Resume. Built (E2) |
| | `PUT /attempts/:id/checkpoint` | Owner | Redis only. Built (E2) |
| | `POST /attempts/:id/submit` | Owner | Idempotent by attempt and `requestId`. Built (E2) |
| | `GET /attempts/:id/review` | Owner, Role(student, ambassador) | 403 `results_not_published` until the exam's results are published (never before the window closed for everyone). Results (below). Built (E3) |
| leaderboard | `GET /leaderboard?exam=&page=&pageSize=&q=` | Auth | Published snapshot only; rank, name, institution. Results (below). Built (E3) |
| | `GET /admin/leaderboard?exam=&page=&pageSize=&q=` | Role(admin, manager) | The snapshot with email, score and time, also before publishing. Built (E3) |
| | `GET /admin/exams/:id/results`, `POST /admin/exams/:id/results/{build,publish,unpublish}`, `GET /admin/exams/:id/attempts[/:attemptId]` | admin | Results (below). Built (E3) |
| rounds | `GET /rounds/me` | Auth | |
| | `POST /rounds/:id/video` | Owner | Inside round window |
| certificates | `GET /certificates/mine`, `GET /certificates/:id/pdf` | Owner | |
| | `GET /certificates/verify/:code` | Public | |
| announcements | `GET /announcements` | Auth | |
| ambassadors | `GET /ambassador/me`, `POST /ambassador/teams`, `GET /ambassador/tasks`, `POST /ambassador/tasks/:id/submit` | Role(ambassador) | Own data only |
| admin (all `Role(admin)` unless noted) | `GET/PATCH /admin/users[/:id]`, `POST /admin/users/:id/role` | admin | Audited |
| | `GET /admin/exams?page=&pageSize=&q=&status=`, `GET /admin/exams/:id`, `POST /admin/exams`, `PATCH /admin/exams/:id`, `POST /admin/exams/:id/{publish,unpublish,archive}`, `POST /admin/exams/:id/questions`, `PUT`/`DELETE /admin/exams/:id/questions/:questionId`, `GET /admin/exams/:id/questions/:questionId/versions` | admin | Exam admin (below). Lock after publish; questions versioned, never deleted once published. Built (E1) |
| | `GET/PUT /admin/settings` | admin | Single writer |
| | `GET /admin/payments`, `POST /admin/payments/:id/reconcile` | admin | Audited |
| | `GET /admin/stats` | admin/manager | Cached |
| | `POST /admin/rounds/:id/promote` | admin | Idempotent, audited |
| | `GET/POST /admin/jury/*` | jury/admin | Judge recorded |
| | `CRUD /admin/announcements`, `/admin/ambassadors`, `/admin/tasks`, `/admin/rank-thresholds` | admin | |
| | `POST /admin/points/adjust` | admin | Compensating ledger entry |
| | `GET /admin/audit` | admin | |

## Exam engine (E2; plan: `docs/plans/EXAM-PLAN.md` §1.1, §3, §3.15)

`@Roles('student', 'ambassador')`; each request re-reads the student (a blocked account gets 403 `account_blocked` with a valid token). A student sees published exams for everyone or for their own category; any other exam is 404. Another user's attempt is 404, never 403. Shapes in `@sirat/shared` (`exam.ts`). Refusals carry reason codes in `details`. **No student response contains a question id, an option key, a correct key, an explanation or a score** (`exam-leak.int-spec.ts`).

| Method + path | Body | Answers |
|---|---|---|
| `GET /exams` | — | `StudentExamListItem[]`: card, `state` (`upcoming`/`open`/`in_progress`/`submitted`/`closed`, from the server clock), `resultsPublished` |
| `GET /exams/:id` | — | `StudentExamDetail`: card, grace, `violationWarnings` (5), `serverNow`, the student's attempt (`phase`, `endsAt`, receipt) |
| `POST /exams/:id/attempts` | — | 201 new / 200 existing `AttemptView`: questions as texts in this attempt's order, options as texts in their shuffled order, `remainingSeconds` and `serverNow` from the server, the last checkpoint's answers and the server's violation count. 403 `email_unverified`, `registration_required` (no paid registration: read only from payments' tables); 409 `not_open_yet` / `window_closed`. An existing attempt in any phase answers 200 (a submitted one carries its receipt and no questions) |
| `GET /attempts/me?exam=:id` | — | The same `AttemptView` (resume after a reload or on another device); 404 when none |
| `PUT /attempts/:id/checkpoint` | `seq`, `answers` (one option position or null per question), `violationCount`, `events` (≤ 300 `{type, at}`) | Redis only, no database write. 200 `{savedSeq, violationCount, remainingSeconds, serverNow}`; an older `seq` changes nothing. 429 `too_soon` + `Retry-After` within 20 s of the last stored checkpoint (the violation count is kept even then; it never goes down). 409 `time_over` (after `ends_at` + grace), `already_submitted`; 400 `answers_invalid`; 503 `checkpoint_unavailable` (the client keeps its local copy and retries) |
| `POST /attempts/:id/submit` | `requestId` (uuid), `answers`, `endReason` (`submitted`, `time_up`, `violations`), `violationCount`, `events` | One transaction. 200 `{receiptId, submittedAt, endReason, alreadySubmitted}`; a repeat answers the first receipt. 409 `time_over` (after `ends_at` + grace), `request_id_conflict`; 400 `answers_invalid`, `violations_not_reached` (`violations` needs more than 5). `time_taken` is computed by the server and never passes `ends_at` |

## Results (E3; plan: `docs/plans/EXAM-PLAN.md` §3.9–3.12, owner Q4, Q5)

Scoring and the snapshot run in the worker (queue `exam`): each submit queues `score-attempt`; a sweep every minute submits attempts that are still running past `ends_at + grace + 30 s` from their last checkpoint (`server_checkpoint`) or empty (`server_empty`), scores anything left unscored, and builds the snapshot of a closed exam once nothing is unfinished. Students see no score, time or email of anyone, and nothing of their own before the results are published (the database refuses publishing before `window_end + grace`). Refusal codes in `details`.

| Method + path | Who | Answers |
|---|---|---|
| `GET /leaderboard?exam=` | any signed-in user | `ExamLeaderboard`: `unpublished` (empty) or `published` with rank, name, institution; equal score and time share a rank (1, 2, 2, 4); search by name or institution; pages cached per snapshot. Without `exam`: the latest exam with published results. 404 unknown or draft exam |
| `GET /attempts/:id/review` | the attempt's student | `ReviewView`: own score, rank, server time taken, end reason, and per question the options as shown, the student's choice, the correct option and the explanation. 403 `results_not_published`; 404 another student's attempt |
| `GET /admin/leaderboard?exam=` | admin, manager | `AdminExamLeaderboard`: the snapshot with email, category, score and time, and whether it is public |
| `GET /admin/exams/:id/results` | admin | `ExamResultsStatus`: attempts by status, window closed, snapshot generation and time, published or not, `canBuild`, `canPublish` |
| `POST /admin/exams/:id/results/build` | admin | 202 `{queued}`: a rebuild in the worker. 409 `window_open`, `attempts_unfinished` |
| `POST /admin/exams/:id/results/publish`, `/unpublish` | admin | Body `expectedUpdatedAt`. 409 `stale`, `no_snapshot`, `window_open`, `results_published`. Audited (`results.published`, `results.unpublished`) |
| `GET /admin/exams/:id/attempts?status=&endReason=&minViolations=&q=` | admin | `Paginated<AdminAttemptRow>`: each student's status, end reason, violation count, times, score (owner Q4) |
| `GET /admin/exams/:id/attempts/:attemptId` | admin | `AdminAttemptDetail`: the row and its violation and connection events with times (from the submission, or the live checkpoint while running) |

## Exam admin (E1; plan: `docs/plans/EXAM-PLAN.md` §1.2, §4)

`@Roles('admin')` on every route (a manager or student gets 403); each write also re-reads the acting user in the database (a demoted or blocked admin gets 403 even with a valid token). Every write is audit-logged in the same transaction (`exam.*`, `question.*`: admin id, IP, old and new values). Shapes: `AdminExamCard`, `AdminExamView`, `AdminQuestion` in `@sirat/shared`. Refusals that the admin screen must tell apart are 409 with `details`: a list of reason codes.

| Method + path | Body | Rules and answers |
|---|---|---|
| `GET /admin/exams` | — | `Paginated<AdminExamCard>`, newest window first; `q` searches the title; `status` filters. `questionCount` = active questions; `locked` = not a draft |
| `GET /admin/exams/:id` | — | `AdminExamView`: config, `updatedAt` (the concurrency token), active questions **with** correct keys and explanations. 404 if unknown |
| `POST /admin/exams` | `title`, `category` (null = everyone), `roundId` (null or a round), `windowStart`, `windowEnd` (ISO), `durationMinutes` (1–30), `questionsPerAttempt` (1–200), `graceSeconds` (0–300), `randomDraw` | 201 `AdminExamView` of a new `draft`. 400 if the window is not at least one duration long or the round does not exist |
| `PATCH /admin/exams/:id` | `expectedUpdatedAt` + any create field; `reason` for a published exam | Draft: any field. Published: only `title`, and `windowEnd` later than now and than before, while the window is still open (`reason` required). 409 `stale` (someone changed it), 409 `exam_published` / `exam_archived` (field not changeable) |
| `POST /admin/exams/:id/publish` | `expectedUpdatedAt` | Draft → published. 409 with the failed checks: `question_count` (active questions must equal `questionsPerAttempt`, or be at least that with `randomDraw`), `window_too_short`, `window_over`, `duplicate_question_text` |
| `POST /admin/exams/:id/unpublish` | `expectedUpdatedAt` | Published → draft, only before `window_start − 5 min` and without attempts. 409 `window_started` / `has_attempts` |
| `POST /admin/exams/:id/archive` | `expectedUpdatedAt` | A draft, or a published exam whose results are published. 409 `results_not_published` |
| `POST /admin/exams/:id/questions` | `text`, `options` (2–6 `{key: A–Z, text}`, unique keys), `correctKey` (one of the keys), `explanation` (null or text), `keepOptionOrder` | 201 `AdminQuestion`. Draft, or a published exam with `randomDraw`. 409 `pool_fixed` (published without `randomDraw`), `exam_archived` |
| `PUT /admin/exams/:id/questions/:questionId` | the question fields + `expectedUpdatedAt` (the question's) | Draft: edited in place. Published: a **new version** (same lineage and position, version + 1; the old row is deactivated, attempts keep theirs); returns the new `AdminQuestion`. 409 `stale`, `not_active` (already replaced), `exam_archived` |
| `DELETE /admin/exams/:id/questions/:questionId` | — | 204. Draft: deleted. Published: **retired** (deactivated, never deleted), only with `randomDraw` and while at least `questionsPerAttempt` stay active. 409 `pool_fixed`, `pool_too_small`, `not_active`, `exam_archived` |
| `GET /admin/exams/:id/questions/:questionId/versions` | — | Every version of that question's lineage, oldest first, with `isActive` and `deactivatedAt` |

The database enforces the same lock (triggers `exams_frozen_after_publish`, `questions_frozen_after_publish`, `attempts_guard`; `05-DATABASE.md`), so an API bug cannot change a published exam's timing or rewrite an answered question.

## DTO and security rules

* `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Unknown fields are rejected, so `role`, `points`, `rank`, `status` can never be injected.
* Acting user = `req.user` from the verified cookie. Never `user_id` in body/query. Any `:id` is ownership-checked.
* Session: the access token travels only in the httpOnly cookie `sirat_access` (an `Authorization` header is ignored). HS256, issuer `sirat-api`, audience `sirat-web`, 15 min, verified locally; claims `sub`, `role`, `sid`.
* State-changing requests (anything but GET/HEAD/OPTIONS) require a non-empty `X-Requested-With` header (CSRF) on top of SameSite=Lax, public routes included (login CSRF). The API never enables CORS. Only `POST /payments/paystation/ipn` may skip it (`@SkipCsrf()`, reviewed list in the routes test). GET handlers never change state.
* A handler that has not answered within 25 s gets 503 `Request timed out` (nginx gives up at 30 s); every DB statement stops at 10 s.
* Throttle tiers: auth endpoints strict; general API moderate; exam checkpoint/submit keyed by user (not only IP, schools share IPs).
* Responses never include `correct_key`, other users' data, stack traces or raw DB errors.

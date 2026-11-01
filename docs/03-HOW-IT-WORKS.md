# 03 — How the system works (flows)

Server is the authority. "Client" means the Next.js app in the browser.

## 1. Registration + payment (pay-then-account)

1. Student fills the 3-step form (details → education/grade → email+password). Client POSTs it to `POST /api/registrations/start`.
2. Server validates (DTO; **no role field exists**), checks `registration_open` setting, maps `grade_level → category` from the `grade_levels` table, stores the payload in `pending_registrations`, and creates a `payments` row (`initiated`, unique `invoice_number`, amount from settings, `expires_at`).
3. Server calls PayStation `POST /initiate-payment` (form-encoded; `callback_url` carries our invoice number in its path, at most 200 characters); on `status_code` `"200"` returns `payment_url`. Client redirects.
4. Student pays on PayStation. PayStation sends the browser to our `callback_url` (method not documented; GET assumed). The callback, including the invoice in its path, is only a **hint**: we look up the payment by that `invoice_number`, call **transaction-status** (v1, by invoice), and only if `status_code` is `"200"`, lowercased `data.trx_status` is `success` or `successful` **and** amount + invoice match, in ONE transaction: lock payment row → mark `paid` → create user + registration from `pending_registrations` → consume it. Replay is a no-op (unique constraints). Unknown statuses stay pending for reconciliation; `2001` is never treated as failed; an empty `trx_id` is stored as NULL.
5. IPN (`POST /api/payments/paystation/ipn`; URL registered with PayStation; success-only, unsigned, retried on non-2xx) is an extra signal: store it, re-confirm through transaction-status before acting, return 2xx fast (also for duplicates).
6. Reconciliation job (BullMQ repeatable, every 2–5 min) settles any `initiated/pending` payment older than ~2 min by asking PayStation; marks `expired` after the configurable expiry (default 60 min).
7. Page polls `GET /api/payments/:id/status` (our DB only) with backoff; "Check my payment status" button forces a server-side re-check. "My registrations" lets the user resume or restart.
8. Email verification (verify link) is queued. Policy (to confirm): lazy verification — login allowed, exam start requires verified email.

## 2. Login and session

* `POST /api/auth/login` → argon2id verify → issue **access JWT (15 min)** + **refresh token (7 days, random, only its hash stored)** as httpOnly Secure SameSite=Lax cookies. No token in the response body.
* Every request: JWT verified locally (no DB/network call). Role comes from the token claims; sensitive actions re-check the DB.
* `POST /api/auth/refresh`: rotate — new refresh token in same `family_id`, old one revoked. Presenting a revoked token = reuse → revoke the whole family and audit-log.
* Logout revokes the session server-side. "Log out everywhere" and password change revoke all families.
* Login: per-IP and per-account rate limit + progressive delay after repeated failures. Failures go to `audit_logs`.
* Forgot password / resend verification: identical response whether or not the email exists.

## 3. Exam lifecycle (self-paced inside a window)

Config per exam (DB, never constants): `window_start`, `window_end`, `duration_minutes` (**≤ 30**, CHECK constraint), `questions_per_attempt`, `grace_seconds` (default 30).

```
before window_start:  waiting room (login allowed, Start disabled; questions warmed into Redis)
POST /exams/:id/attempts  (Start)
   server: auth + paid registration + verified email + window open + no existing attempt
   → ends_at = min(now + duration, window_end)     [server clock, chrony-synced]
   → draw questions from pool, shuffle order + options, store `layout` on the attempt
   → return questions WITHOUT correct answers + remaining_seconds
every answer change:  saved immediately in browser (IndexedDB/localStorage), nothing sent
every 60–120 s:       PUT /attempts/:id/checkpoint {seq, answers, violationCount, events}
                      → written to Redis only (429 sooner than 20 s after the last); response carries
                        remaining_seconds (client re-syncs timer)
final submit:         POST /attempts/:id/submit {requestId, answers, endReason, violationCount, events}
                      → lock attempt → reject if now > ends_at + grace → insert submission (idempotent)
                      → mark submitted → return receipt → enqueue scoring
time-up (client):     auto-submit CURRENT answers after random 0–20 s delay (spike control)
failure:              keep local copy, retry with backoff until a receipt arrives
resume:               GET /attempts/me?exam=:id → same questions, saved answers (Redis then local), remaining time
no submit (tab closed): the worker's sweep (every minute) submits the last checkpoint once ends_at + grace has
                      passed (`server_checkpoint`; `server_empty` without one), then scores it
```

Load test: `loadtests/exam-simulation.js` runs this flow (steady, the window-open surge, the time-up burst) and checks that no submission is lost and that checkpoints never write to Postgres (`loadtests/README.md`).

Rules: client timer is display-only; `time_taken` is computed by the server; one attempt per student per exam; timer can never be reset; disconnect does not pause the clock. A test must prove auto-submit sends real answers, not `{}`.

## 4. Scoring, results, leaderboard

* Scoring runs in the queue after submit (compares to `questions.correct_key`). No score/correct answers returned at submission.
* Results are computed **after the window has closed for everyone**. A job builds the leaderboard snapshot (rank by score desc, server `time_taken` asc) into Redis/CDN; visitors read the snapshot, paged and searched on the server. Review pages (correct answers, explanations) unlock only after `window_end` for everyone.
* Leaderboard visibility flag (`leaderboard_public`) is enforced on the server.

## 5. Rounds, promotion, jury

* Rounds are rows (`rounds`), not `round_1..3` columns. Round 1 = quiz. Later rounds (video, final) are data-driven.
* Promotion (admin): one transaction, idempotent, `INSERT … ON CONFLICT DO NOTHING` into the next round's `round_entries`, never overwrites videos or jury scores, audit-logged, no promotion past the last round.
* Video round: student submits a link inside the round window (server-enforced). Jury scores 10 criteria (each 0–10, validated); server computes total; every score row records `judge_id` and is append-only (history). Latest score per entry is used.
* Certificates are issued by the server from DB state with a `serial` and public `verification_code` (verification page). Not generated or trusted in the browser.

## 6. Ambassadors, points, teams, tasks

* Ambassador role + dashboard. Admin approval before activation (to confirm).
* Referral = a registration whose payment is `paid` and `referred_by_id` is the ambassador. Referral counts are derived from rows, never a counter.
* Points: append-only `point_ledger`. Each award has a unique `event_key` (`referral_paid:<paymentId>`, `task:<assignmentId>`). Rank = highest `rank_thresholds.min_points ≤ total`; thresholds editable by admin.
* Admin creates tasks, assigns to ambassadors; student submits; admin approves → ledger entry. Nothing is awarded on a client claim.
* Teams: an ambassador creates a team; visible only to members and admins.
* Leaderboards/rank views cached in Redis, server-paged; they must not load the exam path.

## 7. Admin operations

User management (role change only via admin endpoint, audit-logged), exam/question management (lock after publish, versioned), competition settings (single writer, UTC stored, Asia/Dhaka displayed), payments lookup + manual reconcile (audit-logged), announcements, jury assignment, promotion, reset-participant (support tool, audit-logged and heavily guarded), traffic/UTM analytics, audit log viewer.

## 8. i18n and content

Bangla/English via real i18n (`apps/web/src/i18n`). Content, dates, contact details and rules text come from one source (config/CMS/DB), not repeated in components.

# 06 — API surface (planned)

Prefix `/api`. Same origin as the web app. JSON only. Errors use the shape in `@sirat/shared` (`ApiError`). Lists return `Paginated<T>`. Every route has an explicit guard; the allow-list of public routes is below and a CI test fails on any unguarded route not in it (`apps/api/test/app-routes.int-spec.ts`, which also fails on a route registered outside a controller).

Guards: `Public` · `Auth` (valid session) · `Role(...)` · `Owner` (resource belongs to session user, or admin). Built (A2.1a): the global `AuthGuard` is deny by default; `@Public()` opens a route, `@Roles(...)` narrows it to roles from the token. `Owner` is a per-endpoint check in the service.

## Public allow-list (reviewed)

`GET /health`, `GET /ready`, `POST /auth/login`, `POST /auth/refresh` (cookie), `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/2fa/verify` (the `sirat_2fa` challenge cookie from the password step), `POST /registrations/start`, `GET /registrations/info`, `GET /registrations/current`, `POST /registrations/current/{resume,retry,recheck,cancel}` (the `sirat_reg` cookie; no id, no personal data), `GET /payments/paystation/callback/:invoice`, `POST /payments/paystation/ipn` (the only CSRF-exempt route; neither is trusted, see below), `GET /book/cover/:imageId` (the free book's cover image, no personal data), `GET /content/*` (public site content), `GET /certificates/verify/:code`.

## Endpoints

| Module | Method + path | Guard | Notes |
|---|---|---|---|
| auth | `POST /auth/login` | Public, failed-login limits | 204, empty body; sets the httpOnly cookies. 401 one message for any failure; 429 + `Retry-After` during a lock or limit (the password is not checked); 403 for a blocked account, only after the right password. An account with two-factor login on gets **200 `{ "twoFactorRequired": true }`** and the `sirat_2fa` cookie instead, no session and no reset of the failure counts until `POST /auth/2fa/verify` (Two-factor login, below). Built (A2.1d; 2FA: A2) |
| | `POST /auth/refresh` | Public (cookie) | Rotation + reuse detection. 204 + new cookies; 409 = another tab refreshed a moment ago (retry); 503 = the rotation did not finish within its budget, or the database refused for a passing reason, and was rolled back (retry with backoff; the old cookies still work); 401 = log in again (cookies cleared). Built (A2.1b; budget: DECISIONS "Refresh rotation inside a time budget") |
| | `POST /auth/logout`, `POST /auth/logout-all` | Auth | Logout ends this device's session family; logout-all ends all of them (audited). Built (A2.1b) |
| | `GET /auth/me` | Auth | Session user only, read fresh from the DB (`SessionUser`), with `twoFactor: { enabled, required, verified }`; a blocked user gets 401. No writes in GET. Built (A2.1b; 2FA: A2) |
| | `POST /auth/forgot-password`, `POST /auth/resend-verification` | Public; forgot 120/min, resend 300/min per IP; per-address caps | `{email}`. Always 204 at once, empty body; the email (if any) follows from the background. Nothing tells whether the account exists. Built (A2.1e) |
| | `POST /auth/reset-password` | Public, 300/min per IP | `{token, password}`. 204; ends every session, verifies the email, unlocks the account; no login. 400 "This link is invalid or has expired" for every bad link; 400 "Validation failed" for a refused password (the link stays usable). Built (A2.1e) |
| | `POST /auth/verify-email` | Public, 300/min per IP | `{token}`. 204; never logs in (no session, no cookie). One 400 for every bad link. Built (A2.1e) |
| | `POST /auth/change-password` | Auth, login limits | `{currentPassword, newPassword}`. 204 + fresh cookies for this device; one transaction writes the hash, ends every session and retires reset links. 400 for a wrong current password or a refused new one; 429 + `Retry-After` while locked. 401 when the token's session row is no longer alive; 403 `TWO_FACTOR_REQUIRED` (nothing changed) for an enrolled user whose session row did not prove the code. The new session keeps the row's 2FA proof. Built (A2.1d; 2FA rule: A2) |
| | `GET /auth/2fa`, `POST /auth/2fa/{setup,enable,recovery-codes,disable}`, `POST /auth/2fa/verify` | Role(admin, manager) / Public (verify) | Two-factor login (below). Built (A2) |
| users | `GET /users/me`, `PATCH /users/me` | Role(student, ambassador) | Student profile (below). Built (core C3) |
| | `GET /content/profile-options` | Role(student, ambassador, admin) | The form's option lists; admins use them for the grade correction. Built (core C3) |
| registrations | `GET /registrations/info`, `POST /registrations/start`, `GET /registrations/current`, `POST /registrations/current/{resume,retry,cancel}`, `GET /registrations/me` | Public (cookie) / Auth | Registration and payment section below. Built (payments PR 2) |
| payments | `GET /payments/mine`, `GET /payments/:id/status` | Auth / Owner | Built (payments PR 2) |
| | `POST /payments/:id/recheck` | Owner, throttled | Calls PayStation status (payments PR 3) |
| | `GET /payments/paystation/callback/:invoice` | Public | Hint only → status API → settle (payments PR 3) |
| | `POST /payments/paystation/ipn` | Public | Re-confirm via status API; idempotent (payments PR 3) |
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
| announcements | `GET /announcements` | Role(student, ambassador) | Announcements (below). Built (core C4) |
| ambassadors | `GET /ambassador/me` | Role(ambassador) | Ambassadors (below). Built (core C5a) |
| | `POST /ambassador/tasks/:assignmentId/submit`, `POST /ambassador/teams` | Role(ambassador) | Own data only, the ambassador re-read. Built (core C5b-2, C5b-3) |
| teams | `GET /teams/mine`, `POST /teams/join`, `POST /teams/mine/leave` | Role(student, ambassador) | Own team only. Ambassadors (below). Built (core C5b-3) |
| admin (all `Role(admin)` unless noted) | `GET /admin/users`, `GET /admin/users/:id`, `POST /admin/users/export` | admin | Students list (below). Built (core C1) |
| | `POST /admin/users/:id/grade-level` | admin | Student profile (below). Built (core C3) |
| | `POST /admin/users/:id/2fa/reset` | admin with a proved second factor, 5/hour per admin | Two-factor login (below): a lost device. Built (A2) |
| | `PATCH /admin/users/:id`, `POST /admin/users/:id/role` | admin | Audited. Not built (role change and block are later admin writes) |
| | `GET /admin/exams?page=&pageSize=&q=&status=`, `GET /admin/exams/:id`, `POST /admin/exams`, `PATCH /admin/exams/:id`, `POST /admin/exams/:id/{publish,unpublish,archive}`, `POST /admin/exams/:id/questions`, `POST /admin/exams/:id/questions/import?dryRun=`, `PUT`/`DELETE /admin/exams/:id/questions/:questionId`, `GET /admin/exams/:id/questions/:questionId/versions` | admin | Exam admin (below). Lock after publish; questions versioned, never deleted once published. Built (E1; the CSV import E7a) |
| | `GET /admin/settings`, `PUT /admin/settings/:key` | admin | Single writer (`expected`), audited. Built (payments PR 3) |
| | `GET /admin/payments`, `GET /admin/payments/:id`, `POST /admin/payments/:id/{recheck,reconcile}` | admin | Audited. Built (payments PR 3), below |
| | `GET /admin/stats` | admin/manager | Admin statistics (below). Counts only, cached 60 s. Built (core) |
| | `POST /admin/rounds/:id/promote` | admin | Idempotent, audited |
| | `GET/POST /admin/jury/*` | jury/admin | Judge recorded |
| | `GET/POST /admin/announcements`, `PATCH /admin/announcements/:id`, `POST /admin/announcements/:id/{archive,restore}` | admin | Announcements (below). Built (core C4) |
| | `GET /admin/ambassadors`, `POST /admin/ambassadors/:userId/{approve,revoke}` | admin | Ambassadors (below). Built (core C5a) |
| | `GET/PUT /admin/ambassador-points`, `POST /admin/points/adjust` | admin | Points per referral and the ranks (single writer), compensating entries; audited. Built (core C5b-1) |
| | `GET/POST /admin/tasks`, `PATCH /admin/tasks/:id`, `POST /admin/tasks/:id/{archive,restore,assign}`, `GET /admin/task-assignments`, `POST /admin/task-assignments/:id/{approve,reject}` | admin | Ambassador tasks (below), audited; tasks are never deleted. Built (core C5b-2) |
| | `GET /admin/teams`, `GET /admin/teams/:id`, `PATCH /admin/teams/:id` | admin | Ambassador teams (below); a rename is audited with its reason. Built (core C5b-3) |
| | `GET /admin/audit`, `GET /admin/audit/:id`, `POST /admin/audit/export` | admin | Audit log (below). Read only; the export is audited. Built (core) |

## Two-factor login (A2; DECISIONS "Admin two-factor login")

TOTP for admins and managers. While 2FA is on (`TOTP_ENCRYPTION_KEY` set; production requires it), a route whose `@Roles()` names admin or manager refuses an admin or manager session that has not proved the code: 403 `TWO_FACTOR_REQUIRED`. The exceptions (`@TwoFactorOptional()`, reviewed in the routes test) are `GET /auth/me`, `POST /auth/logout`, `GET /auth/2fa`, `POST /auth/2fa/setup` and `POST /auth/2fa/enable`. While it is off (no key: development only) nothing is enforced and every route below answers 503 `TWO_FACTOR_UNAVAILABLE`. Codes, secrets, recovery codes, challenge ids and emails are never logged.

| Method + path | Guard | Body | Answers |
|---|---|---|---|
| `POST /auth/login` (enrolled account) | Public | `{email, password}` | 200 `{ "twoFactorRequired": true }` + `sirat_2fa` (httpOnly, SameSite=Strict, Path `/api/auth/2fa`, Max-Age 300). No session, no reset of the failure counts. A blocked account still gets 403 after the right password |
| `POST /auth/2fa/verify` | Public (the `sirat_2fa` cookie), CSRF header, login limits | `{code}` (6 digits) or `{recoveryCode}` (`XXXXX-XXXXX`, any case, spaces or dash), exactly one | 204 + session cookies (`tfa` true), `sirat_2fa` cleared. 401 `TWO_FACTOR_CODE_INVALID` (counted in the login limits; each verify first reserves one of the challenge's 5 attempts atomically, so at most 5 codes are ever checked, also in parallel; the 5th wrong one ends it); 401 `TWO_FACTOR_CHALLENGE_INVALID` (missing, expired, used or used up; cookie cleared: log in again); 429 + `Retry-After` during a lock, even for the right code. A code works once; two parallel right codes give one session. A recovery code raises the alert `two_factor.recovery_used` |
| `GET /auth/2fa` | Role(admin, manager), 2FA optional | — | `{ enabled, pending, required, verified, recoveryCodesRemaining }` |
| `POST /auth/2fa/setup` | Role(admin, manager), 2FA optional, login limits | `{password}` | 200 `{ otpauthUri, qrDataUri }`: a new secret, shown once, pending until enable (a second setup replaces it). 400 `PASSWORD_INCORRECT`; 409 `TWO_FACTOR_ALREADY_ENABLED`; 429 |
| `POST /auth/2fa/enable` | Role(admin, manager), 2FA optional | `{code}` from the pending secret | 200 `{ recoveryCodes }` (10, shown once) + new session cookies with the proof; every other session of the user ends. 400 `TWO_FACTOR_CODE_INVALID`; the 5th wrong code deletes the pending setup: 409 `TWO_FACTOR_SETUP_REQUIRED` (run setup again; attempts are reserved before the check, so parallel guesses cannot pass 5); 409 `TWO_FACTOR_ALREADY_ENABLED` |
| `POST /auth/2fa/recovery-codes` | Role(admin, manager) with `tfa`, login limits | `{code}` (TOTP only) | 200 `{ recoveryCodes }`: all replaced, shown once. 400 `TWO_FACTOR_CODE_INVALID`; 409 `TWO_FACTOR_NOT_ENABLED`; 429 |
| `POST /auth/2fa/disable` | Role(admin, manager) with `tfa`, login limits | `{password, code}` or `{password, recoveryCode}` | 204 + new session cookies without `tfa` (an admin is then sent to enrolment again); every other session ends. 400 `PASSWORD_INCORRECT` or `TWO_FACTOR_CODE_INVALID`; 429 |
| `POST /admin/users/:id/2fa/reset` | Role(admin) with `tfa`, the role re-read from the database (403 unless still admin); 5/hour per admin; login limits on the step-up | `{reason (3–200), code}`: the ACTING admin's own current TOTP code | 200 `{ sessionsEnded }`: the target's factor and codes removed, all its sessions ended; audit `auth.2fa_reset` with the reason; alert `two_factor.reset`. 403 `TWO_FACTOR_RESET_NOT_ALLOWED` (oneself, or a target that is not admin or manager); 404; 409 `TWO_FACTOR_NOT_ENABLED`; 400 `TWO_FACTOR_CODE_INVALID`; 429 |

- Signed-in step-ups answer 400, never 401, so the web never takes them for an expired session. Only the login's code step answers 401.
- The proof lives on the session row (`two_factor_verified`); the token's `tfa` copies it. `startVerified` after the code step or enable stores true, `start` false. A refresh carries the row's proof AND the user's current enrolment, so it can drop the claim but never raise it. change-password needs a live row, and for an enrolled user a proved one (above). Enable, disable and both resets end the user's other sessions. An access token already issued stays valid until it expires (15 min).
- Break-glass without the API: `pnpm --filter @sirat/api admin:2fa-reset --email <address> --reason "<why>"` (`node dist/cli/admin-2fa-reset.js` on the VPS; RUNBOOK §20).

## Registration and payment (payments PR 2 and 3; plan: `docs/plans/PAYMENTS-PLAN.md` 6.1–6.7)

Pay first, account second: the form waits server-side in a registration attempt; the account is created when a payment is verified paid (by the worker, below). Errors carry a machine code in `ApiError.code` (`RegistrationErrorCode` in `@sirat/shared`; the owner's bn/en texts in `REGISTRATION_MESSAGES`). No route takes an amount, a fee, a role or a status from the browser.

| Method + path | Guard | Request → response |
|---|---|---|
| `GET /registrations/info` | Public; 3,000/min per IP | → `{ open, opensAt, closesAt, fee: { amountMinor, currency } \| null, gradeLevels: [{ id, label }], districts, educationTypes }`. Cached 30 s; `open` is false while the fee is invalid or PayStation is not configured |
| `POST /registrations/start` | Public; 300/min per IP (shared IPs: schools, mobile CGNAT); 10/hour per email and per phone | `{ startRequestId (uuid), name, phone, email, password, district (one of 64), institution, educationType (one of 5), gradeLevelId, promoCode? }` → **201** `{ paymentUrl, invoiceNumber, amountMinor, currency }` and the `sirat_reg` cookie (httpOnly, SameSite=Lax, Path `/api/registrations`, 7 days). Details below |
| `GET /registrations/current` | Public (cookie); 3,000/min per IP | → `{ state: awaiting_payment \| confirming \| completed \| failed \| expired \| needs_help, invoiceNumber, amountMinor, currency, expiresAt, canResume, canRetry }`; 404 `NO_REGISTRATION` without a cookie. No personal data |
| `POST /registrations/current/resume` | Public (cookie) | → 200 `{ paymentUrl }` while the checkout is valid; 409 `NOTHING_TO_RESUME` for a finished attempt or a checkout no longer valid |
| `POST /registrations/current/retry` | Public (cookie); limits as start | After the last payment failed or expired, while registration is open: a new payment with a new invoice → 201 as start; 409 `RETRY_NOT_ALLOWED` while one is active |
| `POST /registrations/current/cancel` | Public (cookie) | 204 and the cookie cleared, only while no payment is active (409 `CANNOT_CANCEL`) |
| `POST /registrations/current/recheck` | Public (cookie); 3,000/min per IP | "Check my payment status": **202** `{ requested }`. Asks the worker to ask PayStation about the latest payment, at most once per 10 s; `requested: false` when throttled or nothing is left to check. The page keeps polling `current`. 404 `NO_REGISTRATION` as above |
| `GET /registrations/me` | Auth | `{ registered: false }` or `{ registered: true, registeredAt, category, gradeLevel, payment: { invoiceNumber, amountMinor, currency, status, paidAt } }` |
| `GET /payments/mine` | Auth | `?page&pageSize` (≤ 50) → `Paginated<{ id, invoiceNumber, amountMinor, currency, status, createdAt, paidAt }>`, only the session user's |
| `GET /payments/:id/status` | Owner | The same item; another user's payment is 404, never 403 |
| `POST /payments/:id/recheck` | Owner | **202** `{ requested }`, as `current/recheck`; another user's payment is 404 |

**The `sirat_reg` cookie** proves "my attempt" before an account exists:
- 32 random bytes; only its SHA-256 is stored, on exactly one attempt;
- httpOnly, SameSite=Lax, `Secure` (`COOKIE_SECURE`; refused as false in production), Path `/api/registrations`, 7 days.

Without it, or with one that matches no attempt (forged, or one the browser expired), every `current/*` route answers **404 `NO_REGISTRATION`**. A cancelled or abandoned attempt answers the same. A completed attempt shows only its state in `current`; `resume` answers 409, and `retry` and `cancel` answer 404. **Tiers:** start and retry 300/min per IP; info, current, resume and cancel 3,000/min per IP. Every non-GET needs `X-Requested-With` (CSRF).

**`POST /registrations/start` in detail:**
- **403 `REGISTRATION_CLOSED`:** the switch is off, or now is outside `registration_opens_at`/`registration_closes_at`. Nothing is written.
- **503 `PAYMENTS_UNAVAILABLE`:** the fee setting is not valid (10–10,000 BDT, whole taka; an operator alert follows), or PayStation is not configured. PayStation is never called.
- **503 `PAYMENTS_PAUSED`:** for 10 minutes after PayStation answered "1001" Invalid Credential (a critical operator alert). Nothing retries blindly.
- **409:**
  - `EMAIL_REGISTERED` / `PHONE_REGISTERED`: an account has that email or phone.
  - `EMAIL_IN_PROGRESS`: another browser has a payment in progress for that email.
  - `PHONE_REGISTERED` also when the phone has an attempt in progress under another email (owner: one text for any phone conflict).
  - `START_IN_PROGRESS`: a parallel submit is still being prepared.
- **The same browser** (its `sirat_reg`), with a payment in progress for the same email, gets that checkout back: 201, no second payment.
- **The same `startRequestId` again** (a double click, a lost response): the same payment, with a fresh cookie token. Used with another email: 400 `START_REQUEST_REUSED`.
- **400:** a validation error, `GRADE_LEVEL_UNKNOWN`, or `PROMO_INVALID` (only an approved ambassador's code; case-insensitive).
- **429 `TOO_MANY_ATTEMPTS`:** over 10 an hour for one email or phone.
- **502 `PAYMENT_START_FAILED`:** PayStation refused or did not answer. The payment is `failed`; the cookie is set, so `retry` works.
- **The payment row** is written before PayStation is called. It snapshots the fee from `settings` (`amount_minor`), the currency, `pay_with_charge = false` and the account label. Its invoice is `PREFIX + yymmdd + 10 random`. The password is stored only as argon2id inside the attempt and cleared at completion.

## PayStation signals and the verify job (payments PR 3; plan 6.2–6.6)

Only the worker asks PayStation (v1 transaction status by invoice), and only its verify job, through one settlement transaction, marks a payment paid or failed. The callback and the IPN are unsigned, so each only records what arrived and asks for a check; neither is ever read as a result.

| Method + path | Guard | Behaviour |
|---|---|---|
| `GET /payments/paystation/callback/:invoice` | Public; 3,000/min per IP | The student's browser back from PayStation (GET, with `status`, `invoice_number`, `trx_id`, `message` appended). Records the query (≤ 10 keys, ≤ 200 characters each) and asks for a check while the payment is watched. Always **303** to `APP_URL/register/result`. An unknown invoice is recorded; a malformed one is only redirected |
| `POST /payments/paystation/ipn` | Public, **CSRF-exempt**; 600/min per IP | JSON, at most 16 KB (413). **200** `{ received: true }` for a processed, duplicate (paid with the same `trx_id`) or unknown invoice; **503** when the database cannot record it, so PayStation retries. Anything else for our invoice asks for a check, even outside the late watch |

**Checks:** one per payment at a time (queue job id); the callback and the IPN share a 30 s window per payment; rechecks have 10 s. Reconciliation runs every 2 minutes for payments older than 2 minutes and for failed/expired checkouts until 48 h after expiry (back-off 2, 2, 5, 10, 30 minutes).

**Outcomes** (in `payment_events`; review reasons on the payment, for the admin list):
- paid only when PayStation reports success with our invoice, our reference (when echoed), a `trx_id` no other payment holds, and exactly our amount;
- money taken always wins: `email_taken`, `phone_taken`, `duplicate_payment`, `abandoned_attempt_paid` are paid but set aside, with a critical alert;
- never paid: `amount_mismatch`, `invoice_mismatch`, `trx_id_reused`, `success_without_trx_id` (critical or warning alert);
- a refund reported for a paid payment changes nothing: `refund_reported`, critical alert (no refund handling).

## Admin payments and settings (payments PR 3; plan 3.4, 6.7)

Role `admin` only (not manager). Writes: 20/min per IP, besides the per-user limit; each is audited.

| Method + path | Request → response |
|---|---|
| `GET /admin/payments` | `?invoice&trx&phone&email&status&review=1&account&page&pageSize` (≤ 50; phone in any Bangladeshi form) → `Paginated<{ id, invoiceNumber, amountMinor, currency, status, trxId, paidAmountMinor, gatewayStatus, gatewayAccount, reviewReason, checkCount, lastCheckedAt, expiresAt, paidAt, createdAt, userId, pendingRegistration: { id, status, email, phone, name } }>`, newest first |
| `GET /admin/payments/:id` | `{ payment, events }`: the last 100 events (source, outcome, status code, trx status, trx id, actor, the stored answer redacted) |
| `POST /admin/payments/:id/recheck` | **202** `{ requested }`: the worker asks PayStation now (any status, e.g. to see a refund). Audit `payments.recheck_requested` |
| `POST /admin/payments/:id/reconcile` | `{ trxId (as PayStation shows it), reason (10–200) }` → 200 `{ applied, payment }`. Only for a pending, failed or expired payment whose automatic check stopped on `success_without_trx_id` **and** whose latest status answer shows a success with our invoice, reference and exactly our amount but no trx_id (lead, 2026-10-31). Then the same settlement as the automatic path. 409 `RECONCILE_NOT_ALLOWED` otherwise; 409 `TRX_ID_IN_USE` for a trx_id another payment holds; a paid payment answers `applied: false` (never a second settle). Audit `payments.reconciled` |
| `GET /admin/settings` | `[{ key, value, updatedAt }]` for the editable keys |
| `PUT /admin/settings/:key` | `{ value, expected, reason? }`. Keys: `registration_fee_minor` (10–10,000 BDT in whole taka, as paisa; `reason` 3–200 required), `registration_open` (boolean), `registration_opens_at` / `registration_closes_at` (ISO UTC or null; opens before closes), `payment_expiry_minutes` (5–1,440). 409 `SETTING_CHANGED` when the value is no longer `expected`; 400 `SETTING_INVALID` / `REASON_REQUIRED`; 404 for any other key. Audit `settings.changed` (old, new, reason); the registration info cache is cleared. Payments already started keep their amount |

## Free book (payments PR 6a; plan: `docs/plans/PAYMENTS-PLAN.md` §16, owner B1–B5)

Every student who paid gets one free book: they confirm a Bangladeshi delivery address and may change it until an admin marks it shipped. Addresses (a minor's personal data) are seen only by the student and by admins, and never logged. Shapes: `packages/shared/src/book.ts`.

**Student** (roles student and ambassador; "me" routes only, no id anywhere):

| Method + path | Request → response |
|---|---|
| `GET /book` | `{ title, coverUrl }` (`/api/book/cover/<id>` or null) |
| `GET /book-order/me` | `{ eligible, order }`: `eligible` once the student has a (paid) registration; `order` is null or `{ status, recipientName, recipientPhone, district, upazila, addressLine, note, bookTitle, version, confirmedAt, shippedAt }` |
| `PUT /book-order/me` | `{ recipientName (1–100), recipientPhone (any Bangladeshi form, stored 01XXXXXXXXX), district (one of the 64), upazila (2–100), addressLine (5–300), note? (≤ 300), expectedVersion? }` → 200 the order. Creates it, or changes the address (version + 1). 403 `BOOK_NOT_ELIGIBLE` without a registration; 409 `BOOK_ORDER_SHIPPED` once shipped; 409 `BOOK_ORDER_CHANGED` for a stale `expectedVersion`; 400 for unknown fields (`role`, `userId`, `status`, `bookTitle` …). The order keeps the title it was confirmed with. Audit `book_order.confirmed` / `book_order.updated` (ids and version only) |
| `GET /book/cover/:imageId` | **Public**; 600/min per IP. The image bytes with the stored, sniffed `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: public, max-age=31536000, immutable`. 404 unknown, 400 malformed id |

**Admin** (role `admin` only; a manager gets 403; writes 20/min per IP):

| Method + path | Request → response |
|---|---|
| `GET /admin/book` | `{ title, cover: { id, url, contentType, width, height, byteSize, uploadedAt } \| null, limits }` |
| `PUT /admin/book/title` | `{ title (1–200), expected (the title the form showed), reason (3–200) }` → as `GET`. 409 `SETTING_CHANGED` when stale. Audit `book.title_changed` (old, new, reason) |
| `POST /admin/book/cover` | multipart, one field `file`. JPEG, PNG or WebP by magic bytes (never the name or the browser's type), ≤ 800 KB (413 above), 100–4000 px a side; metadata stripped; stored once per content. 400 `COVER_MISSING`, `COVER_UNSUPPORTED_TYPE`, `COVER_UNREADABLE`, `COVER_BAD_DIMENSIONS`; 413 `COVER_TOO_LARGE`. Audit `book.cover_changed` (old and new image id, sha256, size, type) |
| `GET /admin/book-orders` | `?page&pageSize (≤ 100)&status&district&phone&email` → `Paginated<order + { id, code, student: { name, email, phone } }>`, newest first. `phone` in any Bangladeshi form matches the recipient's or the student's phone; `email` the student's (any case) |
| `GET /admin/book-orders/export.csv` | `?status&district` → the courier CSV, streamed: Order, Recipient, Phone, District, Upazila/Thana, Address, Note, Book. UTF-8 with a BOM, CRLF, formula-injection safe (`common/csv.ts`), `Content-Disposition: attachment`, `Cache-Control: no-store`; 10/min. Audit `book_orders.exported` (filter and row count, never the rows) |
| `POST /admin/book-orders/ship` | `{ ids (1–500 uuids), reason? }` → `{ shipped }`: confirmed → shipped; already shipped ones are left. Audit `book_orders.shipped` (count, ids, reason) |

## Exam engine (E2; plan: `docs/plans/EXAM-PLAN.md` §1.1, §3, §3.15)

`@Roles('student', 'ambassador')`; each request re-reads the student (a blocked account gets 403 `account_blocked` with a valid token). A student sees published exams for everyone or for their own category; any other exam is 404. Another user's attempt is 404, never 403. Shapes in `@sirat/shared` (`exam.ts`). Refusals carry reason codes in `details`. **No student response contains a question id, an option key, a correct key, an explanation or a score** (`exam-leak.int-spec.ts`).

| Method + path | Body | Answers |
|---|---|---|
| `GET /exams` | — | `StudentExamListItem[]`: card, `state` (`upcoming`/`open`/`in_progress`/`submitted`/`closed`, from the server clock), `resultsPublished` |
| `GET /exams/:id` | — | `StudentExamDetail`: card, grace, `violationWarnings` (5), `serverNow`, the student's own attempt (`attemptId` for the review, `phase`, `endsAt`, receipt) |
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
| `POST /admin/exams/:id/questions/import?dryRun=true\|false` (E7a) | `multipart/form-data`, one field `file`: a CSV of at most 1,000,000 bytes (**413** above; read only after the admin guard). UTF-8 (a BOM is allowed; other bytes are refused, never guessed), RFC 4180. Header row `text,A,B,C,D,E,F,correct,explanation,keep_order`; A and B required, C–F optional without gaps; `correct` a letter of a filled option; sizes as `EXAM_LIMITS`; `keep_order` true, false or empty; no control character in any cell (`CONTROL_CHARACTERS`; tab and line feed allowed); at most 500 data rows; no question twice in the file or already active in the exam (the publish rule's normalisation). `dryRun` is required | Draft exams only: 409 `pool_fixed` (published, even with `randomDraw`), `exam_archived`. Dry run: **200** `QuestionImportPreview` `{rows, errors: [{row, field, code}], truncated}` (at most 200 errors; `row` as a spreadsheet numbers it, header = 1, 0 = the whole file), nothing written. Import: **201** `{created}`, the rows after the existing questions in file order, each its own lineage; **all rows or none**: any problem gives **400** `QUESTION_IMPORT_INVALID` with the same errors in `details` and nothing written. One audit row `question.imported` with `{count, sha256}` of the file, never its content. 20 a minute per admin |

The database enforces the same lock (triggers `exams_frozen_after_publish`, `questions_frozen_after_publish`, `attempts_guard`; `05-DATABASE.md`), so an API bug cannot change a published exam's timing or rewrite an answered question.

## Admin students list (core C1; plan: `docs/plans/CORE-PLAN.md` §2)

`@Roles('admin')` on every route (manager, jury, ambassador and student get 403), and each request re-reads the acting user in the database, so a demoted or blocked admin gets 403 even with a valid token. Read only: `users` and `grade_levels`, payments' `registrations` and `payments`. Shapes `AdminUserRow`, `AdminUserDetail`, `AdminUserQuery` (`dashboard.ts`) and `AdminUserExportRequest` (`core.ts`) in `@sirat/shared`. No response carries a password hash or a token.

| Method + path | Request | Answers |
|---|---|---|
| `GET /admin/users` | `page` (1–10,000), `pageSize` (1–100, default 20), `q` (1–100 characters), `role`, `blocked`, `category`, `registered`, `verified` (booleans as `true`/`false`) | `Paginated<AdminUserRow>`, newest first. `q` matches the name or the email (case-insensitive, contains); also the phone exactly when `q` reads as a Bangladeshi mobile in any form (`normalizeBdMobile`), and the registration's invoice exactly when `q` has the invoice shape. A row: id, name, email, role, blocked, category, district, grade label, created at, `phoneLast3` (the list never carries the full number), `emailVerified`, `registration` (`registeredAt`, `invoiceNumber`, `paymentStatus`, `paidAt`) or null, `needsPaymentReview` (a payment of this user has a review reason; payments' admin page has the details) |
| `GET /admin/users/:id` | — | `AdminUserDetail`: the row plus the full phone, institution, education type, `emailVerifiedAt`, grade level, the registration's payment (status, invoice, amount, currency, paid at), `referredBy` (name, promo code) and `ambassador` (promo code, approved at), each or null. 404 for an unknown id, 400 for a malformed one |
| `POST /admin/users/export` | `{ filters, reason }`: `filters` = the list filters without `page`/`pageSize`; `reason` 3–200 characters | 200 `text/csv; charset=utf-8`, a UTF-8 BOM first (Bangla in Excel), `Content-Disposition: attachment`, `Cache-Control: no-store`. Only `student` and `ambassador` accounts, newest first. Columns: user id, name, email, phone, district, institution, education type, grade level, category, role, blocked, email verified, registered at and paid at (Asia/Dhaka), invoice, amount (BDT), payment status, referrer's promo code. A cell starting with `=`, `+`, `-`, `@`, tab or CR gets a `'` prefix. The audit row `users.exported` (admin, IP, filters with `q` replaced by its kind, row count, reason; never the rows) is written before the first byte: without it, 503 and no file. 400 `too_many_rows` over 50,000 matching rows (narrow the filter). 429 after 5 exports per admin per hour |

POST for the export keeps the reason and the search out of URLs (nginx logs query strings) and puts it behind the CSRF header. The browser calls it through `lib/api.ts` and saves the file; the rows are read in keyset batches of 1,000, so no statement comes near the 10 s timeout.

## Student profile (core C3; plan: `docs/plans/CORE-PLAN.md` §4, owner Q1 default)

`@Roles('student', 'ambassador')` on the student routes (the option lists also admit `admin`); no route takes an id (the user is the session's), and each call re-reads the user (403 `account_blocked` with a valid token). Shapes `StudentProfile`, `ProfileOptions`, `ProfileUpdate` (`dashboard.ts`), `GradeCorrectionRequest` and `PROFILE_REFUSALS` (`core.ts`).

| Method + path | Request | Answers |
|---|---|---|
| `GET /users/me` | — | `StudentProfile`: name, email, phone, district, institution, education type, category, role, `emailVerifiedAt`, `createdAt`, grade level (id, label), `currentRound` (null until rounds exist) |
| `GET /content/profile-options` | — | `ProfileOptions`: grade levels (id, label, category, in order), the 5 education types and the 64 districts (payments' `registration.ts`, one list for registration and profile) |
| `PATCH /users/me` | Any of `name` (2–100), `phone` (any BD form, stored `01XXXXXXXXX`), `district` (one of 64), `institution` (2–150), `educationType` (one of 5); at least one; none can be cleared. The same limits as the registration form | 200 `StudentProfile`. 400 `Validation failed` (details: the field messages) or `nothing_to_update`; any other field (`email`, `gradeLevelId`, `role`, `category`, `promoCode` …) → 400. 409 `PHONE_REGISTERED` (`ApiError.code`, the owner's text in `REGISTRATION_MESSAGES`) when another account has the number or a registration in progress holds it, also when two people claim it at once (the UNIQUE index decides). Audit `user.profile_updated` with the changed field names only, never the values |
| `POST /admin/users/:id/grade-level` (admin) | `{ gradeLevelId, reason }` (reason 3–200) | 200 `StudentProfile` of that student; the category follows the grade table. 409 `has_attempt` once the student has any exam attempt (a category decides the exam), `not_a_student` for staff; 400 `grade_level_unknown`; 404 unknown user. Audit `user.grade_corrected` (old and new label, category, reason) in the same transaction. The admin is re-read |

Email changes are not offered at launch (they need a verified flow with A2's email tokens; core plan Q1).

## Announcements (core C4; plan: `docs/plans/CORE-PLAN.md` §5)

Plain text (line breaks kept, never rendered as HTML), for everyone (`category` null) or one category, shown from `publishedAt`, archived instead of deleted. Shapes `AnnouncementItem` (`dashboard.ts`), `AdminAnnouncement`, `AnnouncementInput`, `AnnouncementPatch`, `ANNOUNCEMENT_LIMITS`, `ANNOUNCEMENT_REFUSALS` (`core.ts`). Every admin call re-reads the admin (a demoted or blocked one gets 403); every write runs in one transaction with its audit row (`announcement.created|updated|archived|restored`: title and changed field names).

| Method + path | Request | Answers |
|---|---|---|
| `GET /announcements` (student, ambassador) | `page`, `pageSize` (≤ 50, default 10) | `Paginated<AnnouncementItem>`: not archived, `publishedAt` ≤ now, for everyone or the student's category, newest first. Cached per category and page in the cache Redis for 60 s; every admin write bumps a generation key, so a change shows at once (a scheduled one appears within 60 s of its time). 403 `account_blocked` |
| `GET /admin/announcements` | `page`, `pageSize` (≤ 50, default 20), `status` (`scheduled`, `published`, `archived`) | `Paginated<AdminAnnouncement>` with the derived `status`, `category`, `archivedAt`, author name, `updatedAt` |
| `POST /admin/announcements` | `{ title (3–150, one line), body (1–5,000, line breaks kept), category (null = everyone; required), publishAt? (ISO; default now) }` | 201 `AdminAnnouncement`. 400 `publish_in_past` (more than 1 minute ago), validation; unknown fields → 400 |
| `PATCH /admin/announcements/:id` | `expectedUpdatedAt` + any create field | 200. 409 `stale` (another admin changed it since the form loaded), `archived`; 400 `nothing_to_update`, `publish_in_past`; 404 |
| `POST /admin/announcements/:id/archive`, `/restore` | `{ expectedUpdatedAt }` | 200. 409 `stale`, `archived` (archive twice), `not_archived` (restore a live one). Nothing is ever deleted |

The database refuses out-of-range text and an archive time before creation (`*_core_announcements_checks`).

## Ambassadors (core C5a; plan: `docs/plans/CORE-PLAN.md` §6, owner Q2 default)

**Attribution only:** a promo code tells which ambassador brought a student; it never changes the fee or any payment amount (a discount would be an owner decision). Payments' registration accepts a code exactly while the ambassador's `approved_at` is set (case-insensitive) and stores the referrer. Revoking clears `approved_at` and keeps the row, so a code is never given to anyone else. Referral counts and points are derived from rows (`users.referred_by_id`, `point_ledger`), never stored. Shapes `AdminAmbassadorRow`, `AmbassadorOverview` (`dashboard.ts`), `AmbassadorState`, `AMBASSADOR_REFUSALS` (`core.ts`).

| Method + path | Request | Answers |
|---|---|---|
| `POST /admin/ambassadors/:userId/approve` (admin, re-read) | `{ reason }` (3–200) | 200 `AmbassadorState`. One transaction locks the student, then creates the profile with a server code (`SR-` + 6 Crockford characters; a collision draws again, at most 3 times) or re-approves the old code, sets `role` to `ambassador` and writes `ambassador.approved` (code, reason). Already approved: 200 and nothing changes. 409 `not_paid_student` (no registration), `blocked`, `wrong_role` (staff); 404. The client never chooses a code (`promoCode` in the body → 400) |
| `POST /admin/ambassadors/:userId/revoke` (admin) | `{ reason }` | 200: `approved_at` cleared, `role` back to `student`, `ambassador.revoked` audited. Earlier referrals and points stay. 409 `not_ambassador` |
| `GET /admin/ambassadors` (admin) | `page`, `pageSize` (≤ 50), `q` (name, email or the exact code), `status` (`approved`, `revoked`) | `Paginated<AdminAmbassadorRow>` with `referralCount`, `points` and `rankName` from the rows and `rank_thresholds` |
| `GET /ambassador/me` (ambassador) | — | `AmbassadorOverview`: code, referral count, the 5 latest referrals (name, institution, date; no contact details), points, rank (current and next threshold); `team` (name, member count, whether the caller leads it; null without a team) and `tasks` (C5b-2). The user is re-read, so a revoked ambassador is refused (403) even with a token minted before the revocation. A newly approved student's token still says `student`: the panel answers that 403 by renewing the token once (`/refresh`), so the panel opens at once |

The database refuses a code outside `^[A-Za-z0-9_-]{3,40}$`, and `point_ledger` refuses UPDATE, DELETE and TRUNCATE (except TRUNCATE in a `*_test` database) (`*_core_ambassador_checks`).

**Points (core C5b-1; owner Q3 defaults until answered: 10 per paid referral, Bronze 0 / Silver 100 / Gold 250).** Shapes `AmbassadorPointsConfig`, `AmbassadorPointsUpdate`, `PointsAdjustRequest`, `PointsAdjustResult`, `AMBASSADOR_POINTS_LIMITS`, `AMBASSADOR_POINTS_REFUSALS` (`core.ts`).

| Method + path | Request | Answers |
|---|---|---|
| `GET /admin/ambassador-points` (admin, re-read) | — | `AmbassadorPointsConfig`: `pointsPerReferral` (the `ambassador_points_per_referral` setting, 10 when missing) and `thresholds` (`rank_thresholds`, lowest first) |
| `PUT /admin/ambassador-points` (admin) | `{ pointsPerReferral (0–1,000), thresholds (1–10 of { name 2–30, minPoints 0–1,000,000 }), expected (the config the admin saw), reason (3–200) }` | 200 the new config. One writer at a time (a transaction advisory lock): 409 `stale` when the current config is not `expected`; 400 `bad_thresholds` unless the first starts at 0, minimums rise and names differ in any case. Audit `ambassador_points.changed` (before, after, reason). A new value counts for later awards only |
| `POST /admin/points/adjust` (admin) | `{ userId, amount (±1–10,000, not 0), reason (3–200) }` | 200 `{ userId, points }` (the total after). A new ledger row `adjust:<uuid>` with the admin as `created_by`; nothing earlier changes. 404 unknown user; 409 `not_ambassador` without an ambassador profile (a revoked one has a profile). Audit `points.adjusted` |

**The referral sweep** (worker, queue `ambassador-points`): every 5 minutes (scheduler `referral-points`) one statement inserts a ledger row `referral_paid:<paymentId>` for each paid registration with a referrer, `ON CONFLICT (event_key) DO NOTHING`, over the registrations of the last 2 days (the whole table on the very first run); every night at 03:45 Asia/Dhaka (`referral-points-backfill`) over every registration. Run twice or by two workers at once, it adds nothing twice. A referral counts even if the ambassador was revoked later; the amount is the setting at sweep time, and 0 awards nothing (a later value back-fills). It reads payments' `registrations` and `users`, and writes only the ledger.

**Tasks (core C5b-2; lead's plan and rules).** Shapes `AdminTaskRow`, `AdminTaskReviewRow`, `TaskAssignResult`, `TaskReviewResult`, `TASK_LIMITS`, `TASK_REFUSALS` (`core.ts`); the panel's `tasks` in `AmbassadorOverview`. All admin routes re-read the admin; every write is audited with ids and statuses only (`task.created`, `.updated`, `.archived`, `.restored`, `.assigned`, `.approved`, `.rejected`, `.submitted`). **The proof is a minor's free text: it is never logged and never written to an audit row** (lead).

| Method + path | Request | Answers |
|---|---|---|
| `GET /admin/tasks` | `status` (`active` default, `archived`), `page`, `pageSize` (≤ 50) | `Paginated<AdminTaskRow>` newest first, with the assignments counted per status |
| `POST /admin/tasks` | `{ title (3–120, one line), description (1–2,000, line breaks kept), points (0–1,000) }` | 201 the task |
| `PATCH /admin/tasks/:id` | any of the fields, `expectedUpdatedAt` | 200; 409 `stale`, `archived`, `nothing_to_update`. A new points value counts for later approvals only |
| `POST /admin/tasks/:id/{archive,restore}` | — | 200; 409 `archived` / `not_archived`. An archived task leaves the panels and takes no proof or assignment |
| `POST /admin/tasks/:id/assign` | `{ userIds (1–50, unique) }` | 200 `{ assigned, alreadyAssigned }`. Approved, unblocked ambassadors only, all or nothing: 409 `not_ambassador`; 409 `archived` |
| `GET /admin/task-assignments` | `page`, `pageSize` | `Paginated<AdminTaskReviewRow>`: submitted proofs, oldest first (admins only; the web shows the proof as plain text, never as a link) |
| `POST /admin/task-assignments/:id/approve` | — | 200 `{ assignmentId, status: 'approved', points }` (the ambassador's total). One transaction with a row lock: the ledger row `task:<assignmentId>` with the task's points, `task_id` and `created_by`, `ON CONFLICT DO NOTHING`. **Final**; a mistake is corrected with "Adjust points". 409 `not_submitted` |
| `POST /admin/task-assignments/:id/reject` | `{ note (3–500) }` | 200; the ambassador sees the note and may submit again. 409 `not_submitted` |
| `POST /ambassador/tasks/:assignmentId/submit` (ambassador, re-read) | `{ proof (1–1,000, plain text) }` | 204. Own assignment only (another's is 404); from `assigned` or `rejected` (409 `not_open`); not for an archived task (409 `archived`); a revoked or blocked ambassador gets 403. 10 per 10 minutes per ambassador (429), on top of the per-user limit |

The database keeps the limits and the status rules (`*_core_ambassador_tasks_checks`): a submitted, approved or rejected assignment has its proof and time; approved exactly when an admin and a time are recorded; rejected has a note.

**Teams (core C5b-3; CORE-PLAN D7, lead's plan and rules).** Shapes `MyTeam`, `AdminTeamRow`, `AdminTeamDetail`, `TeamRenameRequest`, `TEAM_LIMITS`, `TEAM_REFUSALS` (`core.ts`). One team per ambassador, one team per student (the owner is a member), at most 10 members. **Members are minors: the student view carries first names only**, and only the team lead gets the join code. A team whose lead is no longer an approved, unblocked ambassador takes no new members (409 `team_closed`); its members keep it. There is no dissolve in v1. Every write is audited with ids only (`team.created`, `.joined`, `.left`); `team.renamed` keeps the reason, never the names (a minor's free text). Every caller is re-read, so a blocked user or a token with an older role is refused (403).

| Method + path | Request | Answers |
|---|---|---|
| `POST /ambassador/teams` (approved ambassador) | `{ name (3–60, unique in any case) }` | 201 `MyTeam` with the new code `TM-` + 6 characters (Crockford base32, unique, case-insensitive). 409 `already_has_team`, `already_in_team` (a member of another team), `name_taken` |
| `GET /teams/mine` (student, ambassador) | — | `MyTeam`: name, member count, `isOwner`, `joinCode` (the lead only, else null), members by first name with the lead marked. 404 when not in a team |
| `POST /teams/join` | `{ code }` (`TM-` + 6, any case) | 200 `MyTeam`. 404 unknown code; 409 `team_closed`, `already_in_team`, `team_full`. One row lock per team, so two joins never pass 10. **10 attempts per 10 minutes per user (429, the route tier) and 60 per IP** (a cache-Redis counter; Redis trouble lets the attempt through). Refused codes count too, so guessing a code stays slow |
| `POST /teams/mine/leave` | — | 204. 409 `not_in_team`; 409 `owner_cannot_leave` (the lead stays with the team) |
| `GET /admin/teams` (admin, re-read) | `q` (name, 1–60), `page`, `pageSize` (≤ 50) | `Paginated<AdminTeamRow>` newest first: name, lead (id, full name), `open` (the lead still active), member count, times. No join code |
| `GET /admin/teams/:id` (admin) | — | `AdminTeamDetail`: the row plus the members (id, full name, email, joined), oldest first. 404 unknown id (a malformed id is 400; the web asks for none) |
| `PATCH /admin/teams/:id` (admin) | `{ name (3–60), reason (3–200), expectedUpdatedAt }` | 200 the row. A row lock: 409 `stale`, `nothing_to_update`, `name_taken`. Moderation for an unsuitable name |

The database keeps the name length and the code format (`*_core_ambassador_teams_checks`); `teams.name`, `teams.join_code` and `teams.owner_id` are unique, and `team_members.user_id` is unique (one team per student).

## Admin statistics (core; lead 2026-11-01)

`GET /admin/stats` (admin and manager, re-read: a demoted or blocked user gets 403; jury, students and ambassadors get 403, and the web does not call it for jury) → `AdminStats` (`dashboard.ts`). **Counts only**: no name, email, phone, id or money sum. Read from payments' and exam's tables, never written.

| Field | Counted from |
|---|---|
| `totals.registered`, `paid`, `pendingPayments` | `registrations`; payments `paid`; payments `initiated` + `pending` |
| `totals.activeAttempts`, `submittedAttempts` | exam attempts `in_progress`; `submitted` + `expired` + `scored` |
| `totals.secondRound`, `finalists` | `null` until rounds exist (core C6) |
| `registrationsDaily` | `registrations.created_at` per Asia/Dhaka calendar day, the last 45 days, oldest first, with 0 for an empty day |
| `byCategory` | student and ambassador accounts per category |
| `registrationAttempts` | `pending_registrations` per status (`open`, `completed`, `abandoned`, `conflict`) |
| `paymentsByStatus`, `paymentsNeedingReview` | payments per status (`refunded` is never entered); payments with a `review_reason` (payments' "needs review" filter) |
| `ambassadors` | profiles with `approved_at` set, and cleared; students with `referred_by_id` |

All counts come from one `REPEATABLE READ` snapshot, so the totals agree with the breakdowns. The answer is cached in the cache Redis for 60 s (`asOf` is when it was computed); a single-flight lock makes a burst of admins compute once (the others wait up to 5 s for that result). If Redis does not answer, every call reads Postgres. No new index on the other teams' tables: the 45-day `GROUP BY` on `registrations` runs at most once a minute.

## Audit log (core; lead 2026-11-01, M13)

Admins only (re-read: a demoted or blocked admin gets 403; manager, jury, students and ambassadors get 403). Read only: `audit_logs` is append-only. Shapes `AdminAuditRow`, `AdminAuditPage`, `AdminAuditDetail`, `ADMIN_AUDIT_EXPORT`, `AUDIT_ACTION_PATTERN` (`core.ts`).

| Method + path | Request | Answers |
|---|---|---|
| `GET /admin/audit` | `action` (one exact action, or a family such as `auth.*`), `actor` (an account's email, any case, or `system` for rows without an actor), `from`/`to` (Asia/Dhaka dates, both included), `before` (the previous page's `next`), `limit` (1–50, default 25) | `AdminAuditPage`: rows newest first, each with id, time, action, `system`, actor (name and role) or null, entity type and id. **Never the IP, an email or the meta.** An email that belongs to no account matches nothing. 400 `bad_date` (no such day), `bad_range` (from after to), `bad_cursor` |
| `GET /admin/audit/:id` | — | `AdminAuditDetail`: the row plus `ip`, `actorEmail` and `meta`, as written. Opening a row is not audited (as the students' detail, C1). 404; 400 for an id that is not a UUID |
| `POST /admin/audit/export` | the list's filters and `reason` (3–200) | 200 `text/csv` (`no-store`, `attachment`), BOM, CRLF, formula cells escaped: time (Dhaka), action, actor name and role, system, entity type and id, meta. **No IP and no email**; inside the meta every email, Bangladeshi mobile number and IP address is replaced. The export's own row (`audit.exported`: filter kinds with the actor only as `email`/`system`, row count, reason) is written before anything is sent; if it cannot be written, 503 and no file. 400 `too_many_rows` above 50,000; 429 after 5 exports in an hour per admin |

**Paging** is keyset on `(created_at, id)` to the microsecond (the cursor is opaque, checked and never used as SQL), on the index `audit_logs (created_at DESC, id DESC)`; the actor filter uses `audit_logs (actor_id, created_at DESC)` (migration `*_core_audit_index`). A busy log never needs OFFSET.

## DTO and security rules

- Every API answer carries `Cache-Control: no-store` unless the route sets its own (DECISIONS "TLS behind Cloudflare"). HSTS comes from nginx, never from the API.

* `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Unknown fields are rejected, so `role`, `points`, `rank`, `status` can never be injected.
* Acting user = `req.user` from the verified cookie. Never `user_id` in body/query. Any `:id` is ownership-checked.
* Session: the access token travels only in the httpOnly cookie `sirat_access` (an `Authorization` header is ignored). HS256, issuer `sirat-api`, audience `sirat-web`, 15 min, verified locally; claims `sub`, `role`, `sid`, `tfa` (the session proved a second factor; missing = false).
* State-changing requests (anything but GET/HEAD/OPTIONS) require a non-empty `X-Requested-With` header (CSRF) on top of SameSite=Lax, public routes included (login CSRF). The API never enables CORS. Only `POST /payments/paystation/ipn` may skip it (`@SkipCsrf()`, reviewed list in the routes test). GET handlers never change state.
* A handler that has not answered within 25 s gets 503 `Request timed out` (nginx gives up at 30 s); every DB statement stops at 10 s.
* Throttle tiers (DECISIONS "Per-user API limits"): a request with a verified session counts against its user, 120/min per route; anything else counts against the client IP, 600/min per route by default. Anonymous auth routes: login has no request limit (the login limiter counts failures), refresh 3,000/min, forgot-password 120/min, resend/reset/verify 300/min each; `POST /auth/2fa/verify` has the per-IP default (the login limiter counts its failures). The admin 2FA reset: 5/hour per admin. Exam checkpoint/submit fall under the per-user limit (schools and mobile operators share IPs).
* Responses never include `correct_key`, other users' data, stack traces or raw DB errors.

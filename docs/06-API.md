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
| exams | `GET /exams`, `GET /exams/next`, `GET /exams/:id` | Role(student, ambassador) | Window state, never questions. Exam engine (below). Built (E2; `next` for the admit card, 10 Nov) |
| attempts | `POST /exams/:id/attempts` | Role(student, ambassador) + verified email + paid registration | Start or resume (server clock). Built (E2) |
| | `GET /attempts/me?exam=:id` | Owner | Resume. Built (E2) |
| | `PUT /attempts/:id/checkpoint` | Owner | Redis only. Built (E2) |
| | `POST /attempts/:id/submit` | Owner | Idempotent by attempt and `requestId`. Built (E2) |
| | `GET /attempts/:id/review` | Owner, Role(student, ambassador) | 403 `results_not_published` until the exam's results are published (never before the window closed for everyone). Results (below). Built (E3) |
| leaderboard | `GET /leaderboard?exam=&page=&pageSize=&q=` | Auth | Published snapshot only; rank, name, institution. Results (below). Built (E3) |
| | `GET /admin/leaderboard?exam=&page=&pageSize=&q=` | Role(admin, manager) | The snapshot with email, score and time, also before publishing. Built (E3) |
| | `GET /admin/exams/:id/results`, `POST /admin/exams/:id/results/{build,publish,unpublish}`, `GET /admin/exams/:id/attempts[/:attemptId]` | admin | Results (below). Built (E3) |
| rounds | `GET /rounds/me` | Role(student, ambassador) | Rounds (below). Built (core C6a) |
| | `PUT /rounds/:id/video` | Role(student, ambassador) | Own entry, inside the window. Rounds (below). Built (core C6b) |
| jury | `GET /jury/rounds`, `GET /jury/entries`, `POST /jury/entries/:entryId/scores` | Role(jury) | Own rounds and categories only, blind. Rounds (below). Built (core C6b) |
| certificates | `GET /certificates/mine` | Role(student, ambassador) | Certificates (below). Built (core C6c-1) |
| | `GET /certificates/verify/:code` | Public | Name and award only; the same 404 for unknown and revoked; 30/min per IP. Built (core C6c-1) |
| | `GET /certificates/:id/pdf` | Owner | Core C6c-2 (the PDF library waits for the owner) |
| | `POST /admin/certificates/issue`, `GET /admin/certificates`, `POST /admin/certificates/:id/revoke` | admin | Certificates (below): issuing in the queue, revoke with a reason, audited. Built (core C6c-1) |
| announcements | `GET /announcements` | Role(student, ambassador) | Announcements (below). Built (core C4) |
| ambassadors | `GET /ambassador/me` | Role(ambassador) | Ambassadors (below). Built (core C5a) |
| | `POST /ambassador/tasks/:assignmentId/submit`, `POST /ambassador/teams` | Role(ambassador) | Own data only, the ambassador re-read. Built (core C5b-2, C5b-3) |
| teams | `GET /teams/mine`, `POST /teams/join`, `POST /teams/mine/leave` | Role(student, ambassador) | Own team only. Ambassadors (below). Built (core C5b-3) |
| admin (all `Role(admin)` unless noted) | `GET /admin/users`, `GET /admin/users/:id`, `POST /admin/users/export` | admin | Students list (below). Built (core C1) |
| | `POST /admin/users/:id/grade-level` | admin | Student profile (below). Built (core C3) |
| | `POST /admin/users/:id/2fa/reset` | admin with a proved second factor, 5/hour per admin | Two-factor login (below): a lost device. Built (A2) |
| | `POST /admin/users/:id/participant-id` | admin, 20/min per IP | Issue a new participant ID (payments P1b). Body `{ reason (10–200) }` → 200 `{ reissued: true, sessionsEnded, emailQueued }`: the database draws a new ID (the same prefix, never the old one), every session of the student ends, audit `payments.participant_id_reissued` with the reason and the count (never an ID), and the new ID is emailed to the student only (key `participant-id-reissued.<auditId>`). The answer never carries the ID. 404 without a registration; 400 for the reason or an unknown field |
| | `GET/PUT /admin/security/two-factor-requirement` | admin; the PUT with a proved second factor whatever the requirement says, 5/hour per admin | Two-factor login (below): which roles must prove the code. Built (A2) |
| | `PATCH /admin/users/:id`, `POST /admin/users/:id/role` | admin | Audited. Not built (role change and block are later admin writes) |
| | `GET /admin/exams?page=&pageSize=&q=&status=`, `GET /admin/exams/:id`, `POST /admin/exams`, `PATCH /admin/exams/:id`, `POST /admin/exams/:id/{publish,unpublish,archive}`, `POST /admin/exams/:id/questions`, `POST /admin/exams/:id/questions/import?dryRun=`, `PUT`/`DELETE /admin/exams/:id/questions/:questionId`, `GET /admin/exams/:id/questions/:questionId/versions` | admin | Exam admin (below). Lock after publish; questions versioned, never deleted once published. Built (E1; the CSV import E7a) |
| | `GET /admin/settings`, `PUT /admin/settings/:key` | admin | Single writer (`expected`), audited. Built (payments PR 3) |
| | `GET /admin/payments`, `GET /admin/payments/:id`, `POST /admin/payments/:id/{recheck,reconcile}` | admin | Audited. Built (payments PR 3), below |
| | `GET /admin/stats` | admin/manager | Admin statistics (below). Counts only, cached 60 s. Built (core) |
| | `GET/POST /admin/rounds`, `GET/PATCH /admin/rounds/:id`, `POST /admin/rounds/:id/promotion/preview`, `POST /admin/rounds/:id/promotion` | admin | Rounds (below): one promotion per round and category, audited. Built (core C6a) |
| | `GET/POST /admin/rounds/:id/jury`, `DELETE /admin/rounds/:id/jury/:assignmentId` | admin | Jury assignment per category, audited. Built (core C6b) |
| | `GET/POST /admin/announcements`, `PATCH /admin/announcements/:id`, `POST /admin/announcements/:id/{archive,restore}` | admin | Announcements (below). Built (core C4) |
| | `GET /admin/ambassadors`, `POST /admin/ambassadors/:userId/{approve,revoke}` | admin | Ambassadors (below). Built (core C5a) |
| | `GET/PUT /admin/ambassador-points`, `POST /admin/points/adjust` | admin | Points per referral and the ranks (single writer), compensating entries; audited. Built (core C5b-1) |
| | `GET/POST /admin/tasks`, `PATCH /admin/tasks/:id`, `POST /admin/tasks/:id/{archive,restore,assign}`, `GET /admin/task-assignments`, `POST /admin/task-assignments/:id/{approve,reject}` | admin | Ambassador tasks (below), audited; tasks are never deleted. Built (core C5b-2) |
| | `GET /admin/teams`, `GET /admin/teams/:id`, `PATCH /admin/teams/:id` | admin | Ambassador teams (below); a rename is audited with its reason. Built (core C5b-3) |
| | `GET /admin/audit`, `GET /admin/audit/:id`, `POST /admin/audit/export` | admin | Audit log (below). Read only; the export is audited. Built (core) |

## Two-factor login (A2; DECISIONS "Admin two-factor login")

TOTP for admins and managers. While 2FA is on (`TOTP_ENCRYPTION_KEY` set; production requires it), a route whose `@Roles()` names admin or manager refuses an admin or manager session that has not proved the code when the **requirement** names its role: 403 `TWO_FACTOR_REQUIRED`. The exceptions (`@TwoFactorOptional()`, reviewed in the routes test) are `GET /auth/me`, `POST /auth/logout`, `GET /auth/2fa`, `POST /auth/2fa/setup` and `POST /auth/2fa/enable`. While it is off (no key: development only) nothing is enforced and every route below but the requirement's GET answers 503 `TWO_FACTOR_UNAVAILABLE`. Codes, secrets, recovery codes, challenge ids and emails are never logged.

**Enrollable and required** (DECISIONS "The admin 2FA requirement is a setting"):
- *Enrollable* = 2FA on and the role is admin or manager (in code; jury later). It drives the login's code step: an enrolled admin or manager **always** gets it, whatever the requirement says.
- *Required* = enrollable and the role is named in `settings.two_factor_required_roles` (a JSON array within `["admin","manager"]`, default both; a DB CHECK holds it there). It drives only the guard's 403 and `required` in `GET /auth/2fa` and `/auth/me`. A missing or unreadable row, or a failed read, counts as required (fail closed).
- Each API replica keeps what it read for 5 s (`REQUIREMENT_CACHE_MS`); a change through the PUT drops that replica's copy at once, the others follow within 5 s. No logout, no token change. Switching it never touches an enrolment, a secret, a recovery code or a session.
- `@TwoFactorAlways()` (reviewed in the routes test: exactly the requirement's PUT) demands the proof even while the requirement is off. The generic `PUT /admin/settings/:key` refuses the key (404).

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
| `GET /admin/security/two-factor-requirement` | Role(admin) (a manager gets 403); `tfa` only while the requirement names admin | — | 200 `{ roles, updatedAt (ISO, or null while the row is missing and the default applies), available (2FA on) }`, read fresh from the row. Also while 2FA is off (`available` false) |
| `PUT /admin/security/two-factor-requirement` | Role(admin) with `tfa` even while the requirement is off (`@TwoFactorAlways`), the role re-read from the database (403 unless still admin); 5/hour per admin; login limits on the step-up | `{roles, expected, reason (3–200), code}`: `roles` and `expected` are arrays of `admin`/`manager` (an unknown role: 400); `code` is the ACTING admin's own current TOTP code | 200 `{ roles, updatedAt }`. In one transaction with the code's use: the row locked (inserted with the default if missing), `expected` compared with the current set as sorted unique sets (409 `TWO_FACTOR_REQUIREMENT_CHANGED`, nothing used or written), the value and the audit row `security.two_factor_requirement_changed` `{ from, to, reason }`. Then the alert `two_factor.requirement_changed` (actor and from → to only). A change to the current set answers 200 and writes nothing. 400 `TWO_FACTOR_CODE_INVALID`; 429; 503 `TWO_FACTOR_UNAVAILABLE` while 2FA is off |

- Signed-in step-ups answer 400, never 401, so the web never takes them for an expired session. Only the login's code step answers 401.
- The proof lives on the session row (`two_factor_verified`); the token's `tfa` copies it. `startVerified` after the code step or enable stores true, `start` false. A refresh carries the row's proof AND the user's current enrolment, so it can drop the claim but never raise it. change-password needs a live row, and for an enrolled user a proved one (above). Enable, disable and both resets end the user's other sessions. An access token already issued stays valid until it expires (15 min).
- Break-glass without the API: `pnpm --filter @sirat/api admin:2fa-reset --email <address> --reason "<why>"` (`node dist/cli/admin-2fa-reset.js` on the VPS; RUNBOOK §22).
- The requirement without the API: `pnpm --filter @sirat/api admin:2fa-requirement --roles "admin,manager" | --roles "" --reason "<why>"` (`node dist/cli/admin-2fa-requirement.js` on the VPS; RUNBOOK §22). Audited with `via: 'cli'` and no actor; the same alert; prints only the new set. `scripts/prelaunch-check.sh` FAILs while the value lacks admin or manager.

## Registration and payment (payments PR 2 and 3; plan: `docs/plans/PAYMENTS-PLAN.md` 6.1–6.7)

Pay first, account second: the form waits server-side in a registration attempt; the account is created when a payment is verified paid (by the worker, below). Errors carry a machine code in `ApiError.code` (`RegistrationErrorCode` in `@sirat/shared`; the owner's bn/en texts in `REGISTRATION_MESSAGES`). No route takes an amount, a fee, a role or a status from the browser.

| Method + path | Guard | Request → response |
|---|---|---|
| `GET /registrations/info` | Public; 3,000/min per IP | → `{ open, opensAt, closesAt, fee: { amountMinor, currency } \| null, gradeLevels: [{ id, label }], districts, educationTypes }`. Cached 30 s; `open` is false while the fee is invalid or PayStation is not configured |
| `POST /registrations/start` | Public; 300/min per IP (shared IPs: schools, mobile CGNAT); 10/hour per email and per phone | `{ startRequestId (uuid), name, phone, email, password, district (one of 64), institution, educationType (one of 5), gradeLevelId, promoCode? }` → **201** `{ paymentUrl, gateway, invoiceNumber, amountMinor, currency }` and the `sirat_reg` cookie (httpOnly, SameSite=Lax, Path `/api/registrations`, 7 days). Details below |
| `GET /registrations/current` | Public (cookie); 3,000/min per IP | → `{ state: awaiting_payment \| confirming \| completed \| failed \| expired \| needs_help, invoiceNumber, amountMinor, currency, expiresAt, canResume, canRetry, participantId }`; 404 `NO_REGISTRATION` without a cookie. No personal data. `participantId` is the new participant ID only while `completed` and for 24 hours after (`PARTICIPANT_ID_SHOWN_HOURS`: the cookie can outlive the visit on a shared computer; the email and the dashboard keep it), else null |
| `POST /registrations/current/resume` | Public (cookie) | → 200 `{ paymentUrl, gateway }` while the checkout is valid; 409 `NOTHING_TO_RESUME` for a finished attempt or a checkout no longer valid |
| `POST /registrations/current/retry` | Public (cookie); limits as start | After the last payment failed or expired, while registration is open: a new payment with a new invoice → 201 as start; 409 `RETRY_NOT_ALLOWED` while one is active |
| `POST /registrations/current/cancel` | Public (cookie) | 204 and the cookie cleared, only while no payment is active (409 `CANNOT_CANCEL`) |
| `POST /registrations/current/recheck` | Public (cookie); 3,000/min per IP | "Check my payment status": **202** `{ requested }`. Asks the worker to ask PayStation about the latest payment, at most once per 10 s; `requested: false` when throttled or nothing is left to check. The page keeps polling `current`. 404 `NO_REGISTRATION` as above |
| `GET /registrations/me` | Auth | `{ registered: false }` or `{ registered: true, registeredAt, participantId, category, gradeLevel, payment: { invoiceNumber, amountMinor, currency, status, paidAt } }`. `participantId` is canonical (`ON48210937552`); show it with `formatParticipantId` |
| `GET /payments/mine` | Auth | `?page&pageSize` (≤ 50) → `Paginated<{ id, invoiceNumber, amountMinor, currency, status, createdAt, paidAt }>`, only the session user's |
| `GET /payments/:id/status` | Owner | The same item; another user's payment is 404, never 403 |
| `POST /payments/:id/recheck` | Owner | **202** `{ requested }`, as `current/recheck`; another user's payment is 404 |

**The `sirat_reg` cookie** proves "my attempt" before an account exists:
- 32 random bytes; only its SHA-256 is stored, on exactly one attempt;
- httpOnly, SameSite=Lax, `Secure` (`COOKIE_SECURE`; refused as false in production), Path `/api/registrations`, 7 days.

Without it, or with one that matches no attempt (forged, or one the browser expired), every `current/*` route answers **404 `NO_REGISTRATION`**. A cancelled or abandoned attempt answers the same. A completed attempt shows only its state in `current`; `resume` answers 409, and `retry` and `cancel` answer 404. **Tiers:** start and retry 300/min per IP; info, current, resume and cancel 3,000/min per IP. Every non-GET needs `X-Requested-With` (CSRF).

**`gateway`** (start, retry, resume) says which checkout `paymentUrl` opens:
- `'paystation'`: the browser follows it over https only, in every build;
- `'fake'`: the dev/CI fake server; http is allowed. The API sends it only while `PAYSTATION_ENV=fake`, which it refuses with `NODE_ENV=production`.

The web refuses any other scheme, a relative URL and an unknown gateway. An answer without `gateway` counts as `'paystation'` (`apps/web/src/components/registration/checkout.ts`).

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
- **400:** a validation error, `GRADE_LEVEL_UNKNOWN`, or `PROMO_INVALID` (only an approved ambassador's code; case-insensitive; a demo account's code counts as unknown). An email on the demo marker domain (`DEMO_EMAIL_DOMAIN`, exactly `@demo.sirat.invalid`) is a validation error like any invalid address, so no real registration can look like demo data.
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
| `POST /admin/payments/:id/recheck` | **202** `{ requested }`: the worker asks PayStation now (any status, e.g. to see a refund). Audit `payments.recheck_requested`. 409 `DEMO_PAYMENT` for demo data (never sent to PayStation) |
| `POST /admin/payments/:id/reconcile` | `{ trxId (as PayStation shows it), reason (10–200) }` → 200 `{ applied, payment }`. Only for a pending, failed or expired payment whose automatic check stopped on `success_without_trx_id` **and** whose latest status answer shows a success with our invoice, reference and exactly our amount but no trx_id (lead, 2026-10-31). Then the same settlement as the automatic path. 409 `RECONCILE_NOT_ALLOWED` otherwise; 409 `TRX_ID_IN_USE` for a trx_id another payment holds; a paid payment answers `applied: false` (never a second settle); 409 `DEMO_PAYMENT` for demo data. Audit `payments.reconciled` |
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

`@Roles('student', 'ambassador')`; each request re-reads the student (a blocked account gets 403 `account_blocked` with a valid token). A student sees published exams for everyone or for their own category; any other exam is 404. **The round rule** (lead, 10 Nov): an exam in a round that is not its side's first round (the real Round 1, the demo's own Round 1) is visible and startable only to students with a non-eliminated `round_entries` row in that round; others get the same 404. One predicate (`visibleTo` / `roundOpenTo`, `student-access.ts`) serves the list, the waiting room, the start and `nextExamFor`. Another user's attempt is 404, never 403. Shapes in `@sirat/shared` (`exam.ts`). Refusals carry reason codes in `details`. **No student response contains a question id, an option key, a correct key, an explanation or a score** (`exam-leak.int-spec.ts`).

| Method + path | Body | Answers |
|---|---|---|
| `GET /exams` | — | `StudentExamListItem[]`: card, `state` (`upcoming`/`open`/`in_progress`/`submitted`/`closed`, from the server clock), `resultsPublished` |
| `GET /exams/next` | — | `{ exam: StudentNextExam \| null }`: the next olympiad exam for the admit card's countdown, i.e. the published exam of a round whose window has not ended, nearest start first, among the student's visible exams (their category or everyone; demo and real apart). Never a practice exam (no round), a draft or an ended exam; nothing about attempts or scores. `windowStart` is the printed date and the countdown target, `windowEnd` the "until". `exam: null` = to be announced. The same as `nextExamFor(prisma, userId)` (`modules/exams/next-exam.ts`), which the PDF renderer calls without HTTP |
| `GET /exams/:id` | — | `StudentExamDetail`: card, grace, `violationWarnings` (5), `serverNow`, the student's own attempt (`attemptId` for the review, `phase`, `endsAt`, receipt) |
| `POST /exams/:id/attempts` | — | 201 new / 200 existing `AttemptView`: questions as texts in this attempt's order, options as texts in their shuffled order, `remainingSeconds` and `serverNow` from the server, the last checkpoint's answers and the server's violation count. 403 `email_unverified`, `registration_required` (no paid registration: read only from payments' tables); 409 `not_open_yet` / `window_closed`. An existing attempt in any phase answers 200 (a submitted one carries its receipt and no questions) |
| `GET /attempts/me?exam=:id` | — | The same `AttemptView` (resume after a reload or on another device); 404 when none |
| `PUT /attempts/:id/checkpoint` | `seq`, `answers` (one option position or null per question), `violationCount`, `events` (≤ 300 `{type, at}`) | Redis only, no database write. 200 `{savedSeq, violationCount, remainingSeconds, serverNow}`; an older `seq` changes nothing. 429 `too_soon` + `Retry-After` within 20 s of the last stored checkpoint (the violation count is kept even then; it never goes down). 409 `time_over` (after `ends_at` + grace), `already_submitted`; 400 `answers_invalid`; 503 `checkpoint_unavailable` (the client keeps its local copy and retries) |
| `POST /attempts/:id/submit` | `requestId` (uuid), `answers`, `endReason` (`submitted`, `time_up`, `violations`), `violationCount`, `events` | One transaction. 200 `{receiptId, submittedAt, endReason, alreadySubmitted}`; a repeat answers the first receipt. 409 `time_over` (after `ends_at` + grace), `request_id_conflict`; 400 `answers_invalid`, `violations_not_reached` (`violations` needs more than 5). `time_taken` is computed by the server and never passes `ends_at` |

## Results (E3; plan: `docs/plans/EXAM-PLAN.md` §3.9–3.12, owner Q4, Q5)

Scoring and the snapshot run in the worker (queue `exam`): each submit queues `score-attempt`; a sweep every minute submits attempts that are still running past `ends_at + grace + 30 s` from their last checkpoint (`server_checkpoint`) or empty (`server_empty`), scores anything left unscored, and builds the snapshot of a closed exam once nothing is unfinished. Students see no score, time or email of anyone, and nothing of their own before the results are published (the database refuses publishing before `window_end + grace`). Refusal codes in `details`.

| Method + path | Who | Answers |
|---|---|---|
| `GET /leaderboard?exam=` | any signed-in user | `ExamLeaderboard`: `unpublished` (empty) or `published` with rank, name, institution; equal score and time share a rank (1, 2, 2, 4); search by name or institution; pages cached per snapshot. Without `exam`: the latest exam with published results. 404 unknown or draft exam. Demo data (below): a demo account sees only demo exams' boards and everyone else only real ones; the other side's exam is the same 404 |
| `GET /attempts/:id/review` | the attempt's student | `ReviewView`: own score, rank, server time taken, end reason, and per question the options as shown, the student's choice, the correct option and the explanation. 403 `results_not_published`; 404 another student's attempt |
| `GET /admin/leaderboard?exam=` | admin, manager | `AdminExamLeaderboard`: the snapshot with email, category, score and time, and whether it is public |
| `GET /admin/exams/:id/results` | admin | `ExamResultsStatus`: attempts by status, window closed, snapshot generation and time, published or not, `canBuild`, `canPublish`; after an answer-key correction (E7b): `keyCorrectedAt`, `rescorePending` (scored attempts not yet re-scored after the newest correction), `snapshotStale` (the snapshot is older than it), `lastCorrection` (position, from → to, and once nothing is pending how many attempts were re-scored and how many scores changed) |
| `POST /admin/exams/:id/results/build` | admin | 202 `{queued}`: a rebuild in the worker. 409 `window_open`, `rescore_pending`, `attempts_unfinished` |
| `POST /admin/exams/:id/results/publish`, `/unpublish` | admin | Body `expectedUpdatedAt`. 409 `stale`, `no_snapshot`, `window_open`, `snapshot_stale` (a correction is newer than the snapshot), `results_published`. Audited (`results.published`, `results.unpublished`) |
| `POST /admin/exams/:id/questions/:questionId/key-corrections` | admin | E7b. Body `toKey` (`^[A-Z]$`), `reason` (3–200, trimmed, no control characters), `expectedUpdatedAt` (the exam's). 201 `AnswerKeyCorrectionView` (`fromKey` is the key in effect before). The question row is not changed; the corrected key is used from then on by scoring, the re-scoring, the review and the admin views. 409 `stale`, `exam_draft` (edit the question instead), `exam_archived`, `results_published` (unpublish first), `same_key`, `key_unknown` (not an option of that version); 404 `question_not_in_exam`. Queues `rescore-exam` (jobId `rescore.<exam>.<correction>`); the minute sweep catches up a lost or failed one after 2 minutes. Audited (`answer_key.corrected`; the job writes `answer_key.rescored` per batch with its counts). Bumps the exam's `updatedAt`. `GET /admin/exams/:id` lists the corrections (`keyCorrections`, newest first) |
| `GET /admin/exams/:id/attempts?status=&endReason=&minViolations=&q=` | admin | `Paginated<AdminAttemptRow>`: each student's status, end reason, violation count, times, score (owner Q4) |
| `GET /admin/exams/:id/attempts/:attemptId` | admin | `AdminAttemptDetail`: the row and its violation and connection events with times (from the submission, or the live checkpoint while running) |

## Exam admin (E1; plan: `docs/plans/EXAM-PLAN.md` §1.2, §4)

`@Roles('admin')` on every route (a manager or student gets 403); each write also re-reads the acting user in the database (a demoted or blocked admin gets 403 even with a valid token). Every write is audit-logged in the same transaction (`exam.*`, `question.*`: admin id, IP, old and new values). Shapes: `AdminExamCard`, `AdminExamView`, `AdminQuestion` in `@sirat/shared`. Refusals that the admin screen must tell apart are 409 with `details`: a list of reason codes.

| Method + path | Body | Rules and answers |
|---|---|---|
| `GET /admin/exams` | — | `Paginated<AdminExamCard>`, newest window first; `q` searches the title; `status` filters. `questionCount` = active questions; `locked` = not a draft |
| `GET /admin/exams/:id` | — | `AdminExamView`: config, `updatedAt` (the concurrency token), active questions **with** correct keys and explanations. 404 if unknown |
| `GET /admin/exams/:id/preview` | — | D2 (P1). `AdminExamPreview`: one sample draw made with the start's own `drawLayout` and `renderQuestions` (random draw, option shuffle, kept orders), the texts in that order, and `correct` (displayed positions, with the key in effect after E7b corrections). Writes nothing: no attempt, checkpoint, cache or audit row; each call is a new draw. A draft with a short pool shows what it has; a published exam with a short pool is 409 `question_count`. 404 if unknown |
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
| `GET /users/me` | — | `StudentProfile`: name, email, phone, district, institution, education type, category, role, `emailVerifiedAt`, `createdAt`, grade level (id, label), `currentRound` (the round of `GET /rounds/me`: id and name) |
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
| `GET /admin/ambassadors` (admin) | `page`, `pageSize` (≤ 50), `q` (name, email or the exact code), `status` (`approved`, `revoked`), `sort` (`newest` default, `points`: the most points first, ties newest first) | `Paginated<AdminAmbassadorRow>` with `referralCount`, `points` and `rankName` from the rows and `rank_thresholds`; `demo` marks a demo account (the admin list shows a badge) |
| `GET /ambassador/me` (ambassador) | — | `AmbassadorOverview`: code, the caller's own participant ID **masked** (`participantIdMasked`, e.g. `ON •••• •••• 552`: the prefix and the last 3 only; payments' registration, read only; for the ID card. The full ID is the login secret and never comes here), referral count, the 5 latest referrals (name, institution, date; no contact details), points, rank (current and next threshold); `team` (name, member count, whether the caller leads it; null without a team) and `tasks` (C5b-2). The user is re-read, so a revoked ambassador is refused (403) even with a token minted before the revocation. A newly approved student's token still says `student`: the panel answers that 403 by renewing the token once (`/refresh`), so the panel opens at once |

**The ambassador leaderboard (core A4; the lead's approval of 2026-11-10).** `GET /ambassador/leaderboard` (ambassador, re-read: a revoked or blocked one gets 403) with `page`, `pageSize` (≤ 50) → `AmbassadorLeaderboard` (`core.ts`): `items` of `{ rank, name, institution, points, tier, isMe }`, `page`, `pageSize`, `total`, `me` (the caller's own `{ rank, points }`, also off the page; null while not ranked) and `asOf`.
- Ranked: approved, unblocked ambassadors of the caller's side (demo data never ranks with real), by the ledger's sum; equal points share a rank (1, 2, 2, 4), then by name.
- The name and institution as the exam board shows them (OPEN-QUESTIONS #10), the points and the tier (`rank_thresholds`). No id, email, phone, code or referral list.
- Cached per side for 60 s in the cache Redis (`ambassador-leaderboard:v1:{real|demo}`) with a single-flight lock. Core's own writes drop it at once: approve and revoke, a points adjustment, a points or thresholds change, a task approval. The referral sweep's points show within the minute. Without Redis it is read from Postgres on every call.
- Admins see the same order on `GET /admin/ambassadors?sort=points`; students and the public never see it.

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
| `GET /admin/tasks` | `status` (`active` default, `archived`), `page`, `pageSize` (≤ 50) | `Paginated<AdminTaskRow>` newest first, with the assignments counted per status; `demo` marks a demo task |
| `POST /admin/tasks` | `{ title (3–120, one line), description (1–2,000, line breaks kept), points (0–1,000) }` | 201 the task |
| `PATCH /admin/tasks/:id` | any of the fields, `expectedUpdatedAt` | 200; 409 `stale`, `archived`, `nothing_to_update`. A new points value counts for later approvals only |
| `POST /admin/tasks/:id/{archive,restore}` | — | 200; 409 `archived` / `not_archived`. An archived task leaves the panels and takes no proof or assignment |
| `POST /admin/tasks/:id/assign` | `{ userIds (1–50, unique) }` | 200 `{ assigned, alreadyAssigned }`. Approved, unblocked ambassadors only, all or nothing: 409 `not_ambassador`; 409 `archived`. Demo data: a demo task goes only to demo ambassadors and a real task only to real ones, all or nothing (409 `task_side_mismatch`, nothing assigned) |
| `GET /admin/task-assignments` | `page`, `pageSize` | `Paginated<AdminTaskReviewRow>`: submitted proofs, oldest first (admins only; the web shows the proof as plain text, never as a link); `demo` marks a demo task's proof |
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
| `GET /admin/teams` (admin, re-read) | `q` (name, 1–60), `page`, `pageSize` (≤ 50) | `Paginated<AdminTeamRow>` newest first: name, lead (id, full name), `open` (the lead still active), member count, `demo` (a demo account leads it), times. No join code |
| `GET /admin/teams/:id` (admin) | — | `AdminTeamDetail`: the row plus the members (id, full name, email, joined), oldest first. 404 unknown id (a malformed id is 400; the web asks for none) |
| `PATCH /admin/teams/:id` (admin) | `{ name (3–60), reason (3–200), expectedUpdatedAt }` | 200 the row. A row lock: 409 `stale`, `nothing_to_update`, `name_taken`. Moderation for an unsuitable name |

The database keeps the name length and the code format (`*_core_ambassador_teams_checks`); `teams.name`, `teams.join_code` and `teams.owner_id` are unique, and `team_members.user_id` is unique (one team per student).

## Rounds (core C6a; plan: `docs/plans/CORE-PLAN.md` §7, owner Q4 defaults, lead's review)

Shapes `AdminRound`, `RoundCreateRequest`, `RoundUpdateRequest`, `RoundCriterion`, `DEFAULT_VIDEO_CRITERIA`, `PromotionQuery`, `PromotionPreview`, `PromotionRequest`, `PromotionResult`, `MyRound`, `ROUND_LIMITS`, `ROUND_REFUSALS` (`core.ts`). Every admin route re-reads the admin (admin only: managers, jury, students and ambassadors get 403). Writes are audited (`round.created`, `round.updated` with the field names, `round.promoted` with the counts only, never a student).

| Method + path | Request | Answers |
|---|---|---|
| `GET /admin/rounds` | — | `{ items: AdminRound[] }`: every round in order (at most 10 real ones, so no paging), with the criteria (video rounds), `scored`, the entries by status, the promotions out of it and `demo` (a demo round, sort orders 101–110) |
| `GET /admin/rounds/:id` | — | `AdminRound`; 404 |
| `POST /admin/rounds` | `{ name (2–60), type (video, final), opensAt?, closesAt?, criteria? (1–20 of { key, en, bn }) }` | 201. Round 1 (quiz) exists; a round is appended (the server's next `sort_order`, under a lock). A video round needs both times; a final round has both or neither; the close follows the opening and lies in the future (400 `bad_window`). Criteria only for a video round, keys unique (400 `bad_criteria`); left out, the old ten (0–10 each). 409 `after_final` (nothing follows the final), `too_many_rounds` (10), both over real rounds only; 409 `demo_rounds_present` while demo rounds exist (remove the demo data first) |
| `PATCH /admin/rounds/:id` | any of `name`, `opensAt`, `closesAt`, `criteria`; `expectedUpdatedAt` | 200. Row lock: 409 `stale`, `nothing_to_update`. Round 1: the name only (409 `quiz_round`). Once open, the start stays (409 `window_started`) and the close only moves later (409 `window_shortened`); once closed, it stays (409 `window_closed`). Criteria: video rounds only (409 `not_video_round`), frozen once a jury score exists (409 `criteria_frozen`). The type and the order never change |
| `POST /admin/rounds/:id/promotion/preview` | `{ topN (1–25,000), category }` | 200 `PromotionPreview`, nothing written: the source, `candidates`, `promoted`, **`tieCount`** (promoted beyond N because of a tie at the cut), `eliminated`, the cut (rank, score, time), and `expected`. 409 `demo_rounds_present` while demo rounds exist (also on the run) |
| `POST /admin/rounds/:id/promotion` | `{ topN, category, expected }` (the preview's) | 201 `PromotionResult`. 409 `stale` when the source changed since the preview (another results version, a changed score) |
| `GET /rounds/me` (student, ambassador, re-read) | — | `MyRound`: the latest round with an own entry and its status; with none, Round 1 and `entryStatus: null`. The home and `/users/me` `currentRound` read the same. By the viewer's side: a real account sees real rounds only, a demo account its demo rounds only (its Round 1 is the demo one, 101) |

**Promotion** (one category from a round to the next):
- **From a quiz round:** the category's rows of the **published** snapshot of the round's one published real exam (for that category or for all; a demo exam is never a source), ranked inside the category in exam's order (score, then time; equal score and time share a rank). 409 `no_exam`, `ambiguous_source` (two published exams cover the category; an archived exam is never a source), `results_not_published`.
- **From a video round:** after its close (409 `window_not_closed`), with every sent video scored (409 `unscored_entries`), ranked by the jury average; an entry without a video is eliminated.
- **The cut:** rank ≤ N goes through, **ties at the cut included** (owner Q4a default). 409 `no_entries` when nobody would.
- **One transaction under the round's row lock:** a `promotion_runs` row; the next round's entries (`pending`, `INSERT … SELECT … ON CONFLICT (user_id, round_id) DO NOTHING`: an existing entry, its video and score are never overwritten); the source round's entries set to `promoted` or `eliminated` (Round 1's are created then, for everyone on the snapshot); the audit row.
- **One run per (round, category)** (UNIQUE; 409 `already_promoted`, also on the preview). The next round is the next real one; nothing after the last round (409 `no_next_round`). A student whose snapshot row has no category is in no category's promotion.
- **`promotion_runs` is append-only** (`*_core_rounds_append_only`): UPDATE, DELETE and TRUNCATE are refused (TRUNCATE only passes in a database named `*_test`), and `sirat_app` has no UPDATE or DELETE on it. A student who already had an entry in the next round keeps it and is counted in `promoted`.

The database keeps the limits (`*_core_rounds_checks`): round name 2–60, at most 10 rounds, the window order, 1–20 criteria, a video round with its window and criteria; an entry's score 0–100, the video link ≤ 500 with its time; a run's top N 1–25,000, counts ≥ 0, from ≠ to, and the source (`exam` with its exam and results version, or `jury`).

**Video and jury (core C6b; the C6 plan, the lead's notes, owner Q4b–Q4d defaults).** Shapes `VideoSubmitRequest`, `AdminRoundJury`, `JuryAssignRequest`, `JuryAssignResult`, `JuryRound`, `JuryEntryRow`, `JuryEntryQuery`, `JuryScoreRequest`, `JuryScoreResult`, `VIDEO_HOSTS`, `isAllowedVideoUrl`, `JURY_LIMITS`, `JURY_REFUSALS` (`core.ts`). The video link is a minor's input: it is never logged or audited (the audit rows keep ids). Blind judging: the jury never gets a student's name, institution, user id or contact.

| Method + path | Request | Answers |
|---|---|---|
| `PUT /rounds/:id/video` (student, ambassador, re-read) | `{ url (≤ 500) }` | 200 `MyRound` of that round. Own entry only (none is 404, as for an unknown round). https to `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be` or `drive.google.com` only, with no user name, password or port (400 `bad_video_url`). Inside the window by the server's clock (409 `window_not_open`, `window_closed`); a video round only (409 `not_video_round`); while the entry is pending or sent (409 `entry_closed`). Status `submitted`. Takes the round's share lock, so it never runs during a promotion. Audit `round.video_submitted` (ids) |
| `GET /admin/rounds/:id/jury` (admin) | — | `AdminRoundJury`: the round (with `demo`), the assignments (judge with name and email, category) and up to 200 unblocked jury accounts of the round's side to add |
| `POST /admin/rounds/:id/jury` (admin) | `{ judgeId, categories (1–3, unique) }` | 200 `{ assigned, alreadyAssigned }`: one row per category, existing ones skipped. A video round only (409 `not_video_round`); an unblocked jury account only (409 `not_jury`); a demo judge only on a demo round and a real judge only on a real one (409 `jury_side_mismatch`). Audit `jury.assigned` |
| `DELETE /admin/rounds/:id/jury/:assignmentId` (admin) | — | 204; 404 when it is not this round's. The judge's scores stay in the history but stop counting: in the same transaction (under the round's share lock) every entry of that category the judge scored is recomputed, and one left with no assigned score is `submitted` again with no score. Audit `jury.unassigned` (with the number recomputed) |
| `GET /jury/rounds` (jury, re-read) | — | `JuryRound[]`: the video rounds of the judge's side the judge is assigned to, with the criteria, the judge's categories, `scoringOpen` (the window has closed) and the judge's own counts (`pending`: sent videos not scored by them; `evaluated`: scored by them) |
| `GET /jury/entries` (jury) | `round`, `status` (`pending` default, `evaluated`), `page`, `pageSize` (≤ 50) | `Paginated<JuryEntryRow>`, oldest video first: an entry number (`E-` + the last 8 hex digits of the entry id), the category, the link, the time it was sent, and the judge's own latest score. Only the judge's categories and side (another round, or a round of the other side, is 404); 409 `window_open` before the close. Pending leaves out the categories already promoted |
| `POST /jury/entries/:entryId/scores` (jury) | `{ criteria: { key: 0–10 }, comment? (≤ 1,000) }` | 201 `JuryScoreResult`. Every criterion of the round, whole numbers 0–10 (400 `bad_scores`). An entry outside the judge's categories, of the other side (demo data), without a video or not in a video round is 404. After the close only (409 `window_open`), before the category's promotion (409 `already_promoted`). The total is out of 100: the sum × 100 / (10 × the number of criteria), so with the default ten it is the plain sum. A new `jury_scores` row (append-only); the entry's score becomes the average of the latest total of each judge assigned now to its round and category, under the entry's row lock and the round's share lock; status `evaluated`. Audit `jury.scored` (ids only; never the comment, which the student never sees) |

The database keeps the limits (`*_core_jury_checks`): a score's total 0–100, the criteria a JSON object, the comment ≤ 1,000; one assignment per (round, judge, category). `jury_scores` is append-only (UPDATE, DELETE and TRUNCATE refused; TRUNCATE passes only in a database named `*_test`), and `sirat_app` has no UPDATE or DELETE on it.

## Admit card (core A1; the client's mock-up; the lead's approval of 2026-11-11)

`GET /admit-card` (student and ambassador, re-read: a blocked account or a staff token gets 403) → `AdmitCard` (`core.ts`), the caller's own:
- `participantId`: the full, canonical ID. This is **the one page where it shows in full**: it is the login secret, with the email. The answer is `Cache-Control: no-store`.
- `participantIdMasked` (`maskParticipantId`): the only form the share image uses.
- `mode` (`online`/`offline`, from the ID's prefix ON/OF), `name`, `category`, `gradeLevel` (the class label), `fee` (`amountMinor`, `currency`, `paidAt`) and `registeredAt`.
- `exam`: exam's `nextExamFor`, the next round exam the student may sit (practice exams never count; demo and real kept apart; the round rule). null while none is published: "to be announced".
- 404 `not_registered` without a paid registration (the web shows "registration not complete").

It reads payments' `registrations`/`payments` and exam's `exams` read only; no table of its own. The PDF (A2) uses the same service, so the page and the PDF never differ.

The web page `/dashboard/admit-card` follows the client's mock-up:
- the ID with copy (the canonical form) and a keep-private note;
- the details, and a countdown to the exam's start;
- the official group links (`content/groups.ts`, each hidden while empty);
- Share: a PNG drawn in the browser (a canvas, so the browser shapes the Bangla) holding the **masked** ID only. It goes to the device's share sheet where it takes a file, else it downloads. Nothing is uploaded.

## Certificates (core C6c-1; plan: `docs/plans/CORE-PLAN.md` §7, owner Q4 defaults, lead's notes)

Shapes `CertificateIssueRequest`, `CertificateIssueResult`, `MyCertificate`, `AdminCertificateRow`, `AdminCertificateQuery`, `CertificateRevokeRequest`, `CertificateCheck`, `CERTIFICATE_TYPES`, `CERTIFICATE_LIMITS`, `CERTIFICATE_CODE_PATTERN`, `CERTIFICATE_REFUSALS` (`core.ts`). Admin routes re-read the admin (managers, jury, students and ambassadors get 403). A certificate is revoked, never deleted.

| Method + path | Request | Answers |
|---|---|---|
| `POST /admin/certificates/issue` (admin) | `{ type, roundId, emails? (1–50, winners), reason? (3–200, winners) }` | **202** `{ queued, type, roundId, candidates }`: one job on the `certificates` queue (DO 8), done by the worker. `candidates` is how many qualify now; anyone who has one already is skipped. 409 `wrong_round`; `results_not_published` (participation, no published Round 1 exam with published results); `unknown_user`, `not_in_round` (winners); `demo_round` (a demo round: its certificates come with the demo data); 400 `no_winners` (winners without emails or a reason, or emails for another type); 503 `queue_unavailable`. Audit `certificates.issue_requested` (the type, the count, a winner's reason; never an email) |
| `GET /admin/certificates` (admin) | `q` (a name, or an exact `SLO-` number), `type`, `round`, `page`, `pageSize` (≤ 50) | `Paginated<AdminCertificateRow>` newest first, with the student's name and email and `demo` (a demo account's). No verification code |
| `POST /admin/certificates/:id/revoke` (admin) | `{ reason (3–200), expectedUpdatedAt }` | 200 the row. A row lock: 409 `stale`, `already_revoked`. Audit `certificate.revoked` (the reason) |
| `GET /certificates/mine` (student, ambassador, re-read) | — | `MyCertificate[]`, a few at most (one per type and round), so no paging: the award, the number, the check code, the name as printed, `revoked` (never the reason) |
| `GET /certificates/verify/:code` (**public**, reviewed allow-list) | the 12-hex code, any letter case | 200 `{ name, award: { type, roundName }, demo }` **only** (lead). `demo: true` for a demo certificate: the page says "Demo certificate, not a real award" (lead, 2026-11-09). An unknown, malformed or revoked code gets the same 404. **30 per minute per IP** (the route's tier); the web's `/verify/[code]` page calls it from the browser, so the limit counts the visitor, not the web server |

**The issue job** (worker, `certificates` queue, 3 tries): one `INSERT … SELECT … ON CONFLICT (user_id, type, round_id) DO NOTHING`, so a run twice adds nothing. Who:
- `participation`: everyone on the latest snapshot of Round 1's **published** exams whose results are published (an archived exam is retired, as for promotion);
- `promotion`: everyone with an entry in a round after Round 1;
- `winner`: the students named by email (resolved to ids by the API: no email reaches Redis) who have an entry in the final round.

Blocked accounts are left out, and so are demo accounts and demo exams (demo data: a real run never gives a demo account a real serial). Each row gets the next serial (`SLO-<year>-<number>` from `certificate_serial_seq`; a number drawn for a skipped row is not used) and a random verification code (12 hex digits, 48 bits). The name is copied as it is at issue time. Audit `certificates.issued` (the type and the count) with the requesting admin.

The database keeps the rules (`*_core_certificates_checks`): the three types, the serial and code formats, the name 1–200, the revoke fields all three or none, a reason 3–200; one certificate per (user, type, round).

## Admin statistics (core; lead 2026-11-01)

`GET /admin/stats` (admin and manager, re-read: a demoted or blocked user gets 403; jury, students and ambassadors get 403, and the web does not call it for jury) → `AdminStats` (`dashboard.ts`). **Counts only**: no name, email, phone, id or money sum. Read from payments' and exam's tables, never written.

| Field | Counted from |
|---|---|
| `totals.registered`, `paid`, `pendingPayments` | `registrations`; payments `paid`; payments `initiated` + `pending` |
| `totals.activeAttempts`, `submittedAttempts` | exam attempts `in_progress`; `submitted` + `expired` + `scored` |
| `totals.secondRound`, `finalists` | entries in the second round and in the final round; `null` while that round does not exist (core C6a). Each side counts its rounds in its own order; a real round counts first, a demo one only while there is no real one |
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

## Demo data (exam; DECISIONS 2026-11-08 "Demo data, loaded and removed with one click")

Admin only (re-read in the transaction: a demoted or blocked admin gets 403; manager, jury, students and ambassadors get 403). Load and remove are `@TwoFactorAlways`: a session that has not proved the second factor gets 403 `TWO_FACTOR_REQUIRED` whatever the requirement setting says (not while 2FA is off, development only). Shapes `AdminDemoStatus`, `DemoActionInput`, `DemoLoadAccepted`, `DEMO_REFUSALS` (`demo.ts`). Refusal codes in `details`.

| Method + path | Request | Answers |
|---|---|---|
| `GET /admin/demo` | — | `AdminDemoStatus`: `allowed` (DEMO_DATA_ALLOWED), the one batch or null (status `loading`, `loaded`, `failed` or `clearing`, who and when, counts per area, `stale`), the running job's step, and how the last load or removal ended (a day; `blocked` lists what stops a removal) |
| `POST /admin/demo/load` | `reason` (3–200, trimmed) | **202** `DemoLoadAccepted` `{ batchId, password }`: the batch is `loading` and the job is queued. The password is in this answer only (16 random characters; stored only as the argon2id hash). 409 `demo_not_allowed` (DEMO_DATA_ALLOWED is not true), `demo_exists` (remove the batch first), `demo_busy` (a job runs), `payments_live` (PAYSTATION_ENV=live), `real_payments` (a paid `live` payment exists: payments' `paymentsAllowDemo`), `real_rounds_present` (a real round after Round 1 exists: the demo brings its own rounds); 503 `queue_unavailable` (the batch becomes `failed`). Audit `demo.load_requested` (reason) |
| `POST /admin/demo/clear` | `reason` (3–200, trimmed) | **202** `AdminDemoStatus`: the batch is `clearing` and the job is queued. Works while DEMO_DATA_ALLOWED is off. 409 `demo_absent`, `demo_busy`; 503 `queue_unavailable` (the batch gets its status back). Audit `demo.clear_requested` (reason). A removal the database refuses (real rows use demo rows) ends as `lastOutcome.result = 'blocked'` with counts per kind, and nothing is removed |

Load and remove: at most `DEMO_ACTIONS_PER_HOUR` (10) per admin per hour each, refusals included (429). A load's cheap refusals (a batch exists, payments' guard) come before the password is hashed.

**The abandoned-job rule** (`DEMO_STALE_MINUTES`, 15): a batch still `loading` or `clearing` that long after its last change has lost its job (the API stopped between the commit and the queue, or the queue lost the job). It shows `stale: true` and no progress. A load answers `demo_exists` and a removal is accepted, as for a failed batch (audited with `abandoned`: the status it had). A late job then finds the batch no longer loading and does nothing. Before that, both answer `demo_busy`.

**The job** (queue `demo`, the worker, one at a time, 3 tries, idempotent): a load runs every area's generator in **one transaction** (all or nothing), registering every inserted row in `demo_records`, then builds and publishes the results of the batch's closed exams with the exam worker's own code, then runs the 'afterResults' generators in a second transaction (promotion needs the published snapshot), and ends `loaded` with counts read from the database. The data: 300 students, 15 ambassadors and 2 jury on `@demo.sirat.invalid` (`student-001` …), never an admin or manager; a practice exam (open 30 days) and a Round 1 that closed 9 days ago, 30 bilingual questions each, about 90 % of the students and ambassadors scored (layouts and scores from the engine's own `drawLayout` and `scoreAnswers`); 4 announcements; payments' registrations and payments. Phase 2: the demo's own rounds (Round 1 quiz 101, a video round 102 whose window closed two days ago, a final 103; no demo row references a real round, and the demo Round 1 exam belongs to the demo Round 1); every demo ambassador approved with an SR- code; half the paid demo students referred by one, with the points worker's own `referral_paid:<paymentId>` rows; three demo tasks with assignments in every state and the approved ones' `task:<assignmentId>` points; teams of 3–10; the Round 1 results dated a few hours after its window (before the promotions), the promotion from the demo Round 1 by its snapshot (score, then time; ties at the cut go), videos from allow-listed hosts, both demo judges' scores over the round's criteria, the promotion into the final; certificates (participation, promotion; no winner while the final is ahead) with serials `SLO-YYYY-9NNNNN`, never from the real sequence. The admin-only columns name the admin who clicked, else the oldest active admin; without one, tasks and rounds after Round 1 are skipped. A removal calls `demo_clear` (SECURITY DEFINER; 05-DATABASE "Demo data"). After either, the exam configs, the published-exams list, the announcement pages and the admin stats are dropped from the cache Redis. Alerts `ops.demo_loaded`, `ops.demo_cleared` (ops category).

**No mixing**: a demo account sees and starts only demo exams and a real account only real ones (the other side's exam is the same 404 as an unknown one); a team never takes a member from the other side (404 `Team not found`); the leaderboard follows the viewer's side; a demo ambassador's code is refused at registration (`PROMO_INVALID`). Core's services (phase 2): tasks go only to ambassadors of their side (`task_side_mismatch`); no real round is added and no promotion runs while demo rounds exist (`demo_rounds_present`); `/rounds/me` and the video follow the viewer's side; a judge goes only on a round of its side (`jury_side_mismatch`) and sees and scores only its side's entries; no issue run on a demo round (`demo_round`), and a real run leaves demo accounts and exams out; the public check marks a demo certificate. The admin lists of rounds, tasks, proofs, teams, ambassadors and certificates show a "Demo" badge. The database backs the task and the entry rules with triggers (05-DATABASE). No email is ever sent to the demo domain (dropped at enqueue and in the worker), and every path that sets an email refuses it (the registration form, `create-admin`).

**CLI** (the VPS): `node dist/cli/demo.js load --reason "…"` and `… clear --reason "…"` (locally `pnpm --filter @sirat/api demo:load` / `demo:clear`). The same steps without the queue; prints the counts and, after a load, the password once. RUNBOOK "Demo data".

## DTO and security rules

- Every API answer carries `Cache-Control: no-store` unless the route sets its own (DECISIONS "TLS behind Cloudflare"). HSTS comes from nginx, never from the API.

* `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Unknown fields are rejected, so `role`, `points`, `rank`, `status` can never be injected.
* Acting user = `req.user` from the verified cookie. Never `user_id` in body/query. Any `:id` is ownership-checked.
* Session: the access token travels only in the httpOnly cookie `sirat_access` (an `Authorization` header is ignored). HS256, issuer `sirat-api`, audience `sirat-web`, 15 min, verified locally; claims `sub`, `role`, `sid`, `tfa` (the session proved a second factor; missing = false).
* State-changing requests (anything but GET/HEAD/OPTIONS) require a non-empty `X-Requested-With` header (CSRF) on top of SameSite=Lax, public routes included (login CSRF). The API never enables CORS. Only `POST /payments/paystation/ipn` may skip it (`@SkipCsrf()`, reviewed list in the routes test). GET handlers never change state.
* A handler that has not answered within 25 s gets 503 `Request timed out` (nginx gives up at 30 s); every DB statement stops at 10 s.
* Throttle tiers (DECISIONS "Per-user API limits"): a request with a verified session counts against its user, 120/min per route; anything else counts against the client IP, 600/min per route by default. Anonymous auth routes: login has no request limit (the login limiter counts failures), refresh 3,000/min, forgot-password 120/min, resend/reset/verify 300/min each; `POST /auth/2fa/verify` has the per-IP default (the login limiter counts its failures). The admin 2FA reset: 5/hour per admin. Exam checkpoint/submit fall under the per-user limit (schools and mobile operators share IPs).
* Responses never include `correct_key`, other users' data, stack traces or raw DB errors.

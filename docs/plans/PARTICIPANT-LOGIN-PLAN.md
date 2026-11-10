# Participant-ID login (A2 plan, 2026-11-10)

Owner decision of 2026-11-10 (Rasel, passed on by the lead): students and ambassadors log in with their **email + participant ID**, the unique ID printed on the admit card. They have no password. Admin, manager and jury keep password login; admin and manager keep 2FA. The lead warned that the card is shareable and that the users are minors; Rasel chose this anyway. The lead's mitigations are mandatory: (a) a random ID, (b) no email on the card and a masked ID on the share image (core), (c) the existing login limits with one answer for every failure, (d) "forgot my ID" mails the ID to the registered address only, (e) the same httpOnly session and CSRF.

This plan covers A2's part. Payments owns the ID itself (P1) and the registration form (P2); exam owns the demo generator and the load fixtures; core owns the admit card and its share image.

## 1. The ID (payments P1; agreed interface)

- `registrations.participant_id`: TEXT NOT NULL UNIQUE (migration `20261110100000_registrations_participant_id`). DB default `gen_participant_id()` (ON today; an offline mode will pass `'OF'` from the app). Existing rows are backfilled. Only payments' re-issue (P1b) changes it.
- Canonical form `^(ON|OF)[0-9]{11}$`: ON/OF, then 10 random digits, then a Damm check digit (e.g. `ON48210937552`).
- Random from `gen_random_uuid()` bits (pg_strong_random), the backfill included; never `random()`, never sequential. The function loops until the value is free, and UNIQUE stays as the backstop.
- `@sirat/shared`: `normalizeParticipantId(input)` (uppercase, drop spaces and dashes), `isParticipantId(s)` (format and check digit), `formatParticipantId(canonical)` (display: `ON 4821 0937 552`; copy buttons copy the canonical form).
- Students and ambassadors always have a registration (ambassadors are registered students, owner 2026-11-10). Staff accounts have none.

## 2. Login (one endpoint, two kinds of credential)

`POST /auth/login` keeps its path, so nginx's auth zone, the limiter and the web proxy stay as they are. The body is `{ email, participantId }` or `{ email, password }`, exactly one of the two.

| Account | `participantId` | `password` |
|---|---|---|
| student, ambassador | compared in constant time with the registration's ID | 401, counted as a failure |
| admin, manager, jury | 401, counted | as today: argon2, 2FA step for enrolled accounts |
| unknown email | 401, counted (dummy compare) | 401, counted (dummy argon2), as today |

- **One answer for every failure:** the same 401 body for an unknown email, a wrong ID, the wrong kind for the role, or an account without a registration. A blocked account gets 403 only after the right credential, as today.
- **DTO:**
  - `participantId` is a string of at most 32 characters, normalized by `normalizeParticipantId`.
  - A value failing `isParticipantId` gets **400** ("check your participant ID"): a typo, decided without a lookup, not counted. An attacker gains nothing from it, since they would compute valid check digits anyway.
  - Neither or both fields: 400.
- **Limits:** the same `LoginLimiter` keys (email hash, IP) for both kinds, so failures add up across them. Today's numbers (env defaults):
  - per IP: 100 failures/min;
  - per account+IP pair: 10 in 15 min lock the pair for 15 min, doubling to 240 min;
  - per account: 50/hour. Past that only the IPs that already failed are refused, so nobody locks a student out from elsewhere;
  - alert at more than 20 distinct failing IPs on one account per hour;
  - nginx auth zone: 100 r/s per IP.
- **Timing:** both paths make the same query (the user by email with the registration's ID). The compare is `timingSafeEqual` over SHA-256 of both values, against a fixed dummy when there is no ID. No argon2 on the ID path, which also makes the exam-day login surge much cheaper than today's (19 MiB argon2 per login).
- **Session:** `SessionService.start` as today: the same cookies, refresh, CSRF and session limits. Students and ambassadors never enrol in 2FA (unchanged).
- **Audit:** as today. A pair lock, the account limit's start and a blocked account's login are audited; a success is recorded only by the sessions row. New: `meta.credential` = `participant_id` | `password` on those rows. The ID is never written to logs, audit rows or alerts.

## 3. Forgot my ID

- `POST /auth/forgot-id` `{ email }`: Public, `FORGOT_TIER` (120/min per IP), added to nginx's auth location. Always 204, whether or not anything was sent.
- In the background: the per-address cap of the existing `EmailSendLimiter` (new kind `participant_id`; 1/min, 5/hour by default, like the reset link).
- An email is sent only to an unblocked student or ambassador with a registration: "Your participant ID is ON-…" (bn/en, `auth-emails.ts`), to `users.email` only. Job key `participant-id.<uuid>`.
- The demo domain is dropped as for every email (enqueue and worker).
- Audit `auth.participant_id_sent` (target user, no ID in meta), so support can see that it went.
- **`POST /auth/forgot-password` for a student or ambassador** sends this same ID email instead of a reset link. The answer is the same 204, and the cap is shared. A student who reaches for "forgot password" out of habit still gets in.
- Until SES is set up, these emails land in Mailpit (RUNBOOK §12).

## 4. Passwords after the switch

- **Migration (A2), after payments' P1:**
  - `users.password_hash` becomes nullable;
  - CHECK `users_password_for_staff`: `password_hash IS NOT NULL OR role IN ('student','ambassador')`. Admin, manager and jury always have a password, so a role change to staff without one fails in the database;
  - `UPDATE users SET password_hash = NULL` for students and ambassadors: no dead credentials;
  - outstanding `password_reset` tokens of those accounts are consumed.
- **Existing accounts: participant ID only.** No transition period. Pre-launch there are no real students, only fixtures, testers and demo accounts, and all of them have (backfilled) registrations. A student or ambassador account without a registration can no longer log in; the plan lists any on the VPS before the deploy.
- `POST /auth/change-password`: 403 `PASSWORD_NOT_USED` for a student or ambassador.
- `POST /auth/reset-password`: a token of such an account is an invalid link.
- 2FA routes are unchanged: admin and manager only.
- **Payments P2:** the form drops the password, and settlement writes NULL. Its migration NULLs any student hash written between the two releases and adds the reverse CHECK (`role IN ('student','ambassador')` implies `password_hash IS NULL`).
- **One release:** P1 → this PR → P2, with P2 merged in this PR's deploy turn or right after. Login by ID works from this PR's release on, so it works before the form stops asking for a password. No flag needed.

## 5. Web (A2)

- **`LoginForm`:**
  - email + "Participant ID" (text, `autocomplete="off"`, normalized and checked with the shared helpers before sending; a bad check digit is shown at once);
  - a "Staff login" switch shows the password field instead;
  - the 2FA code step is unchanged.
- **`/forgot-id`:** the email form (`ForgotPasswordForm`'s shape), linked from the login form. `/forgot-password` stays for staff.
- bn/en strings in i18n.
- The result page and the dashboard show the ID (payments P1, core's admit card): not this PR.

## 6. Consumers that log in today with a password

All are updated in this PR, so CI stays green:
- the dev fixtures (students get registrations, so they have IDs) and `RUNBOOK §0`;
- `apps/web/scripts/e2e.mjs` and `e2e-register.mjs` (the result page shows the ID: payments P1);
- the CI pages job (the admin login stays a password login);
- the int suites that log in as students (`auth-*`, `api-per-user-limits`, `busy-503`, `registration`, `payments-settle`, `dev-fixtures`).

Exam's load fixtures and k6 scripts (`login-surge.js`, `exam-simulation.js`) need IDs that k6 knows: an explicit ID per load account, or a CSV export. That's exam's change, needed before L14 part 2.

## 7. Tests (A2)

- **Unit:**
  - `LoginDto`: exactly one credential, normalization, bounds, a bad check digit gets 400;
  - the login service matrix of section 2;
  - forgot-id and forgot-password for each role, blocked, no registration, and the cap.
- **Integration (`auth-participant.int-spec.ts`, real Postgres and Redis):**
  - login over HTTP sets the cookies and CSRF works;
  - the same 401 body for the four failure cases;
  - failures add up across both kinds for the pair lock and the account limit;
  - 403 for a blocked account after the right ID; `Retry-After` on a lock;
  - forgot-id: the queued email carries the ID to the registered address only, the same 204 for an unknown address, the cap holds, the demo domain is dropped;
  - change-password 403 and reset-password refused for a student;
  - the migration: student hashes NULL, the CHECK refuses a staff row without a hash, reset tokens consumed;
  - `app-routes` (guard coverage) lists the new public route.
- **nginx:** `check-sites.sh` covers `/api/auth/forgot-id` in the auth zone.
- **Web:** `LoginForm` and `/forgot-id` unit tests; `e2e.mjs` logs in with fixture IDs.
- **Mutations** that must fail the suite: compare without normalization; the ID path accepting a staff account; forgot-id sending to a blocked account.

## 8. Docs

- DECISIONS: the owner decision, the mitigations and the risk below.
- RULEBOOK §auth: passwords only for staff; students and ambassadors log in with the participant ID.
- 06-API: the login body, forgot-id, change-password.
- 05-DATABASE: the nullable password and the CHECK.
- RUNBOOK: support for a student who lost the ID (forgot ID; the admin sees it on the student's page).

## 9. Residual risk (for DECISIONS)

- **The ID is a bearer credential printed on a shareable card.** Card + email = login. Students' emails are often guessable.
- **Stored in plain text,** because the card, the dashboard and the forgot-ID email need it. Read access to the database or an (age-encrypted) backup is a login as any student. The database is never public; backups are encrypted.
- **Guessing:** 10^10 IDs against the limits above. A 10,000-IP botnet at full rate gets about 1.4·10^9 guesses a day across all accounts, roughly one account every week. Against one chosen account it gets about 10^-6 an hour.
- **A leaked card** stays valid until an admin re-issues the ID. That's payments' P1b, before launch: a reason, audited, the new ID emailed, and the user's sessions ended with `endSessionsOf`.

## 10. The lead's answers (2026-11-10: plan approved)

1. **A global failed-login alert** against spraying: yes. Over 2,000 failures/min across all accounts, or over N distinct accounts failing within 10 minutes. It becomes an ops-check warning plus a security alert (`SecurityAlerts`), counted in the cache Redis beside the login limiter, without email addresses in the keys.
2. **forgot-password for a student or ambassador sends the ID email** (section 3), with the same 204 and cap: yes.
3. **The jury keeps the password:** yes.
4. **Before the deploy turn** (P1 → this → P2): the counts of VPS students and ambassadors without a registration (counts only).

Settled with payments (2026-11-10): the format and generator above; their settlement email (`registration-confirmed.<registrationId>`) never collides with this plan's `participant-id.<uuid>`; P2's migration NULLs the in-between student hashes and adds the reverse CHECK; the re-issue is P1b.

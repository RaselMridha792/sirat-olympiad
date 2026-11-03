# Core: students list, public pages, profile, announcements, ambassadors, rounds/jury/certificates: plan

Plan only, no product code (2026-10-31, branch `feat/core-plan`, worktree `G:\sirat-core`). It reaches `main` in a docs-only pull request; the lead reviews and merges it. Code starts only after that, on new branches from `main` (section 9).

**Priority:** the 15 November launch (registration + payment, A2's login) comes first. Launch items of this plan (C1–C5a) are built first; C5b and C6 may be reviewed and merged after the launch.

Sources: RULEBOOK §4, §5, §15, §18, §19; `02`–`07`, `10-BUILD-PLAN.md`; DECISIONS (A1, A2, UI port, web session, per-user limits, payments and exam entries of 2026-10-31); OPEN-QUESTIONS #11–#15; `plans/PAYMENTS-PLAN.md` (D4 promo, 6.7 admin, 15 local environment, 16 book CSV); `plans/EXAM-PLAN.md` (7 conflict files, 11 local environment); payments' `feat/payments-registration` read with `git show` only (shapes in `packages/shared/src/registration.ts`, the `06-API.md` registration section); the lead's message of 22:40. From `reference/` only the look and the business rules are taken; no code is copied.

## 0. Scope, order and boundaries

**The six tasks, in the owner's order:**

| # | Task | PR | Launch (15 Nov) |
|---|---|---|---|
| 1 | Admin students list (read only): search, server paging, registration and payment status, CSV export with audit | C1 | yes |
| 2 | Small public entry page + about, privacy, terms, refund-policy pages (bn/en), texts as placeholders in i18n/config | C2 | yes (PayStation's merchant approval needs them) |
| 3 | Student profile edit | C3 | yes (the profile page shows its error state in production until then) |
| 4 | Announcements: admins write, students read | C4 | yes |
| 5 | Ambassadors: approval, promo codes for payments' registration; then points, tasks, teams | C5a / C5b | C5a yes (if Q2 keeps its default), C5b after |
| 6 | Rounds, jury, certificates (PDF in the queue) | C6a–C6c | no: after exam E4/E5 |

**Who owns which tables (lead, 22:40).** This work only reads the others' tables and never changes them; a column it needs there goes through the lead.

| Owner | Tables |
|---|---|
| Payments | `registrations`, `pending_registrations`, `payments`, `payment_events`, `settings.registration_fee_minor` (and the other registration keys), the free-book tables (payments plan §16) |
| Exam | `exams`, `questions`, `attempts`, `submissions`, `leaderboard_entries` |
| A2 | `sessions`, `auth_tokens`, auth rules, `audit_logs` writer (`AuditService`) |
| **Core (this plan)** | profile fields of `users` (no new column planned), `announcements`, `ambassador_profiles`, `point_ledger`, `rank_thresholds`, `teams`, `team_members`, `admin_tasks`, `task_assignments`, `rounds`, `round_entries`, `jury_scores`, `certificates` |

**Public pages:** the lead's launch-gap list of 22:26 gave A2 "a minimal public entry page and the legal pages"; the lead's message of 22:40 gives them to this plan. A2's `LAUNCH-PLAN.md` then keeps only deploy, TLS, backups, monitoring, the maintenance page and the "coming soon" states. The lead confirms (section 11, risk 1).

`GET /admin/stats` (the admin home) was a gap; the lead gave it to core on 2026-11-01 and it is built (06-API "Admin statistics"). The admin audit-log viewer (M13) was a gap too; the lead gave it to core on 2026-11-01 and it is built (06-API "Audit log"). **Not in this plan (gaps for the lead):** user role change and block/unblock (M2 writes beyond C3's grade correction and C5a's ambassador approval).

## 1. Owner questions (Rasel): at most five, each with a default

The defaults are used if no answer comes before the PR that needs them.

| # | Question | Default | Needed by |
|---|---|---|---|
| Q1 | **Profile edit:** which fields may a student change themselves? | **Yes:** name, phone, district (one of 64), institution, education type (one of 5). Phone keeps the owner's rule: stored as `01XXXXXXXXX`; a number that another account has, or that a registration in progress holds, gets payments' one phone message ("This phone number is already registered. Please use another number."). **No:** email (not at launch: a change needs A2's verification flow; later as a verified change), grade level (it decides the category and so the exam: an admin corrects it, with a reason, audited, only before the student's first exam attempt), role, category, promo code, payment fields. | C3 (Mon 2 Nov) |
| Q2 | **Ambassadors (OPEN-QUESTIONS #12):** how does a student become one, and must promo codes work on launch day? | An **admin makes a paid student an ambassador** from the student's detail (no application form). The server assigns the code (`SR-` + 6 Crockford characters, e.g. `SR-7K3QXD`; fits payments' format `^[A-Za-z0-9_-]{3,40}$`). An admin can revoke: the code stops working for new registrations, earlier referrals stay. This minimal part ships **before 15 Nov** (C5a), so codes work from day one. | C5a (Tue 3 Nov) |
| Q3 | **Points and ranks (OPEN-QUESTIONS #13):** points per paid referral, rank names and thresholds? | 10 points per paid referral; task points set per task by the admin; ranks Bronze 0 / Silver 100 / Gold 250 (already in `rank_thresholds`). All three are data an admin edits, so a later answer changes data, not code. Points are awarded after launch (C5b) and back-filled for every earlier paid referral (idempotent event keys), so nothing is lost by waiting. | C5b |
| Q4 | **Rounds, jury and certificates (OPEN-QUESTIONS #14, #15):** rounds after Round 1, jury criteria, certificate types, wording, signatures, who gets which? | Round 2 = video, Round 3 = final, all as data. Jury: the old 10 criteria, 0–10 each, one or more judges per entry, the latest score of each judge counts, the total is their average. Certificates: participation (a submitted Round 1 exam), promotion (reached Round 2), winner (an admin marks it); the old certificate's layout and wording ported; the client sends the signature images and the final text. | C6 plan update (after exam E4/E5) |
| Q5 | **Public pages and texts:** who writes privacy, terms and refund policy, and which business facts do we show? | The client sends the texts; until then our placeholders in bn/en. The refund policy placeholder states the owner's rule: "The registration fee is non-refundable." / "রেজিস্ট্রেশন ফি ফেরতযোগ্য নয়।" PayStation's merchant support asks for a live site with an about page, terms, privacy policy, contact details (one email and at least one phone number) and the registered business name; a refund policy depends on the business. So the pages show, from one config file: the registered business name, address, email and phone, all from the client. Pages carry `noindex` while any text is a placeholder. | C2 (Sun 1 Nov) for the placeholders; the real texts before PayStation's live review (payments plan 10.2: by Tue 10 Nov) |

**Smaller defaults (say if you disagree):**

| | Default |
|---|---|
| D1 | The students list and its export are **admin only** (not `manager`, `jury`). |
| D2 | **Phone masked in the list** (last 3 digits only, as payments masks stored payloads); full number in the detail dialog and in the CSV. Search by the full number still works. |
| D3 | The CSV needs a **reason** (3–200 characters, kept in the audit row) and contains only `student` and `ambassador` accounts. At most 5 exports per admin per hour, at most 50,000 rows per export. |
| D4 | Public pages: English at `/`, `/about`, `/privacy`, `/terms`, `/refund-policy`; Bangla at the same paths under `/bn`. All static (no cookie read), a language link on each page. |
| D5 | Announcements are plain text (line breaks kept, no HTML, links not clickable), for everyone or one category, publish now or at a set time, archived instead of deleted. No email to students (SES quota). |
| D6 | The student dashboard home is composed in the web from existing endpoints (`/users/me`, `/exams`, `/announcements`, payments' `/registrations/me`), so the planned `GET /dashboard/home` is dropped and no team's module changes for it. |
| D7 | A team: one per ambassador, students join with the team's code, at most 10 members, one team per student. |
| D8 | Profile writes by a student are audited with the **names** of the changed fields only, never the values (like payments' book audit). Admin writes record old and new values except personal contact data. |

## 2. C1 Admin students list (task 1)

**No schema change.** Read only: `users` (+ `grade_levels`), payments' `registrations` and `payments`. Code in `UsersModule` (`admin-users.controller.ts`), so `admin.module.ts` (payments' admin routes) and `app.module.ts` do not change.

**API** (`@Roles('admin')` on every route; each request re-reads the acting user, so a demoted or blocked admin gets 403 at once, like exam's `assertAdmin`):

| Method + path | Request | Response and rules |
|---|---|---|
| `GET /admin/users` | `page` (≥ 1), `pageSize` (1–100, default 20), `q` (2–100), `role`, `blocked`, `category`, `registered` (true/false), `verified` (true/false) | `Paginated<AdminUserRow>`, newest first (`created_at DESC, id DESC`). `q` matches name or email (case-insensitive, contains); in addition the phone exactly when `q` reads as a BD mobile in any form (`normalizeBdMobile`), and the registration's invoice exactly when `q` has the invoice shape. Row: today's fields (`id, name, email, role, isBlocked, category, createdAt`) plus `phoneLast3`, `district`, `gradeLabel`, `emailVerified`, `registration: { registeredAt, invoiceNumber, paymentStatus, paidAt } \| null`, `needsPaymentReview` (any payment of this user with a `review_reason`; the admin opens payments' page for it) |
| `GET /admin/users/:id` | — | `AdminUserDetail` (today's shape) plus the full phone, `referredBy: { name, promoCode } \| null`, `ambassador: { promoCode, approvedAt } \| null`. 404 for an unknown id |
| `POST /admin/users/export` | `{ filters: <the list filters>, reason }` | `text/csv; charset=utf-8`, streamed. Details below |

- **Why POST for the export:** the reason stays out of URLs (nginx still logs query strings, section 11 risk 3), and the CSRF header applies. The browser calls `/api/admin/users/export` through A2's `api()` client and saves the blob.
- **CSV:** UTF-8 with a BOM (Bangla in Excel); columns user id, name, email, phone, district, institution, education type, grade level, category, role, blocked, email verified, registered at (Asia/Dhaka), invoice, amount (BDT), payment status, paid at, referrer's promo code. Cells starting with `=`, `+`, `-`, `@`, tab or CR get a `'` prefix. `Cache-Control: no-store`, `Content-Disposition: attachment`. Read in keyset batches of 1,000 (`created_at, id`), one query per batch, each far below the 10 s statement timeout.
- **Audit before the first byte:** `users.exported` with the admin, IP, the filters (with `q` replaced by its kind: name/email/phone/invoice), the row count and the reason, never the rows. If the audit row cannot be written, no export (503). One helper, `common/csv.ts`, which payments' book CSV (their step 15) can reuse.
- **Limits:** `@Throttle` 5 per hour per admin on the export; the list and detail use the per-user default (120/min). Over 50,000 matching rows → 400 "Narrow the filter".
- **Logs:** no names, emails, phones or search terms (A2.0 gate 2 drops query strings; POST bodies are never logged). The web never logs the CSV.

**Performance:** 25,000 students. Name/email "contains" is a sequential scan of `users`; checked with `EXPLAIN ANALYZE` on 25,000 generated users in `sirat_core_test` (target < 50 ms). Only if it misses: a `pg_trgm` GIN index in its own migration (told to the lead first, an extension).

**UI** (wire the existing `admin/users` page, no redesign): the list gets the registration/payment badge, "email verified", masked phone; a filter row (category, registered, verified) next to the existing role tabs; the detail dialog gets the full phone, registration, referrer and a link to payments' admin page by invoice; an "Export CSV" button opens a `Dialog` asking for the reason. The `data/http/` source starts here (section 8.1).

**Tests:**
- `admin-users.int-spec.ts`: student, ambassador, manager and jury get 403 on all three routes; a blocked or demoted admin with a valid token gets 403; paging bounds and clamping; each `q` kind (name in any case, email, phone in its three forms, invoice); every filter; registration and payment values match the rows; phone masked in the list, full in the detail; 404; no response contains `passwordHash`, an argon2 string or a token (JSON scan).
- Export: header and BOM, formula escaping, Bangla, filters honoured, only student/ambassador rows, reason required, audit row (count, filter kinds, reason, no row data), 6th export in an hour → 429, `no-store`, 5,000 rows stream in batches with a bounded query count (query counter on the Prisma client).
- `csv.spec.ts` (escaping, quotes, newlines, BOM, Bangla). Web: the data mapping and the dialog; `check:prod` and `check:leak` stay green.
- Mutation checks: without the role re-read, without the formula escape, without the audit-first rule, each makes a test fail.

## 3. C2 Public entry page and legal pages (task 2)

**Web only; no API, no schema.** Not Phase D: no design work, no marketing sections beyond what PayStation's approval needs.

| Route (en; bn under `/bn`) | Content |
|---|---|
| `/` | Name, one paragraph about the olympiad, the three steps (register and pay, log in, sit the exam), the fee and whether registration is open (from payments' `GET /registrations/info`, cached 60 s; if the API cannot be reached, the page shows no fee and keeps the buttons), Register and Log in buttons, contact block, footer |
| `/about` | About GLTS Leadership × Sirat Olympiad (placeholder) and the organiser's registered name |
| `/privacy`, `/terms`, `/refund-policy` | The client's texts; placeholders until then. The refund placeholder: the registration fee is non-refundable (owner); a payment taken by mistake is reported to the contact email (the client confirms the wording) |

- **One content source:** `apps/web/src/content/site.ts` (registered business name, address, email, phone, effective date, `placeholder: true`) and a typed message module `i18n/messages/legal.ts` (bn mirrors en at compile time, as every message module does). Legal texts are structured data (headings, paragraphs, lists) rendered by a new `Prose` component in `packages/ui`: no HTML strings, no `dangerouslySetInnerHTML`.
- **Footer** on every public page: the five links, the contact details and the business name from `site.ts`.
- **Static:** no cookie read; `<html lang>` stays `en` in the shared root layout (DECISIONS UI port #16 keeps that for Phase D) and Bangla pages set `lang="bn"` on their wrapper, as the dashboards do. While `placeholder` is true, every page carries `noindex`.
- **Tests:** each route renders its heading in both languages (`node --test` on the page modules), key parity is compile-time, the footer reads only `site.ts`, the build output lists the routes as static, a new source scan (unit test) fails on any `dangerouslySetInnerHTML` in `apps/web/src`, and `check-pages` gains a list of the ten public routes, opened on the production build without a session (200, a heading, no raw error).

## 4. C3 Student profile (task 3)

**No schema change** (the fields exist; `users.phone` UNIQUE and its format CHECK came with payments PR 1a). Code in `UsersModule`.

| Method + path | Guard | Request → response |
|---|---|---|
| `GET /users/me` | `Roles(student, ambassador)` | `StudentProfile` (today's shape; `currentRound` stays null until C6). A blocked account: 403 |
| `GET /content/profile-options` | `Roles(student, ambassador)` | `ProfileOptions` + `districts`: grade levels from `grade_levels`, the 64 districts and 5 education types from payments' `registration.ts` (one list for registration and profile) |
| `PATCH /users/me` | `Roles(student, ambassador)` | Q1 allow-list, every field optional, at least one: `name` (2–100), `phone` (normalised), `district` (one of 64), `institution` (2–150), `educationType` (one of 5). The same limits as payments' registration DTO; a unit test feeds both DTOs the same samples. Unknown fields (`email`, `role`, `category`, `gradeLevelId`, `promoCode`, …) → 400. → 200 `StudentProfile` |
| `POST /admin/users/:id/grade-level` | `Roles(admin)` | `{ gradeLevelId, reason }`; the category comes from `grade_levels`. 409 `has_attempt` once the student has any exam attempt (read from exam's `attempts`). Audit `user.grade_corrected` (old and new grade label, reason) in the same transaction |

- **Phone change, one transaction:** refuse if another user has the number or an `open` registration attempt holds it (payments' `pending_registrations`, read only), then update; a UNIQUE violation from a race is answered with the same 409 `PHONE_REGISTERED` and the owner's text from `REGISTRATION_MESSAGES`, never a 500.
- **Audit** `user.profile_updated` with the changed field names only (D8). Blocked users get 403 (the user is re-read).
- **UI:** the existing profile edit form switches to `normalizeBdMobile` and the shared district and education lists (today it accepts any `01` + 9 digits and free-text district); grade level becomes read-only with "ask an admin to correct it". The admin detail dialog (C1) gets "Correct grade level" with a reason.
- **Tests** (`users-me.int-spec.ts`): own data only, no id in any route; each unknown field → 400; phone in three forms stored once; another user's phone and a phone held by an open attempt → 409 with the owner's text in bn and en; two users claiming one number at once → one 200, one 409; district and education outside the lists → 400; blocked → 403; audit rows carry field names and no values; grade correction: admin only, reason required, category recomputed, 409 after an attempt. Web: the form's parsing and errors in bn/en. Mutation checks: drop the open-attempt check, drop the race mapping (500 instead of 409).

## 5. C4 Announcements (task 4)

**Schema, migration pair CX1** (after `main`'s last migration):
- `*_core_announcements` (generated): `announcements.category` (`Category`, NULL = everyone), `archived_at` (timestamptz NULL).
- `*_core_announcements_checks` (hand-written): `char_length(title)` 3–150, `char_length(body)` 1–5,000; index `(published_at DESC) WHERE archived_at IS NULL`.
- `records.ts` mirrors the new columns (the schema-sync test).

**API** (new `AnnouncementsModule`: one import line in `app.module.ts`, told to the lead first):

| Method + path | Guard | Request → response |
|---|---|---|
| `GET /announcements` | `Roles(student, ambassador)` | `page`, `pageSize` (≤ 50) → `Paginated<AnnouncementItem>`: published (`published_at ≤ now`), not archived, for everyone or the student's category, newest first. Cached in the cache Redis per category and page for 60 s; every admin write bumps a generation key, so a change shows at once |
| `GET /admin/announcements` | `Roles(admin)` | `page`, `pageSize`, `status` (`scheduled`, `published`, `archived`) → `Paginated<AdminAnnouncement>` (+ category, status, archivedAt, author name, updatedAt) |
| `POST /admin/announcements` | `Roles(admin)` | `{ title, body, category (null = everyone), publishAt? }` (`publishAt` not more than 1 min in the past; default now) → 201 |
| `PATCH /admin/announcements/:id` | `Roles(admin)` | `expectedUpdatedAt` + any create field → 200; 409 `stale`, 409 `archived` |
| `POST /admin/announcements/:id/archive`, `/restore` | `Roles(admin)` | `{ expectedUpdatedAt }` → 200. No hard delete |

- Every admin write runs in one transaction that re-reads the acting admin and writes `announcement.created|updated|archived|restored` (title, changed fields) in the same transaction.
- **Dashboard home (D6):** the web's `student.getHome()` calls `/users/me`, exam's `GET /exams` (next open or upcoming) and `/announcements?pageSize=3` in parallel; the registration card stays payments' (`/registrations/me`).
- **UI:** the existing student list and admin table on the API; admin create/edit in a `Dialog`, archive with a confirmation; body shown with `whitespace-pre-line` as text.
- **Tests:** `announcements.int-spec.ts` (visibility by time, archive and category; paging; stale 409; audit in the same transaction; student and manager 403 on admin routes; the cache shows a write at once); `db-constraints` (length CHECKs); web: a body with `<script>` renders as text. Mutation checks: drop the category filter, drop the generation bump.

## 6. C5 Ambassadors (task 5)

**The promo-code contract with payments (already built on their side, `referrer()` in `registration.service.ts`):** a code is valid exactly when `ambassador_profiles.approved_at IS NOT NULL`, matched case-insensitively (CITEXT), format `^[A-Za-z0-9_-]{3,40}$`. Payments stores `referred_by_id` at start and copies it to the user at settlement. So this plan keeps that rule: **revoking sets `approved_at` to NULL** and keeps the row, so the code is never given to anyone else (UNIQUE) and payments' code does not change. Referral counts and points come from rows: `users.referred_by_id` (users exist only after a paid payment).

### C5a (launch, if Q2 keeps its default)

**Migration CX2 `*_core_ambassador_checks`** (hand-written only): CHECK on the promo-code format; append-only triggers on `point_ledger` (UPDATE, DELETE, TRUNCATE refused except TRUNCATE in a `*_test` database, like `submissions`; deferred to this module by the A1 review).

| Method + path | Guard | Request → response |
|---|---|---|
| `POST /admin/ambassadors/:userId/approve` | `Roles(admin)` | `{ reason }`. One transaction: the user must be a `student` with a registration (paid) and not blocked (409 `not_paid_student`, `blocked`, `wrong_role`); create the profile with a new code (collision → a new one, at most 3 tries) or re-approve the old one; `role` → `ambassador`; audit `ambassador.approved`. An already approved one → 200, nothing changes |
| `POST /admin/ambassadors/:userId/revoke` | `Roles(admin)` | `{ reason }` → `approved_at` NULL, `role` → `student`, audit `ambassador.revoked`. Earlier referrals and points stay |
| `GET /admin/ambassadors` | `Roles(admin)` | `page`, `pageSize`, `q`, `status` (`approved`, `revoked`) → `Paginated<AdminAmbassadorRow>` (today's shape; points 0 until C5b) |
| `GET /ambassador/me` | `Roles(ambassador)` | `AmbassadorOverview` (today's shape): code, referral count and the latest referrals (name, institution, date only), points and rank from the ledger, team and tasks empty until C5b |

- The role travels in the access token, so an approval takes effect at the student's next renewal (at most 15 minutes); the admin screen says so.
- **UI:** "Make ambassador" in the admin student dialog (C1), revoke on `admin/ambassadors`; the student panel from the held branch `origin/feat/ui-ambassador` (f847605) merged in with the lead's OK, not rewritten.
- **Tests** (`ambassadors.int-spec.ts`): only admins; each refusal; one transaction (role, profile and audit together); idempotent approve; the code fits payments' DTO pattern; **through payments' real `POST /registrations/start`** with the fake gateway: an approved code is accepted in any case, a revoked one gets `PROMO_INVALID`; `/ambassador/me` sees only its own referrals; a student gets 403; the ledger refuses UPDATE and DELETE.

### C5b (after launch; nothing is lost by waiting)

Split into three PRs (lead, 2026-11-01): C5b-1 points (built: the sweep, bounded to 2 days every 5 minutes with a nightly back-fill, on its own queue; `/admin/ambassador-points`; adjustments), C5b-2 tasks (built: admin tasks and review, the plain-text proof, one award per approval), C5b-3 teams (built: one team each, 10 members, join by code limited per user and per IP, first names only, a revoked lead closes the team, admin rename with a reason).

**Migration CX3 `*_core_ambassador_tasks_teams`:** `task_assignments` + `proof_text` (≤ 1,000), `submitted_at`, `review_note`; `teams` + `join_code` (UNIQUE, CITEXT); `team_members UNIQUE(user_id)` (one team per student, D7); `settings` key `ambassador_points_per_referral` (in the insert-only config seed, built in C5b-1; Q3).

- **Referral points:** a worker job every 5 minutes, one run at a time: `INSERT … SELECT` one ledger row per paid registration with a referrer, `event_key = 'referral_paid:<paymentId>'`, `ON CONFLICT (event_key) DO NOTHING`. It reads payments' `registrations` only; run twice, it adds nothing. It back-fills every referral made before C5b.
- **Tasks:** admin creates and assigns (`CRUD /admin/tasks`, `POST /admin/tasks/:id/assign`); the ambassador submits proof (`POST /ambassador/tasks/:assignmentId/submit`); approval writes `task:<assignmentId>` once (`POST /admin/task-assignments/:id/{approve,reject}`, audited).
- **Teams:** `POST /ambassador/teams` (one per ambassador), `POST /teams/join { code }` (`Roles(student, ambassador)`), `GET /teams/mine` only for members, admins see all (another ambassador's team is 404).
- **Admin:** `GET/PUT /admin/rank-thresholds` (`expected` + audit), `POST /admin/points/adjust { userId, amount, reason }` (a compensating entry, audited).
- **Tests:** the sweep is idempotent and back-fills; one award per task; compensating entries only; rank from thresholds; team visibility; mutation checks on the event key and the visibility check.

## 7. C6 Rounds, jury, certificates (task 6)

The plan update with the exact contracts was approved by the lead on 2026-11-01, on the Q4 defaults (Q4a–e went to the owner through the lead). One PR after another; exam's tables are read only (`exams`, `leaderboard_entries`).

| PR | Content | Status |
|---|---|---|
| C6a rounds + promotion | Rounds as data after Round 1 (windows, video criteria); promotion of the top N per category from Round 1's published snapshot or a video round's jury averages, ties at the cut included, one run per (round, category), `expected` from the preview; `GET /rounds/me`, the home and profile round, the stats' `secondRound`/`finalists`; `/admin/rounds`. Migration CX4 `*_core_rounds` + `_checks` | **Built** (06-API "Rounds", DECISIONS) |
| C6b video + jury | `PUT /rounds/:id/video` (https, a host allow-list: YouTube, Google Drive; inside the window); jury assignment per round and category; blind judging (entry number, category, link); `jury_scores` append-only; the entry's score = the average of each judge's latest total; scoring only after the close and before the promotion. Migration CX5 | **Built** (06-API "Rounds", DECISIONS) |
| C6c-1 certificates | Issued by one queue job from database state (`ON CONFLICT (user_id, type, round_id) DO NOTHING`), serial and a random verification code, the name copied at issue; list, revoke with a reason; the public verify route. Migration CX6 | **Built** (06-API "Certificates", DECISIONS) |
| C6c-2 PDF | The render in the queue (202 then poll, 10 minutes in the cache Redis), after a 30-minute spike and the owner's approval of the library | After the owner approves |

**The lead's notes (binding):**
1. C6b's migration itself runs `REVOKE UPDATE, DELETE ON jury_scores FROM sirat_app`, and the trigger function is named `*_append_only` (A2's catalog test enforces both).
2. Video links: https plus the host allow-list on the server. The jury gets a link (`rel="noopener noreferrer"`, `target="_blank"`) only for allow-listed hosts; never an iframe in v1. Students see their own link as text.
3. Promotion: the typed-count confirmation, `expected` with the results version, one run per (round, category), and the tie count in the preview (built in C6a).
4. Certificates: verify answers only the name and the award, with the same 404 for revoked and unknown codes, throttled. The PDF waits for the owner's library approval and stays "coming soon" until the client's text and signatures arrive.
5. The new `@Public` verify route is announced to A2 before the push (`app-routes.int-spec.ts`).

- **PDF and Bangla:** names need Bangla shaping (conjuncts). The spike compares `pdfkit` (fontkit has an Indic shaper) with `harfbuzzjs` + `pdf-lib` on a fixed list of Bangla names against a reference, and measures the size (target < 150 KB with a font subset). Either is a **new dependency and a lockfile change, approved by the owner before it lands**; the font is self-hosted (OFL), as the web fonts are.
- **Schema:**
  - CX4 (built): `promotion_runs`, `rounds.criteria`, `round_entries.promotion_run_id`, `video_submitted_at`.
  - CX5: `jury_assignments` (UNIQUE NULLS NOT DISTINCT (round_id, judge_id, category)), the `jury_scores` append-only trigger with the REVOKE, total 0–100, comment ≤ 1,000.
  - CX6: `certificates` + `round_id`, `name_on_certificate`, `revoked_at`, `revoked_by`, `revoke_reason`, UNIQUE `(user_id, type, round_id)`, a type CHECK, a serial sequence.

## 8. Cross-cutting

### 8.1 The web's HTTP data source (`apps/web/src/data/http/`)

**Built first, as its own PR (#23, lead 22:58),** so exam (E4/E5) and payments (web days) build on it; pattern note in DECISIONS "Web data layer over HTTP":
- `data/http/index.ts` builds the `DataSource` from per-area files (`http/users.ts`, `http/announcements.ts`, `http/ambassador.ts` here; `http/exams.ts`, `http/leaderboard.ts` for exam; payments adds its own). A method no file implements falls back to `unavailable`, so its page keeps today's error state.
- Calls go server-side with the session cookie through A2's `lib/server-api.ts`, as `lib/session.ts` does.
- `getData()` returns it in production; development keeps the mock unless `DATA_SOURCE=http` (for local runs against this worktree's API). `kind` gains `'http'`.

Each team then adds one file and one line in `index.ts`.

### 8.2 Rules every PR keeps

- Guards: an explicit `@Roles(...)` on every route; no new `@Public()` route except C6's `GET /certificates/verify/:code` (already on 06-API's allow-list); the routes test stays green.
- Identity only from the session; any `:id` is ownership-checked (student routes have no id at all except C6's own certificate, checked against the session).
- DTOs with `whitelist` + `forbidNonWhitelisted`; refusal codes in `ApiError.details`, as exam does.
- Every list paginated on the server (`pageSize` ≤ 100), no unbounded query; admin writes and exports audited in the same transaction as the change.
- No personal data in logs: no names, emails, phones, search terms, addresses, CSV rows.
- API contract first: each PR's first commit updates `06-API.md` (and `05-DATABASE.md` for schema), then DTO, code, tests, UI.

## 9. Pull requests and schedule (estimate, at the measured pace)

**Measured pace in this repo (git):** A2.0–A2.1e about 4.5 h; 18 dashboard pages about 3 h; the first-admin CLI about 1 h; exam E1 (13 endpoints, two migrations, five triggers, tests) about 40 min. Estimates below are sized from that. Nothing is cut to meet a date: every test, mutation check and check of CLAUDE.md DO 11 stays.

**Branches:** each PR on its own branch from `main`; when a PR waits for review, the next one starts from `main` too (they touch different files, section 10). Before every push: `git merge origin/main` (never a rebase, never a force-push), the checks, one line to Rasel and the lead naming the shared files the push changes.

| PR | Branch | Content | Coding (estimate) | Date (estimate) | Needs |
|---|---|---|---|---|---|
| C0 | `feat/core-plan` | This plan (docs only) | ~1 h | Sat 31 Oct | lead review |
| C0b | `feat/web-http-source` | The `data/http` skeleton (8.1), merged as #23 | ~30 min | Sat 31 Oct | lead's order |
| C1 | `feat/core-students` | 06-API; admin users list, detail, CSV export, `common/csv.ts`; admin users page wired | 1.5–2 h | Sun 1 Nov | #23 |
| C2 | `feat/core-public` | Entry, about, privacy, terms, refund-policy (en + bn), `site.ts`, `legal.ts`, `Prose`, footer | ~1 h | Sun 1 Nov | C0; the fee needs payments PR 2's `/registrations/info` (the page works without it); real texts later (small follow-up PR) |
| C3 | `feat/core-profile` | 06-API; `/users/me`, profile options, PATCH, admin grade correction; profile form wired | 1–1.5 h | Mon 2 Nov | payments PR 2 on `main` (`BD_DISTRICTS`, `EDUCATION_TYPES`, `REGISTRATION_MESSAGES`); Q1 |
| C4 | `feat/core-announcements` | 06-API, 05-DATABASE; CX1; `AnnouncementsModule`; student and admin pages wired; dashboard home composed | 1–1.5 h | Mon 2 Nov | C1 (8.1) |
| C5a | `feat/core-ambassador` | 06-API; CX2; approve/revoke, admin list, `/ambassador/me`; the held ambassador panel merged | 1.5–2 h | Tue 3 Nov | Q2; payments PR 2 on `main` (the promo test runs their start route) |
| C5b | `feat/core-ambassador-points` | CX3; referral sweep (worker), tasks, teams, rank thresholds, point adjustments | 2–3 h | Wed 4 Nov coding; review after the launch PRs | C5a; Q3 |
| C6a–c | `feat/core-rounds`, `feat/core-jury`, `feat/core-certificates` | Section 7, after a plan update | 4–6 h | earliest Fri 6 Nov; merged after 15 Nov unless the lead pulls it forward | exam E4/E5 on `main`; Q4; the PDF dependency approved |
| **Total** | | | **about 12–17 h** | | |

**What does not compress (waits, not coding):**
- the lead's review and merge of each PR (about half a day each in the other plans' experience), after the launch PRs of payments and A2;
- payments PR 2 on `main` (C3, C5a);
- Rasel typing the Postgres password into this worktree's `.env` (section 12): until then no migration and no `test:int` here, so C1 cannot open as a PR;
- the owner's answers Q1–Q5 (defaults used otherwise) and the client's texts and business facts (Q5);
- a shared-stack slot for the docker smoke test of each runtime PR (Rasel says "stack তোমার");
- the PDF dependency approval (C6c).

From Thu 5 Nov to the launch: review fixes, the client's texts into C2, and launch work the lead assigns.

## 10. Conflict files: what changes when

| File | When | Handling |
|---|---|---|
| `apps/api/prisma/schema.prisma` | C4 (`Announcement`), C5b (`TaskAssignment`, `Team`, `TeamMember`), C6 | Only core-owned models; no `User` relation change planned. Whoever merges second regenerates (next row) |
| `apps/api/prisma/migrations/*` | C4 (CX1), C5a (CX2), C5b (CX3), C6 (CX4+) | Always after `main`'s last migration. If another migration reached `main` first: `git merge origin/main`, delete the own unmerged generated migration, regenerate it on a fresh `sirat_core` (`prisma migrate dev --create-only`), rename the hand-written ones after it (SQL unchanged), new commit. Never edit a migration on `main`; the CI drift check stays green |
| `apps/api/src/app.module.ts` | C4 (`AnnouncementsModule`, one line) | Told to the lead before the commit |
| `apps/api/src/worker.ts` | C5b (referral sweep), C6c (certificates): one import line each, `CoreWorkerModule` | Payments and exam add theirs next to it: keep all |
| `apps/api/src/modules/admin/admin.module.ts` | Not touched (payments' admin routes) | — |
| `apps/api/package.json`, `pnpm-lock.yaml` | C6c only (PDF library) | Owner approval first; its own commit after `git merge origin/main`; lockfile regenerated, never hand-merged |
| `apps/api/test/helpers.ts`, `db-constraints.int-spec.ts` | Not touched: new `test/core-helpers.ts`, `core-constraints.int-spec.ts` | — |
| `apps/api/test/app-routes.int-spec.ts` | C6c (the verify route, if not yet listed) | Allow-list entry only |
| `packages/shared/src/dashboard.ts` | C1 (`AdminUserRow`, `AdminUserQuery`, `AdminUserDetail`), C3 (`PROFILE_UPDATE_FIELDS` without `gradeLevelId`, `ProfileOptions.districts`), C4 (`AdminAnnouncement`) | Shared with exam and the UI port: `git merge origin/main`, keep both |
| `packages/shared/src/records.ts` | C4, C5b, C6 | Mirror lines for core models only |
| `packages/shared/src/index.ts` | C1 (`export * from './core'`, one line) | — |
| `apps/web/src/data/{source,index,mode}.ts`, `data/http/*`, `data/mock/*` | C1 (skeleton, 8.1), then one file per PR | Agreed with the lead first; exam and payments add their own files |
| `apps/web/src/app/(student)/dashboard/page.tsx` | C4 (home on the HTTP source; no layout change) | Payments adds its registration card in the same file: merge right before the push |
| `apps/web/src/lib/access.ts` | Not expected (the pages exist); C5b `/dashboard/team` if a page is added | One row |
| `packages/ui` | C2 (`Prose`) | New file plus one export line |
| `apps/web/scripts/check-pages.mjs` | C2 (a list of public routes, checked without a session) | A2's and the UI port's script, also used by CI's `web-pages` job: told to the lead first; the dashboard checks are not changed |
| `docs/06-API.md` | Every code PR | Payments and exam edit it too: merge, keep both |
| `docs/05-DATABASE.md` | C4, C5a, C5b, C6 | |
| `docs/07-UI-MIGRATION.md` | C1, C3, C4, C5a (status column; D6 drops `GET /dashboard/home` from the map) | |
| `docs/DECISIONS.md` | One entry per PR; the owner's answers | Union merge driver (DECISIONS 2026-10-31) |
| `docs/OPEN-QUESTIONS.md` | When Q2–Q4 are answered (#12–#15) | Other rows untouched |
| `docs/RUNBOOK.md` | C1 (handling an exported CSV: delete after use), C5a (approving an ambassador), C6c (issuing and revoking certificates) | One subsection each |
| Shared docker stack | Smoke test of each runtime PR | Only after Rasel says "stack তোমার", only `$DCD up -d --build --no-deps migrate api worker web nginx`, the result to Rasel in one line |

## 11. Risks

1. **Public pages in two plans** (A2's launch gap of 22:26 and this plan): the lead decides; this plan assumes it owns them (lead, 22:40).
2. **PayStation's approval needs the site live with real texts** on the client's domain and VPS (payments plan 10.2: live merchant by Tue 10 Nov). Placeholders alone may be refused; the client's texts and business facts (Q5) are on the critical path, not the code.
3. **Search terms in nginx logs:** `/admin/users?q=` is a web page URL, and nginx's `combined` format logs query strings, so names, emails and phones searched by an admin reach nginx's log (07-UI-MIGRATION "Remaining work"). The infra commit that drops the query string should land before launch (A2's launch plan); the export is a POST for that reason.
4. **Exported CSVs leave the system:** minors' personal data on an admin's computer. Mitigated by admin only, reason, audit, rate limit and the RUNBOOK rule to delete the file after use; not preventable in code.
5. **Phone race with payments:** a student changing their phone and a new registration claiming the same number in the same moment. The open-attempt check makes it a few-millisecond window; if it happens, payments' settlement records `phone_taken` with a critical alert (money taken, no account). A transaction-level advisory lock on the phone in both places would close it, but it changes payments' code: proposed to the lead, not assumed.
6. **Role change through the token:** an approval or revocation takes up to 15 minutes to reach the ambassador's pages (the token's lifetime); the API re-reads the role for core writes.
7. **Bangla in PDFs** (C6c): shaping may fail with a plain PDF library; the spike decides before any dependency lands.
8. **Four sessions on one machine:** own databases, Redis DB 3 and ports 4300/4301 (section 12); time-based tests get generous margins.

## 12. Local environment: working next to A2, payments and exam

- **This worktree's `apps/api/.env`** (git-ignored) was built by a script from the committed `apps/api/.env.example` on 2026-10-31; nobody else's `.env` was opened, copied or shown. The script printed key names only. Changed: `DATABASE_URL`, `DIRECT_URL` → `sirat_core`; `TEST_DATABASE_URL` → `sirat_core_test`; both Redis URLs end in `/3`; `PORT=4300`, `WORKER_HEALTH_PORT=4301`; a fresh random `JWT_ACCESS_SECRET` (never printed).
- `DATABASE_URL` connects straight to Postgres (`127.0.0.1:15432`): the dev PgBouncer serves only `sirat` (payments plan §15). Local timings therefore leave PgBouncer out.
- **Rasel types the dev Postgres password** into the three database URLs himself (the example's placeholder is still there); Claude never reads or prints it.
- **Shared docker stack (project `sirat`):** no `up`, `down`, smoke test or e2e from this worktree until the lead says "stack তোমার"; then only the app services, with `--build`, never wrapped in a timeout; the result to Rasel in one line.
- **Cleanup after the core work merges** (only with Rasel's OK): drop `sirat_core` and `sirat_core_test`, flush Redis DB 3, remove the worktree.

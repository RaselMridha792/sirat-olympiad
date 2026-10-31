# Registration + PayStation payments: plan

Written on 2026-10-31 on branch `feat/payments-plan` and revised the same day after the lead's review (git rules, dev fixtures, host allow-list, local isolation, IPN without a VPS, PR split). Merged into `main` as docs-only PR #11. The schedule (section 10) was rewritten the same day at the measured pace, in the first commit on `feat/payments-foundation`. Target: **15 November 2026**.

Sources: RULEBOOK §7.1, §8, §18; `10-BUILD-PLAN.md` Phase C Definition of Done; `05-DATABASE.md`; `06-API.md`; `paystation/PAYSTATION-NOTES.md`; `paystation/SANDBOX-CHECKLIST.md`; DECISIONS (A1, PayStation 2026-10-30, A2.1d/e and the 2026-10-31 entries this plan adds). Nothing is copied from `reference/` (the old code had an unauthenticated refund endpoint, among other bugs): ideas are ported, never code. No PayStation credential appears in any file, note or log.

The five questions that block code are in section 2. Q1–Q4 are answered by the owner, and Q5 keeps its default. The smaller choices D1–D10 there use their defaults; the owner can override any of them at review.

## 0. Scope of the first release

- **Registration and payment only.** The flow ends when the student logs in and sees their own registration and payment status on the dashboard. No part of the exam engine is needed or touched.
- **Order change:** this release comes before the exam engine, instead of the phase order in `10-BUILD-PLAN.md` (DECISIONS 2026-10-31 "First release"). The Phase C Definition of Done (17 points) still applies in full (section 11).
- **Also in scope (owner, 17:37):** a free book after payment, with a delivery address (section 16).
- **Out of scope:** exam engine, referral points (only the referrer link is stored), certificates, ambassador dashboard, public marketing pages (Phase D).
- **Dependencies:**
  - A2's web session (web login replacing the mock in `apps/web/src/lib/session.ts`) must be merged before the web steps (step 10, by Wed 4 Nov). The student dashboard needs a real login.
  - Production email needs the SES sending domain (OPEN-QUESTIONS #16); until then only Mailpit.
  - DoD #16's "one real small payment" needs the client's PayStation account (section 13).
  - The VPS (OPEN-QUESTIONS #22) has not been delivered. Without it, there is no staging stack and no deployment. Section 8.1 explains how to test the IPN without it.
- **Flow model stays pay-then-account** (scaffold decision #9). The form is stored on the server, and the account is created inside the transaction that marks the payment paid.

## 1. Decisions this plan builds on (2026-10-31)

1. **Fee in the database** (Rasel): `settings.registration_fee_minor = 40000` (400 BDT in paisa, an integer). A migration sets it; only an admin can change it, after a confirmation, and every change is audit-logged. This replaces the same-day idea of `REGISTRATION_FEE_BDT` in `.env`, which was never built.
2. **Snapshot:** when a payment starts, the server copies the fee into the payment row. The server never accepts an amount from the client. The amount PayStation reports must match the row.
3. **`pay_with_charge = 0`** (Rasel, Q1): the student pays exactly 400 BDT and the merchant bears PayStation's charge. Only this path is built. Any other configured value stops the API at boot (fail closed). There is no charge column and no v2 amount rule.
4. **PayStation account settings from `.env`**: credentials, account label, invoice prefix, callback URL and IPN URL. Rasel's own test account (sandbox) now; the client's account later (checklist in section 13). **The host comes from a two-entry allow-list** in `payment.config.ts` (sandbox, live), picked by `PAYSTATION_ENV`. A free URL is accepted only for the fake server (section 3.5).
5. **First release before the exam engine** (section 0).
6. **Form fields** (Rasel, Q2): the default in section 2 is approved.

## 2. Questions that block code (owner)

Status (lead, 2026-10-31):
- **Q1–Q4 are answered** by Rasel: DECISIONS "Gateway charge", "Registration form fields", "Duplicate email and phone at registration" and "No refund handling".
- Q5 keeps its default (lead, 2026-10-31).
- **Final (owner, 17:35):** email and phone are both unique; nobody can use another person's email or phone. Nothing else is built: no OTP, no admin tool to free a number, no extra flow.

| # | Question | Answer, or proposed default | Blocks |
|---|---|---|---|
| Q1 | ~~**`pay_with_charge` (P6):** does the student (1) or the merchant (0) pay PayStation's charge?~~ | **Answered (Rasel, 2026-10-31): `0`.** The student pays only 400 BDT; the merchant bears the charge. Only `0` is built; any other value stops the API at boot. Still verified in the sandbox (S10). | Step 1 (config), step 3 (amount rule), step 12 (S10) |
| Q2 | ~~**Registration form fields:** which fields, which required?~~ | **Answered (Rasel, 2026-10-31): the default is approved.** The old wizard's set (07-UI-MIGRATION): name, phone (BD mobile, `01XXXXXXXXX`), district, institution, education type, grade level (the 17 rows of `grade_levels`), email, password (8–128), promo code (optional). All required except the promo code. Nothing else: no date of birth, gender, guardian or photo (minimum data for minors). | Step 4 |
| Q3 | ~~**Duplicate email/phone messages (DoD #4):** what does the student see?~~ | **Answered (Rasel, 2026-10-31):**<br>(a) **The email already has an account:** bn "এই email দিয়ে আগেই রেজিস্ট্রেশন হয়েছে। অনুগ্রহ করে login করুন।", en "Already registered. Please log in." No password-reset wording; the login page link stays as it is. Rate-limited per IP and per email, as planned.<br>(b) **The same email has a payment in progress** from another browser: the default stays. "A payment for this email is already in progress. Continue in the browser where you started, or try again after it expires (at most 60 minutes)." The same browser resumes automatically.<br>(c) **Phone numbers are unique:** one number, one student. Stored in one form `01XXXXXXXXX`; the server normalises `017…`, `+88017…` and `88017…` to it. Message: bn "এই ফোন নম্বর দিয়ে আগেই রেজিস্ট্রেশন হয়েছে। অন্য নম্বর দিন।", en "This phone number is already registered. Please use another number." Rate-limited like the email.<br>(d) **Any phone conflict** (an account has the number, or an attempt under another email is in progress) gets the one message of (c); there is no separate text (owner, final). | Step 1 (constraints), step 4 |
| Q4 | ~~**Refund → access (P8):** what happens to a refunded student?~~ | **Answered (Rasel, 2026-10-31): no refund handling.**<br>- No code moves a payment to `refunded`, no admin reconcile to it, no refund text on the dashboard, and no tests for them. The enum value stays (no migration), and the transition trigger never allows it.<br>- When PayStation reports a refund for a paid payment (status API or IPN), the status does not change: `payment_events` gets `refund_reported` and a critical alert is raised (tested). | Step 3, step 6 |
| Q5 | **Checkout expiry:** after how long is an unpaid payment given up? | 60 minutes (`settings.payment_expiry_minutes`, already seeded), raised to PayStation's link lifetime once the sandbox shows it (S12); never shorter than that lifetime (D3). Expired and failed payments keep being re-checked for 48 h for a late success. | Step 8 |

**Defaults taken in this plan (not blocking; say if you disagree):**

| | Default |
|---|---|
| D1 | Payments point to the registration attempt (N payments : 1 attempt), so "try again" needs no new form and "one active payment per attempt" is a DB constraint (changes 05-DATABASE's `pending_registrations UNIQUE(payment_id)`). |
| D2 | No automatic login after payment: the student logs in with the password they chose. |
| D3 | **Changed by the owner (Q4):** a second or late paid payment (`duplicate_payment`) is still detected, raises a critical alert and shows in the admin review list. Whether the money is returned is outside our system (client, PayStation panel). So the paths to a double charge stay closed: at most one attempt in progress per email and per phone, and the checkout expiry is never shorter than PayStation's link lifetime (S12). |
| D4 | An invalid or unapproved promo code is a field error; the student can remove it. |
| D5 | A fake PayStation server lives in `tools/fake-paystation` for dev and CI, never in a production image. |
| D6 | Retention: a completed attempt's form data is cleared at once; an abandoned attempt's after 30 days; stored gateway payloads keep only the last 3 digits of the payer's phone. |
| D7 | No retry after registration closes; an admin can move `registration_closes_at`. |
| D8 | Sandbox tests that need the IPN run on a separate staging stack on the VPS (own compose project, database and volumes), never on the production database. Until the VPS exists: this worktree's own API and worker, reached through a temporary tunnel, sandbox only (section 8.1). |
| D9 | The client's credentials: the owner receives them and types them into the production server's `.env`; the password is rotated after go-live if anyone else saw it. |
| D10 | Registration endpoints live in the existing `PaymentsModule`, admin endpoints in the existing `AdminModule`, so `app.module.ts` does not change. |

## 3. Configuration

### 3.1 settings table (database, changed only by an admin)

| Key | Value | Notes |
|---|---|---|
| `registration_fee_minor` | `40000` | Set by migration (section 4.3); seed default also 40000 |
| `currency` | `'BDT'` (exists) | A payment refuses to start with anything else; not editable |
| `registration_open` | `false` (exists) | Master switch |
| `registration_opens_at` | `null` (new) | ISO UTC; `null` = no lower bound |
| `registration_closes_at` | `null` (new) | ISO UTC; `null` = no upper bound |
| `payment_expiry_minutes` | `60` (exists) | Q5; copied into `payments.expires_at` |

- **Registration is open** when `registration_open` is true, `now ≥ opens_at` (if set) and `now < closes_at` (if set), by the server clock.
- This is checked at **start** and **retry** only, never when settling a payment that already started. A student who paid is registered even if registration closed in the meantime; the old system sent paid users to a "closed" page.
- `start` reads the database directly (the snapshot must be the current fee). The public `GET /registrations/info` is cached in the cache Redis for 30 s and invalidated by every settings write.

### 3.2 Fee rules

- A valid fee is a JSON integer, greater than 0, a multiple of 100 (PayStation takes whole taka), and between 1,000 and 1,000,000 paisa (10–10,000 BDT; the bounds catch a typo such as an extra zero).
- **Fee 0, negative or otherwise invalid:** the server does not start a payment. `start` answers 503 "Registration is temporarily unavailable" and raises an alert (`payments.fee_invalid`). `GET /registrations/info` shows registration as closed. PayStation is never called.
- **DB guard:** a CHECK on `settings` for this key (`value` is a JSON number, > 0, a multiple of 100). The admin endpoint also enforces the bounds.

### 3.3 Migration and seed order (the `migrate` job runs migrations first, then the seed; the seed inserts only missing keys)

An UPDATE-only migration would do nothing on an empty database, and the seed would then insert 0. So the data migration upserts:

```sql
-- Insert the fee when the key is missing; change it only while it is still the placeholder 0.
WITH changed AS (
  INSERT INTO "settings" ("key", "value", "created_at", "updated_at")
  VALUES ('registration_fee_minor', '40000'::jsonb, now(), now())
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()
  WHERE "settings"."value" = '0'::jsonb
  RETURNING "key"
)
INSERT INTO "audit_logs" ("id", "action", "entity_type", "entity_id", "meta", "created_at")
SELECT gen_random_uuid(), 'settings.registration_fee_set', 'setting', "key",
       '{"to": 40000, "by": "migration"}'::jsonb, now()
FROM changed;
```

- Empty database → 40000 (plus an audit row). Database with 0 → 40000 (plus an audit row). Database with any other value (an admin already chose one) → untouched, no audit row.
- `seed.ts`: the placeholder `registration_fee_minor: 0` becomes `40000`, so both paths agree; `registration_opens_at` and `registration_closes_at` (`null`) are added.
- This migration runs **before** the one that adds the CHECK on `settings` (section 4.2), so an existing 0 never makes the CHECK fail.
- Tests (`apps/api/test/settings-fee.int-spec.ts`): the three cases above, run through `prisma migrate deploy` + the seed in the real order.

### 3.4 Changing a setting: admin only, confirmed, audited

**Server:** `PUT /admin/settings/:key` (Role admin only; not manager), body `{ value, expected, reason }`.
- Only keys on an allow-list are editable, each with its own validator: `registration_fee_minor`, `registration_open`, `registration_opens_at`, `registration_closes_at`, `payment_expiry_minutes`.
- `expected` is the value the admin's form showed. One transaction: `SELECT … FOR UPDATE` on the row; if the current value differs from `expected`, answer **409** "This setting was changed by someone else. Reload and check." So an old form never overwrites someone else's change.
- `reason` is required for the fee (3–200 characters).
- The same transaction writes the audit row: `settings.changed`, key, old value, new value, reason, admin id, IP.
- After the commit: the Redis cache is invalidated.
- Later, with admin 2FA (end of Phase A): a fee change asks for a fresh second factor.

**UI:** the admin edits the fee in taka. A confirmation dialog shows the old and the new value side by side ("৳400 → ৳450"), states that payments already started keep their old amount, and requires the reason. The confirm button sends `expected` = the old value. A 409 shows the current value and asks the admin to start again.

### 3.5 env: the PayStation account (the host from an allow-list in code)

PayStation's host is the same for every merchant, so it does not depend on the account. `payment.config.ts` is the only source file that names a PayStation host:

```ts
const PAYSTATION_HOSTS = {
  sandbox: 'https://sandbox.paystation.com.bd', // S11 confirms or changes this one line
  live: 'https://api.paystation.com.bd',
} as const;
```

Why it is not free in `.env` (lead review): with a free URL, a dev machine with `PAYSTATION_ENV=sandbox`, the live host and live credentials would take real money, and no guard would notice. With the allow-list, a dev machine reaches only the sandbox host. Live credentials sent there fail at the gateway, and no money moves.

| Variable | Example | Rule |
|---|---|---|
| `PAYSTATION_ENV` | `sandbox` | `sandbox`, `live` or `fake`. Picks the host from the allow-list. `live` is refused unless `NODE_ENV=production`; `fake` is refused in production. |
| `PAYSTATION_BASE_URL` | blank | Optional for `sandbox` and `live`: when set, it must equal that label's allow-listed host, or the API does not boot. Required for `fake`, where any `http(s)://` URL is accepted (the fake server, e.g. `http://127.0.0.1:18090`). The host in use is logged at boot. |
| `PAYSTATION_MERCHANT_ID`, `PAYSTATION_PASSWORD` | blank | Required unless `fake`. Placeholder words refused (same check as secrets). Never logged; the boot log shows only the last 4 characters of the merchant id. The example files carry blanks (today they say `fake`). |
| `PAYSTATION_ACCOUNT_LABEL` | `rasel-sandbox` | Required, `^[a-z0-9-]{3,32}$`. Copied into every payment (`payments.gateway_account`), so a payment is never verified with another account's credentials. |
| `PAYSTATION_INVOICE_PREFIX` | `T` | Required, 1–3 uppercase letters or digits. Starts every invoice number, so test invoices stand out in our database and in PayStation's panel (`T` test, `S` client live). |
| `PAYSTATION_CALLBACK_URL` | `http://localhost:8080/api/payments/paystation/callback` | Required (the name already exists). The code appends `/<invoice>`. Boot fails if the longest possible URL is over 200 characters, if it is not `https://` (except `fake`), or if its path is not our callback route. It may differ from `APP_URL` (a tunnel). |
| `PAYSTATION_IPN_URL` | `https://<public-host>/api/payments/paystation/ipn` | Required unless `fake`. Not sent to PayStation: the IPN URL is registered by hand in PayStation's merchant panel. Checked at boot (https, our route), logged at boot, used by the fake server and by the switch checklist. |
| `PAYSTATION_PAY_WITH_CHARGE` | `0` | Required, and only `0` is accepted (Q1); any other value stops the API at boot (fail closed). It stays a variable so that a client contract with another value fails loudly instead of being ignored. Sent to PayStation and copied into each payment (`pay_with_charge` false). |
| `PAYSTATION_TIMEOUT_MS` | `10000` | Per gateway call. |
| `PAYMENT_RECONCILE_EVERY_SECONDS` | `120` | Repeatable job interval (RULEBOOK: 2–5 min). |
| `PAYMENT_RECONCILE_MIN_AGE_SECONDS` | `120` | Younger payments are not queried. |
| `PAYMENT_LATE_WATCH_HOURS` | `48` | How long failed and expired payments are re-checked for a late success. |
| `PAYMENT_RESULT_PATH` | `/payment/result` | Callback redirect target (DoD #11), joined to `APP_URL` (required unless `fake`). |

- **One accessor:** `PaymentConfig` (`apps/api/src/modules/payments/payment.config.ts`), built from `EnvVars`. A source scan (a unit test over `apps/` and `packages/`, also covering both `.env.example` files) fails if `paystation.com.bd` appears in any file other than `payment.config.ts`. The docs are not scanned.
- **Where:** both `.env.example` files get a "Registration and payments" block appended at the end, with `PAYSTATION_BASE_URL` blank. The root file's `PAYSTATION_BASE_URL=https://sandbox.paystation.com.bd` line is removed. The CI integration job gets `PAYSTATION_ENV=fake`. Compose needs nothing (`api` and `worker` load `../.env`).
- **If S11 shows that the sandbox uses the live host:** the allow-list then cannot tell sandbox from live. The guard falls back to credential discipline (13.1 #6) and the boot log, and the owner is asked before step 12.
- **Local sandbox tests:** the callback is a browser redirect, so `localhost` works; the IPN is server-to-server and needs a public `https://` URL (D8, section 8.1).

## 4. Migrations, from the existing schema

### 4.1 What exists today (`schema.prisma`, migrations `*_init`, `*_db_checks`, `*_review_hardening`)

| Table | Columns and constraints today |
|---|---|
| `payments` | `id`, `user_id` NULL (FK RESTRICT), `invoice_number` UNIQUE, `amount_minor` int, `currency` default `'BDT'`, `status` (`PaymentStatus`, default `initiated`), `trx_id` UNIQUE NULL, `pay_with_charge` default `true`, `gateway_payload` json NULL, `expires_at`, `paid_at`, timestamps. Indexes `(status, created_at)`, `(user_id)`. CHECKs `amount_minor > 0`, `status::text <> 'paid' OR (trx_id AND paid_at NOT NULL)`. |
| `pending_registrations` | `id`, `payment_id` UNIQUE (FK), `payload` json, `consumed_at`, timestamps. |
| `registrations` | `id`, `user_id` UNIQUE (FK), `payment_id` UNIQUE (FK), timestamps. |
| `settings` | `key` PK, `value` json, timestamps. Seeded keys include `registration_fee_minor = 0` (placeholder). |
| `PaymentStatus` enum | `initiated`, `pending`, `paid`, `failed`, `expired`, `refunded` (kept as is: no enum migration). |

### 4.2 Migrations needed (all on step 1, in this order)

**M1 `<ts>_payments_registration`** (generated by Prisma)
- Starts with a guard: if `payments` or `pending_registrations` has any row, stop with a clear message. This is pre-launch only, and the new NOT NULL columns have no meaningful backfill. The migration never deletes data, and the guard leaves a failed record that must be marked rolled back.
- **The trap (lead review, 17:05):**
  - main's dev fixtures left 3 paid payments in the shared dev database `sirat`;
  - older test runs leave payment rows in `*_test` databases.
  - Without a way out, the next `up --build` would stop at the `migrate` job, and A2's `test:int` would stop too.
- **The way out, in PR 1:**
  - **Dev:** `db:fixtures:dev --clean`, behind the same guards as the fixtures (NODE_ENV, `ALLOW_DEV_FIXTURES`, local URL, server marker). It removes only the payments and registrations of `@fixtures.invalid` users. RUNBOOK section 0 gives the order: clean → migrate → seed → fixtures. On the shared database it runs only after Rasel says so.
  - **`*_test`:** `prepare-test-db.mjs` empties the three payment tables while M1 is not yet applied, and marks a failed try rolled back.
  - Both are proven by `payments-migration.int-spec.ts`, on a throwaway database at main's earlier schema with the old fixtures, and once by hand on `sirat_pay`.
- New enum `RegistrationAttemptStatus`: `open`, `completed`, `abandoned`, `conflict`.
- `pending_registrations` (one registration attempt):
  - drop `payment_id` (its UNIQUE and FK go with it) and `consumed_at`;
  - add `status`, `email` citext NOT NULL, `phone` NOT NULL (normalised), `name` NOT NULL, `payload` jsonb NULL (rest of the form, including the argon2id `password_hash`; never the plain password), `payload_version` int, `start_request_id` uuid UNIQUE (double-click idempotency), `resume_token_hash` UNIQUE (SHA-256 of the `sirat_reg` cookie token), `referred_by_id` NULL (FK users RESTRICT), `user_id` NULL UNIQUE (FK users RESTRICT), `completed_at` NULL;
  - indexes on `email`, `phone`, `referred_by_id`, `(status, updated_at)`.
- `payments`:
  - add `pending_registration_id` NOT NULL (FK RESTRICT, indexed), `gateway_account` text NOT NULL (with `status` in an index), `paid_amount_minor` NULL (the amount PayStation reported, kept as a record), `payment_url` NULL, `gateway_status` NULL, `last_checked_at` NULL, `check_count` default 0, `review_reason` NULL;
  - drop `gateway_payload` (replaced by `payment_events`);
  - drop the defaults of `currency` and `pay_with_charge` (always set explicitly).
- New `payment_events` (append-only): `id`, `created_at`, `payment_id` NULL (NULL for an unknown invoice; **not a foreign key**, like `audit_logs.actor_id`. With a FK, the TRUNCATE trigger would make `payments` untruncatable, and every test's `truncateAll` would fail; `truncateAll` skips this table), `source` (`initiate`, `callback`, `ipn`, `status_v1`, `admin`), `invoice_number`, `trx_id` (as received), `outcome` (`applied_paid`, `applied_failed`, `applied_expired`, `refund_reported`, `no_change`, `duplicate`, `rejected_amount`, `rejected_invoice`, `unknown_invoice`, `not_found_2001`, `unknown_status`, `unavailable`, `account_mismatch`), `status_code`, `trx_status`, `payload` jsonb (redacted: no merchant credentials, payer phone masked; at most 16 KB), `actor_id` NULL. Indexes `(payment_id, created_at)`, `trx_id`, `invoice_number`.
- `users`: `phone` becomes UNIQUE (Q3 c; `phone @unique` in Prisma). NULL stays allowed and does not collide, e.g. admins made by the CLI. Otherwise `User` gets only back-relation fields. A database that already holds two users with one phone fails this step with a clear error; ask the owner before cleaning anything. Production has no users yet.

**M2 `<ts>_registration_fee_400`** (hand-written data migration): the upsert in section 3.3.

**M3 `<ts>_payments_checks`** (hand-written SQL, kept apart from M1 so regenerating M1 never loses it; enum CHECKs compare `::text`):
- `payments`: `amount_minor % 100 = 0`; `currency = 'BDT'`; `status = 'paid'` requires `paid_amount_minor = amount_minor`; `invoice_number ~ '^[A-Z0-9]{10,20}$'`; `trx_id <> ''`.
- `pending_registrations`: `status = 'completed'` exactly when `user_id` and `completed_at` are set.
- Partial unique indexes:
  - `payments (pending_registration_id) WHERE status IN ('initiated','pending')`: one active payment per attempt;
  - `pending_registrations (email) WHERE status = 'open'`: one attempt in progress per email (Q3 b);
  - `pending_registrations (phone) WHERE status = 'open'`: one attempt in progress per phone (Q3 d). Not extra logic: it is what makes "one number, one student" hold, and with no refunds it stops two people being charged for one number.
- Phone format (Q3 c): `users.phone IS NULL OR users.phone ~ '^01[3-9][0-9]{8}$'`, and the same pattern on `pending_registrations.phone`. One stored form makes the uniqueness real: `017…`, `+88017…` and `88017…` can never sit side by side.
- Triggers: `payments_status_transition` (a new row must be `initiated`; refuses any status change not in section 5); `registrations_payment_paid` (a registration's payment must be `paid`; the Phase C item deferred in the A1 review); append-only on `payment_events` (UPDATE, DELETE, TRUNCATE refused, like `audit_logs`).
- `settings`: the fee CHECK from section 3.2.

**Deliberately not unique:** "paid" per attempt. A late success on an expired payment is real money; it is recorded as `paid`, flagged `duplicate_payment` with a critical alert, and listed for admins. Returning the money is outside our system (D3). One payment ↔ one registration stays on `registrations` (`UNIQUE(user_id)`, `UNIQUE(payment_id)`).

**Invoice number:** `PAYSTATION_INVOICE_PREFIX` + `yymmdd` (Dhaka date) + 10 random Crockford base32 characters (50 bits): 17–19 uppercase letters and digits. A collision (P2002) generates a new one, at most 3 times. Never reused.

The test helper `paymentData()` (`apps/api/test/helpers.ts`), `db-constraints.int-spec.ts` and `seed.int-spec.ts` change in the same commit. So do the dev fixtures (section 4.4). Otherwise the fixtures break the moment M1–M3 land.

### 4.3 Retention (D6)

On completion `payload` becomes NULL at once (the account holds the data now; the password hash leaves the pending row). Abandoned attempts: a daily job clears `payload` after 30 days; email, phone and name stay while a payment of the attempt exists (payment lookups).

### 4.4 Dev fixtures (step 1, with M1–M3)

**Today**, `apps/api/prisma/fixtures/dev-fixtures.ts` creates three verified students (`student1..3@fixtures.invalid`, password `FIXTURE_PASSWORD`). Each has a paid payment and a registration. The payment uses the old columns: amount 100, invoice `FIXTURE-INV-n`, trx `FIXTURE-TRX-n`, no attempt.

**It breaks after M1–M3 on:**
- `pending_registration_id` NOT NULL and `gateway_account` NOT NULL;
- `currency` and `pay_with_charge` without defaults;
- the invoice CHECK `^[A-Z0-9]{10,20}$` (the hyphens);
- the `paid_amount_minor` CHECK;
- the transition trigger (a new row must be `initiated`; today it is inserted as `paid`);
- the `registrations_payment_paid` trigger, which today's order happens to satisfy.

**New version**, one transaction per student, in the same order the real flow uses:

1. Create the user, as today, now with a distinct phone `0170000000n` (`01700000001`…`01700000003`; `users.phone` is UNIQUE).
2. Create a `completed` attempt: the fixture email, the same phone, name, `user_id`, `completed_at`, `payload` NULL.
3. Insert the payment as `initiated`:
   - invoice `FX` + 14 digits;
   - `gateway_account = 'dev-fixture'`;
   - amount 40000, currency `BDT`, `pay_with_charge` false.
4. Move the payment to `pending`.
5. Move it to `paid`: trx `FIXTURETRX000n`, `paid_amount_minor` 40000, `paid_at`.
6. Create the registration.

**What must not change** (A2's web-session CI "Dashboard pages" job and its e2e log in as `student1@fixtures.invalid`):
- `student1..3@fixtures.invalid` log in exactly as before, with the password from `FIXTURE_PASSWORD`;
- the guards stay as they are: `NODE_ENV`, `ALLOW_DEV_FIXTURES`, the local-URL check and the server marker (`guard.ts` untouched);
- idempotency stays: existing fixture users are skipped.

`PaymentConfig` refuses `FX` and `X` (the selfcheck) as account prefixes.

**Test:** the script is split into an exported `loadDevFixtures(prisma)` and the existing CLI wrapper with its guards. `guard.ts` is unchanged. A new `apps/api/test/dev-fixtures.int-spec.ts` runs the loader twice against the test database and checks:
- three users, each with a `paid` payment, a `completed` attempt and a registration. The rows pass every M3 CHECK and trigger, because the inserts would fail otherwise.
- the second run creates nothing.
- a fixture student logs in through `POST /auth/login`. This is the path A2's web-session CI page check depends on (section 12).

**Before PR 1 opens:** `git merge origin/main` (A2's web session included, if merged by then). The CI "Dashboard pages" job must be green on the PR. A local e2e run uses the shared docker stack, so it happens only when Rasel says so (section 15).

## 5. Payment state machine

| From → to | Trigger | Notes |
|---|---|---|
| `initiated → pending` | initiate answered `"200"` with a `payment_url` | The URL is stored before it goes to the client. |
| `initiated → failed` | initiate refused, timed out or errored | Safe: no checkout URL ever reached the student. They can retry with a new invoice. |
| `pending → paid` | verified success (6.3) | Account created in the same transaction. |
| `pending → failed` | verified `trx_status` `failed` | Not final while the checkout may still be retried (S18); re-checked until `expires_at` plus the late watch. |
| `pending → expired` | past `expires_at`, the gateway reports no success | Alert when the last answers were 2001 or unknown. |
| `failed → paid`, `expired → paid` | verified success arrives late | Money taken wins: `late_success`; if another payment already completed the attempt, `duplicate_payment` (critical alert, admin list, D3). |
| `pending/failed/expired → paid` (admin) | manual reconcile: `trx_id` and reason required, audit-logged, only after a re-check shows success the automatic rule could not apply | RUNBOOK §11 |
| anything else | refused by the app and by the trigger | Example: a stale "failed" never downgrades `paid` (recorded `no_change`, alerted). |

**`refunded` is never entered** (Q4, no refund handling). The enum value stays; the app has no path to it and the trigger refuses it. A refund that PayStation reports for a paid payment is recorded as `refund_reported` with a critical alert; the payment stays `paid`.

**No transition** for 2001, unknown or empty `trx_status`, `processing`, timeouts/5xx, or an amount/invoice mismatch: the event is recorded and alerted (critical for a mismatch).

**Attempt:** `open → completed` (paid, account created) · `open → abandoned` (cancelled or started over; or no active payment and the last one final for 24 h) · `open → conflict` (paid, but the account could not be created, e.g. the email was taken meanwhile). The last three are final.

## 6. Flows and their order

Rules: never hold a DB transaction across an HTTP call to PayStation. Every status call runs in the worker's `payments.verify` queue (one place to cap concurrency; API handlers stay fast), deduplicated per payment while one is waiting or running. Settling is idempotent under `SELECT … FOR UPDATE` anyway.

### 6.1 Start: `POST /registrations/start` (public, rate-limited per IP and per email)

1. DTO with the Q2 fields; no `role`, no amount; unknown fields → 400. Registration must be open (403). The fee and currency must be valid (503 + alert).
2. The phone is normalised on the server to `01XXXXXXXXX` (`normalizeBdMobile` in `packages/shared`, used by the DTO; the web uses it only for hints). Then:
   - email with an account → 409 with the Q3 a text;
   - phone with an account → 409 with the Q3 c text;
   - a promo code that does not belong to an approved ambassador → 400 field error (D4).
   Rate limits per IP, per email and per phone.
3. The same `start_request_id` again → the same result. The same browser (live `sirat_reg` cookie) with an active payment for this email → that payment's URL (resume).
4. argon2id on the password.
5. Transaction 1: lock any open attempt for this email or this phone. Active, unexpired payment → 409 (Q3 b for the email; for the phone, the one phone message of Q3 c, d). All its payments final → mark it `abandoned`. Insert the attempt (`open`) and the payment (`initiated`, new invoice, fee and currency snapshot from `settings`, `pay_with_charge` and `gateway_account` snapshots, `expires_at` from `payment_expiry_minutes`). Commit.
6. `gateway.initiate` outside the transaction; record the event.
   - Created → transaction 2: `pending` + `payment_url`. Answer 201 `{ paymentUrl }` and set `sirat_reg` (httpOnly, Secure, SameSite=Lax so it returns on PayStation's top-level redirect, Path `/api/registrations`, 7 days).
   - Refused or timed out → `failed`, 502 "The payment could not start. Please try again."

### 6.2 Callback: `GET /payments/paystation/callback/:invoice` (public; a hint only)

Check the invoice format, find the payment, record the event (query string kept, values truncated). If the payment is active or inside the late watch, enqueue a high-priority verify. Answer 303 to `APP_URL` + `PAYMENT_RESULT_PATH`. An unknown invoice gets the event and the same redirect. Status is never read from query parameters. A POST variant only if the sandbox shows PayStation uses POST (S16); the owner then reviews its CSRF exemption.

### 6.3 Verify job (worker): the only code that marks paid or failed

0. `payments.gateway_account` differs from `PAYSTATION_ACCOUNT_LABEL` → no call, `account_mismatch`, alert.
1. v1 status by invoice; record the event.
2. Classify: `"200"` with lowercased `trx_status` `success`/`successful` → **paid** only if `trx_id` is non-empty and unused, `data.invoice_number` is ours, `reference` is our payment id (when echoed, S19) and the amount rule passes. `failed` → failed. `refund` on a paid row → no change: `refund_reported`, critical alert (Q4). `processing`/other → no change (alert if unknown). 2001 → no change (alert if it repeats). Timeout, 5xx, bad JSON → no change, retry with backoff.
3. Amount rule (`pay_with_charge = 0` only, Q1; strings parsed to paisa, never floats: `"400"`, `"400.00"`, `400` → 40000):
   - **paid only if** v1 `payment_amount` equals the payment's own `amount_minor` exactly; then `paid_amount_minor` = that reported amount.
   - Lower, higher or missing → never paid: `rejected_amount`, critical alert, an admin decides.
   - v2 (`/v2/transaction-status`) is not used.
4. Transaction: lock the payment `FOR UPDATE`, re-read, apply the transition (already paid with this `trx_id` → `duplicate`). On paid, consume the attempt atomically (RULEBOOK §18): `UPDATE pending_registrations SET status = 'completed', … WHERE id = $1 AND status = 'open' RETURNING payload`.
   - One row → create the user (role always `student`, category from `grade_levels`, `referred_by_id`), the registration, `payments.user_id`, `payload` NULL, an audit row.
   - No row → another payment completed the attempt: paid with `duplicate_payment`, alert.
   - `users.email` or `users.phone` UNIQUE hit (an account was made meanwhile) → roll back. A second transaction marks the payment paid with `email_taken` or `phone_taken`, sets the attempt to `conflict`, and raises a critical alert (money taken, no account).
5. After the commit: enqueue "registration complete, please verify your email" (A2's email queue; `enqueue` never throws; verification stays lazy).

### 6.4 IPN: `POST /payments/paystation/ipn` (public, CSRF-exempt)

JSON, at most 16 KB. 1) Store the event (redacted) first; database down → 503 so PayStation retries. 2) Unknown invoice → `unknown_invoice`, alert, 200. 3) A success `trx_status` for a payment already paid with the same `trx_id` → `duplicate`, 200. 4) Otherwise enqueue a verify, 200. An IPN that shows a refund for a paid payment therefore reaches the verify job, which records `refund_reported` with a critical alert (Q4). The IPN never marks anything itself. At most one verify per invoice per 30 s (cache Redis) plus a per-IP limit, so unsigned spam cannot become a flood of status calls.

### 6.5 Reconciliation (repeatable job; one run at a time across workers)

Up to 100 payments per run, least recently checked first: `initiated`/`pending` older than the minimum age, plus `failed`/`expired` inside the late watch, backing off by `check_count` (2, 2, 5, 10, 30 min, …). Claimed by setting `last_checked_at` in a short transaction, then one verify each. Expiry happens inside the verify job, so the gateway is asked once more first. Alerts: pending beyond expiry, `rejected_amount`, 2001 repeating across payments, unknown `trx_status`, any `review_reason`, queue depth.

### 6.6 Ordering cases

| Case | Result |
|---|---|
| IPN before callback | The IPN's verify marks paid; the later callback finds it paid and redirects. |
| Callback and IPN together | One verify (deduplicated); even two runs make one transition (row lock). |
| Callback twice, page refresh | `no_change` / `duplicate`. |
| No callback, no IPN (tab closed) | Reconciliation after 2 min. |
| Paid after our expiry | Late watch: `expired → paid` (`late_success`); `duplicate_payment` if already completed. |
| Status API or worker down | Nothing changes; the result page says "confirming"; retries and alerts. |

### 6.7 What the student and the admin see

- **Before an account exists** (cookie `sirat_reg`; public routes, ownership = the token): `GET /registrations/current` (`awaiting_payment | confirming | completed | failed | expired`, invoice, amount, `canResume`, `canRetry`; no personal data; polled 2 s → 10 s, stops after 2 min, then the "Check my payment status" button), `POST /registrations/current/resume` (the stored URL while valid), `/retry` (new payment, new invoice, only while open: D7), `/recheck` (enqueue a verify, once per 10 s), `/cancel` (abandon, only if nothing is active or a re-check shows unpaid). After completion the cookie is cleared (D2).
- **Logged in (end of the first release):** `GET /registrations/me` (registration status, category, date, payment status) and `GET /payments/mine` (paginated: invoice, amount, status, dates) feed the dashboard; `GET /payments/:id/status` and `POST /payments/:id/recheck` (owner, throttled).
- **Admin:** `GET /admin/payments?invoice=|trx=|phone=|review=1` (paginated, filter by `gateway_account`), `POST /admin/payments/:id/recheck`, `POST /admin/payments/:id/reconcile` `{ trxId, reason }` (to `paid` only, section 5; audit-logged; no refund option, Q4); the review list shows `duplicate_payment`, `refund_reported`, `email_taken` and `phone_taken`, `GET/PUT /admin/settings/:key` (3.4).
- **06-API changes (owner review):** `GET /payments/paystation/callback` becomes `/callback/:invoice`; new public routes `GET /registrations/info`, `GET /registrations/current`, `POST /registrations/current/{resume,retry,recheck,cancel}`.

## 7. Gateway interface and adapters

```ts
interface PaymentGateway {
  initiate(req: InitiateRequest): Promise<InitiateResult>;
  statusByInvoice(invoiceNumber: string): Promise<StatusResult>; // v1; v2 is not used (Q1 = 0)
}
type InitiateRequest = {
  invoiceNumber: string;
  amountTaka: number; // integer: amount_minor / 100
  currency: 'BDT';
  payWithCharge: 0; // Q1: the merchant bears the charge; config refuses anything else
  reference: string; // our payment id
  customer: { name: string; phone: string; email: string };
  callbackUrl: string;
};
type InitiateResult =
  | { kind: 'created'; paymentUrl: string }
  | { kind: 'refused'; statusCode: string } // 1008 and every other non-200 code
  | { kind: 'unavailable'; reason: 'timeout' | 'network' | 'http' | 'bad_response' };
type StatusResult =
  | {
      kind: 'found';
      invoiceNumber: string;
      trxStatus: string; // lowercased raw value; the decision maps it
      trxId: string | null; // '' becomes null
      paymentMinor: number | null; // v1 payment_amount in paisa; null if missing or unparsable
      reference?: string;
      paymentMethod?: string;
    }
  | { kind: 'not_found_or_auth' } // 2001
  | { kind: 'other'; statusCode: string }
  | { kind: 'unavailable'; reason: 'timeout' | 'network' | 'http' | 'bad_response' };
// Every result also carries the redacted raw body for payment_events.
```

Adapters only translate HTTP. The decision (6.3) is a pure function `decide(payment, status)` outside them, unit-tested exhaustively.

- **`PayStationGateway` (real):** `fetch` with an AbortSignal timeout; initiate form-encoded with `merchantId` and `password`; status calls send only the `merchantId` header. Everything from `PaymentConfig`; the adapter itself holds no host name (only the allow-list in `payment.config.ts` does). Logs carry the error class and status code only.
- **`FakeGateway` (in-memory, unit tests):** scripted answers per invoice.
- **Fake PayStation server** (`tools/fake-paystation`, D5): plain Node HTTP with the official response shapes for initiate and v1; a checkout page with Pay / Fail / Cancel / Close (redirects to the callback with plugin-style `status`, `invoice_number`, `trx_id`, and can POST the IPN); a control endpoint for test scenarios (delay, timeout, 2001, `Successful`/`Success`, `"400.00"`, an amount above or below the fee, a late success, a duplicate IPN). The real adapter runs against it in integration tests and in local dev. Never in a production image; `PAYSTATION_ENV=fake` is refused in production.
- **`paystation:selfcheck` CLI:** one initiate with an `X…` invoice that is never stored or paid; expects `"200"`. Proves credentials and host (a status query cannot: 2001 means "not found" or "wrong credentials").
- **Contract tests:** the same suite runs against the fake server and, by hand, against the sandbox; results go into `SANDBOX-CHECKLIST.md`.

## 8. VERIFY: needs the sandbox

S1–S17 exist in `SANDBOX-CHECKLIST.md`; S18–S30 are added there on step 2. If Rasel's sandbox credentials are in the local `.env` on step 2, the API-only checks (S1–S3, S6, S7, S11, S15, S17, S21) run then through the contract suite. S10 needs one sandbox checkout in a browser; it is done by hand on step 2 if possible, so the amount rule (step 3) is confirmed early, and again in the full browser flow on step 12.

| # | Question | Affects |
|---|---|---|
| S10 / P6 | With `pay_with_charge=0` (Q1): is v1 `payment_amount` exactly 400, and does the checkout show the student 400 (not 400 plus a charge)? If not, every payment fails closed (`rejected_amount`): stop and ask the owner | amount rule |
| S4, S5, S16 / P1 | Callback method and parameters; do cancel and failure return? | callback route |
| S12 | Checkout link lifetime | Q5: `payment_expiry_minutes` is never below it (D3) |
| S15 | Exact `trx_status` strings on v1 | accepted list |
| S17 | 2001: unknown invoice vs wrong `merchantId` | alerting |
| S11 | Sandbox host | one line of the allow-list in `payment.config.ts` (3.5) |
| S1, S2 | Invoice length and characters | invoice format |
| S9 | IPN sent in the sandbox at all? | IPN tests |
| S18 | After a failed try, can the student retry on the same invoice (failed, then success)? | `failed` not final |
| S19 | Does v1 echo our `reference`? | cross-checks |
| S20 | IPN content type, timing vs the callback, retries (answer 500 once) | IPN handler |
| S21 | Amount formats (`"400"`, `"400.00"`, number, separators?) | parser |
| S22 | What the checkout shows the payer (name, phone, email; whose merchant name) | privacy, section 13 |
| S23 | Accepted `cust_name` (Bangla?), `cust_phone` format, email rules | Q2 normalisation |
| S24 | A `callback_url` with the invoice in its path: accepted, parameters appended correctly? | callback URL |
| S25 | Rate limits on the status APIs | verify concurrency |
| S26 | Only if it is easy in the sandbox: a refund in the panel shows as `trx_status = refund` on v1 | to see the `refund_reported` alert (Q4); no refund handling is built |
| S27 | Can a `payment_url` be opened again after closing the tab? | resume |
| S28 | Time zone of `order_date_time` | admin display |
| S29 | Where the IPN URL is registered for a test account; more than one allowed? | 3.5, section 13 |
| S30 | Must callback domains be whitelisted in the panel? | 3.5, section 13 |

### 8.1 Without the VPS: testing the IPN (step 12)

The staging stack in D8 needs a VPS, and the client has not delivered one yet (OPEN-QUESTIONS #22). Until it arrives:

**Setup:**
1. This worktree runs its own API and worker on the host. They use its own database `sirat_pay`, Redis DB 1 and ports 4100/4101 (section 15). They do not use the shared docker stack, so A2 is not disturbed.
   - Settings: `PAYSTATION_ENV=sandbox`, Rasel's sandbox credentials (typed in by Rasel), invoice prefix `T`.
2. A temporary tunnel gives the API a public `https://` URL for the session only, e.g. a `cloudflared` quick tunnel to `http://127.0.0.1:4100`. Rasel installs the tool on his PC.
3. `PAYSTATION_IPN_URL` = tunnel URL + `/api/payments/paystation/ipn`. It is registered in Rasel's sandbox panel for the session and removed afterwards. The callback stays `localhost` (a browser redirect).

**Rules:**
- Sandbox account only, never the client's account.
- Test students only (`TEST` names, addresses Rasel controls), no real personal data. `sirat_pay` holds no admin with a weak password.
- The tunnel runs only while Rasel watches the test, and is stopped right after.
- A quick tunnel's URL changes on every restart, so the panel entry must be updated each time.

**What this covers:** every S-check that needs PayStation to reach us. That is S9, S20 (IPN arrives, content type, retries after a 500) and S29 for a test account. It also covers everything the browser or the status APIs show: S4, S5, S10, S12, S13, S15–S19, S21–S24, S26, S27.

**Still open until the VPS (and its domain) exist:**
- the IPN through our real nginx with TLS: body limit, per-IP limit, the real client IP behind a proxy;
- S29 and S30 for the production domain: IPN URL registration and callback domain whitelisting;
- k6 on the target hardware (DoD #17). Step 13 still runs k6 locally against the fake server, to catch regressions. The numbers are provisional and DoD #17 is closed only on the VPS;
- the deployment and DoD #16's real payment, which need the VPS and the client's account (10.2, 10.3).

## 9. Tests

Each protection is mutation-checked as in A2: its test fails with the protection removed. File names are proposals.

**Unit:**
- `payment-decision.spec.ts`: every `status_code` × `trx_status` casing × amount equal/lower/higher × invoice match × `trx_id` empty/used; amount equal, 1 paisa lower, 1 paisa higher, 400 plus a typical charge, missing; `refund` on a paid payment → no change, `refund_reported`, critical (Q4).
- `payment-state.spec.ts`: the full from × to matrix.
- `amount.spec.ts`: `"400"`, `"400.00"`, `400`, `400.0`, `"400.5"` → 40050, `"400.123"`, `""`, `null`, `"4,00"`, `"1e3"`.
- `invoice.spec.ts`: format, ≤ 20, 100,000 unique, collision retry.
- `payment.config.spec.ts`:
  - `live` outside production; `fake` in production;
  - `sandbox` with the live host in `PAYSTATION_BASE_URL`, and `live` with the sandbox host: both refused;
  - any other host for `sandbox`/`live` refused; `fake` with a free URL accepted;
  - placeholder credentials, non-https URLs, wrong route paths, callback over 200;
  - bad label or prefix, including the reserved `FX` and `X`;
  - `PAYSTATION_PAY_WITH_CHARGE` other than `0` (`1`, blank, `true`) refused;
  - the source scan: a PayStation host only in `payment.config.ts`.
- `paystation.gateway.spec.ts`, against a stub server with the official samples: encodings, headers, password only on initiate, timeouts and non-JSON → `unavailable`, no secrets in logs.
- `fee.spec.ts`: the fee validity rules.
- `phone.spec.ts` (Q3 c): `01712345678`, `+8801712345678`, `8801712345678`, with spaces or hyphens → `01712345678`. Refused: `01212345678` (no such operator), 10 or 12 digits, letters, empty.

**Integration** (database, Redis, fake server):
- `db-constraints.int-spec.ts`: unique invoice and `trx_id`, `registrations UNIQUE(user_id)`/`UNIQUE(payment_id)`, one active payment per attempt, one open attempt per email and per phone, `users.phone` UNIQUE (two NULLs allowed), the phone format CHECKs, every CHECK in M3, the two triggers, `payment_events` append-only, the settings fee CHECK.
- `settings-fee.int-spec.ts`: the three migration cases; seed after migration keeps 40000.
- `dev-fixtures.int-spec.ts`: section 4.4 (new schema, legal transitions, idempotent, `--clean` removes only fixture payments, a reload completes them, fixture login works).
- `payments-migration.int-spec.ts`: on a database at main's earlier schema with the old fixtures:
  - migrating first stops at the guard and changes nothing;
  - rolled back, clean, migrate, reload works;
  - `prepare-test-db.mjs` empties the leftovers of a `*_test` database and clears a failed try.
- `registration-start.int-spec.ts`: closed (flag, before `opens_at`, after `closes_at`) → 403, nothing written; fee 0/invalid → 503, PayStation never called; `role`, `amount`, `fee`, `payment_amount` in the body → 400; the snapshot equals the settings fee; after an admin fee change, an old pending payment still verifies against its own snapshot; the payment row exists before initiate reaches the fake server; password only as argon2id; promo validation; Q3:
  - each answer's exact bn and en text: email taken, email in progress, and the one phone text for both phone taken and phone in progress under another email;
  - the phone is normalised before the checks (`+8801…` finds an account stored as `01…`);
  - rate limits per email and per phone.
- `payments-callback.int-spec.ts`: **double callback** (twice, and 10 in parallel) → one transition, one user, one registration; callback with `status=success` while the status API says failed → not paid; redirect `Location` = `APP_URL` + `PAYMENT_RESULT_PATH` from config, also when registration closed after start.
- `payments-ipn.int-spec.ts`: IPN + callback together; IPN before callback; replay ×5; unknown invoice (200, alert); wrong amount (never paid); forged IPN (the status API decides); **a refund reported for a paid payment**, by the IPN and by the status API: the payment stays `paid`, `refund_reported` is recorded and a critical alert is raised (Q4).
- `payments-settle.int-spec.ts`: role `student`, category from `grade_levels`, referrer set, `payload` NULL afterwards, email enqueued after commit, failed enqueue does not roll back; **two payments**: two starts with one email in parallel (one 409), same `start_request_id` twice (same payment), retry after failure (new invoice), late success after a second payment completed (`duplicate_payment`, no second account), email taken (`email_taken`, `conflict`); phone taken (`phone_taken`, `conflict`); two starts with one phone and different emails in parallel (one 409); `account_mismatch`.
- `registration-current.int-spec.ts`: **tab closed**: resume within expiry returns the same URL; after expiry a retry gets a new invoice; another attempt's cookie sees nothing; recheck throttle.
- `payments-reconcile.int-spec.ts`: start then nothing → `processing` stays pending, then `expired` + alert; paid at the gateway with no callback/IPN → account completed; 2001 never failed; timeout unchanged; unknown status unchanged + alert; backoff; batch limit; race with a callback (one transition); two workers → one run per interval; late-watch window.
- `admin-payments.int-spec.ts` / `admin-settings.int-spec.ts`: non-admin (incl. manager) → 403; lookup by invoice/trx/phone, paginated; reconcile needs a reason, writes an audit row, goes to `paid` only (anything else, `refunded` included, refused); settings PUT with a stale `expected` → 409, nothing written; every change audited with old and new value.
- `app-routes.int-spec.ts`: the new public routes are in the allow-list; only the IPN is CSRF-exempt.
- Logs: captured logs of a full flow contain no password, merchant credentials, raw payload, email or phone.

**Web** (`node --test`, as today): every API error code maps to a Bangla and an English message, never raw text; result page states; the fee dialog sends `expected`. **Sandbox (step 12):** the browser flow on a phone. **k6 (step 13):** `loadtests/registration-surge.js` against the staging stack with the fake server (never load-test PayStation). Without the VPS it runs locally, and its numbers are provisional (8.1).

## 10. Schedule at the measured pace (target 15 November 2026)

Revised on 2026-10-31 (lead). The first version spread the code over 15 days at a human pace. The steps below are sized from the pace measured in git instead.
- Everything on `main` before this work took about 22 hours (30 October 17:36 to 31 October 16:00, 93 commits): foundation, auth, the first-admin CLI and 18 dashboard pages, with tests.
- Samples: auth A2.0–A2.1e took about 4.5 hours. That covered guard rails, passwords and sessions, the email queue and SES, login limits, email-link endpoints and alerts, with tests. The 18 dashboard pages took about 3 hours; the first-admin CLI about 1 hour.

**All dates are estimates.** Nothing is cut to meet them: every DoD point (section 11), test, mutation check and security check (section 9) stays as written. Step numbers are labels for the work; the rest of this plan refers to them.

Checks, unchanged:
- **Every commit:** `tsc --noEmit` in `apps/api` (and `apps/web` for web commits), lint on the changed files, the related tests, reported in one line.
- **Before a PR:** the full `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, `pnpm --filter @sirat/api test:int` and the docker smoke test.
- The smoke test and e2e use the shared docker stack, so they run only when Rasel says so, always with `--build` (section 15).
- **Before each push:** Rasel gets one line naming the shared files that changed: `schema.prisma`, migrations, `seed.ts`, fixtures, and `app.module.ts` or `apps/api/package.json` if touched.

### 10.1 Code steps (in our hands)

| Step | Date (estimate) | Work | Commits | PR |
|---|---|---|---|---|
| 0 | Sat 31 Oct | This plan and its decisions; the lead's reviews | `docs:` | #11 (merged) |
| 1 | Sat 31 Oct – Sun 1 Nov | On `feat/payments-foundation` from `main`. Foundation every later step needs:<br>- M1–M3 and the seed default 40000;<br>- the owner's phone rules (Q3 c): `users.phone` UNIQUE, one open attempt per phone, the format CHECKs, `normalizeBdMobile` with `phone.spec`;<br>- dev fixtures on the new schema (4.4), each student with a distinct phone: `student1..3@fixtures.invalid` keep logging in with `FIXTURE_PASSWORD`, `ALLOW_DEV_FIXTURES` and the server-marker guard stay unchanged, and after `git merge origin/main` the CI "Dashboard pages" job stays green;<br>- `PaymentConfig` (env, host allow-list);<br>- helpers and constraint tests, 05-DATABASE | `docs: payments plan at the measured pace` · `feat(db): registration attempts, payment columns, payment events` · `feat(db): registration fee 400 BDT in settings` · `feat(db): payment checks and triggers` · `fix(db): dev fixtures on the new payment schema` · `feat(api): PayStation account settings from env` | 1 |
| 2 | Sun 1 Nov | **PayStation client:**<br>- interface, real adapter, in-memory fake, stub-server tests;<br>- fake PayStation server (+ dev compose service), `paystation:selfcheck`;<br>- early sandbox checks (S10, S11) if credentials are there;<br>- S18–S30 into the checklist | `feat(api): PaymentGateway and the PayStation adapter` · `chore(tools): fake PayStation server` | 1 |
| 3 | Sun 1 Nov | **Payment state machine and invoice:** transitions, `decide()`, amount parser, invoice generator | `feat(api): payment state machine and decision rules` · `feat(api): invoice numbers` | 1 |
| 4 | Mon 2 Nov | **`registrations/start` and `pending_registrations`:** 06-API first, then:<br>- DTO (Q2), open check, fee snapshot, idempotency, cookie;<br>- Q3, promo;<br>- `GET /registrations/info` | `docs: registration and payment API contract` · `feat(api): registration start and info` | 2 |
| 5 | Mon 2 Nov | Current/resume/retry/recheck/cancel; `GET /registrations/me`, `GET /payments/mine`, payment status | `feat(api): registration status for students` | 2 |
| 6 | Tue 3 Nov | **Settle transaction:** verify job, account creation, conflicts, emails after commit | `feat(worker): payment verification and settlement` | 3 |
| 7 | Tue 3 Nov | **Callback and IPN** with the race tests | `feat(api): PayStation callback` · `feat(api): PayStation IPN` | 3 |
| 8 | Wed 4 Nov | **Reconciliation job:** expiry, late watch, alerts | `feat(worker): payment reconciliation` | 3 |
| 9 | Wed 4 Nov | **Admin:** payments lookup/recheck/reconcile; settings PUT with `expected` and audit | `feat(api): admin payments` · `feat(api): admin settings with confirmation` | 3 |
| 10 | Thu 5 Nov | **Web wizard** (3 steps, bn/en, error states) on the real API; needs A2's web session merged | `feat(web): registration wizard` | 4 |
| 11 | Thu 5 Nov | **Web result page**, dashboard registration/payment status, admin fee dialog and payments lookup page | `feat(web): payment result and dashboard status` · `feat(web): admin fee and payments` | 4 |
| 12 | Fri 6 Nov | **Sandbox session with Rasel** (10.2):<br>- the S-list and the browser flow on a phone;<br>- the IPN through this worktree's API and a temporary tunnel (8.1), or the staging stack if a VPS exists;<br>- fixes | `fix:` as needed; checklist results | 5 |
| 13 | Fri 6 Nov | **k6** registration surge + callback/IPN bursts, locally against the fake server (regressions; numbers provisional until the VPS run in 10.3) | `test(load): registration surge` | 5 |
| 14 | Fri 6 Nov | RUNBOOK (payments, settings changes, account switch), docs 03/06/10, CLAUDE.md state | `docs:` | 5 |
| 15 | Sat 7 Nov | **Free book, API** (section 16): 06-API contract, M4, cover upload, student and admin endpoints, CSV, tests | `docs: book API contract` · `feat(db): book orders and cover images` · `feat(api): free book orders and admin book` | 6 |
| 16 | Sat 7 – Sun 8 Nov | **Free book, web**: result-page login button, `/dashboard/book`, dashboard card, admin book and orders pages | `feat(web): free book page and dashboard card` · `feat(web): admin book and orders` | 6 |

The dates assume each PR is reviewed and merged within about half a day. While a PR waits, the next step continues on a branch made from it. That branch opens as a PR after the previous one merges, with `git merge origin/main` first.

### 10.2 Not in our hands: needed by

| What | From | Needed by | Latest that still keeps 15 Nov | Used for |
|---|---|---|---|---|
| **Sandbox access:** Rasel's PayStation sandbox credentials typed into this worktree's `.env` (section 15); a test IPN URL can be registered in his panel (S29) | Rasel | Sun 1 Nov (S10 and S11 checked while steps 2–3 are written) | Thu 5 Nov | Steps 2, 12 |
| **Sandbox session with Rasel present** (about 2–3 hours): checkout in a browser and on a phone, the IPN through a tunnel (`cloudflared` installed on his PC), the S-list | Rasel | Fri 6 Nov | Mon 9 Nov (leaves time for fixes and a second session) | Step 12; the sandbox part of DoD #6, #7, #9–#11, #14, #16 |
| **Domain** (with DNS access), separate from the VPS (lead, 2026-10-31) | client, through Rasel | **Mon 2 Nov** | **Wed 4 Nov** | Both slow approvals below need it: SES verifies the sending domain, and the live merchant registers the IPN URL and the callback domain on it. SES approval can take several days, so the domain comes first |
| **VPS** (the domain pointed at it, TLS) | client, through Rasel | Sat 7 Nov | Tue 10 Nov | Deployment; the IPN through nginx and TLS; S29/S30 for the production domain; k6 on the target hardware (DoD #17) |
| **Live merchant:** the client's PayStation account approved for live, methods enabled, credentials to Rasel (D9), the production IPN URL registered, the callback domain whitelisted (S30) | client, PayStation; needs the domain | Tue 10 Nov | Thu 12 Nov | `paystation:selfcheck`, the re-verification in 13.4, one real small payment (DoD #16) |
| **SES production access:** sending domain verified (SPF, DKIM, DMARC) and the account out of the SES sandbox (OPEN-QUESTIONS #16) | Rasel (AWS); needs the domain | **Requested the day the domain arrives** (target Mon 2 Nov); granted by Wed 11 Nov | Fri 13 Nov | Completion and verification emails to real students (DoD #13 in production). If late, registration and login still work, but no email reaches students, and the owner decides whether to open registration |

**Team dependencies** (ours, but not this session's):
- A2's web session merged by Wed 4 Nov (step 10 needs the real login).
- Q3 and Q4 are answered, final (section 2).
- PR reviews by the lead and merges by Rasel, about half a day each.

### 10.3 Buffer: Sun 8 (midday) – Sat 14 November (about 6½ days)

It was 8 days. The free book (steps 15–16, section 16.8) takes about 1½ of them.

The days saved by the measured pace are kept at the end for what cannot be compressed or predicted:
- **Sandbox problems:** S10 showing an amount other than 400, callback or IPN behaving unlike the docs, a second sandbox session.
- **Deployment on the VPS** with registration closed, and the IPN through the real nginx and TLS.
- **The switch to the client's account** (section 13) and **one real small payment** (DoD #16). Whether it is refunded is outside our system (Q4).
- **k6 on the VPS** (DoD #17) and any fixes it shows.

**Sun 15 Nov, target:** the release is deployed. Registration opens after the client account's checks and the real payment pass (section 13).

### 10.4 Pull requests (lead, 2026-10-31)

Each PR is opened as soon as its steps are done and its checks pass:

| PR | Steps | Content |
|---|---|---|
| #11 | 0 | This plan, the DECISIONS entries, OPEN-QUESTIONS #1, #2, P6 (docs only; merged 31 Oct) |
| 1 | 1–3 | Foundation: this schedule and the owner's Q3/Q4 answers, migrations (with the phone rules), fixtures, config, gateway client, fake server, state machine, invoice. Small and early, so the conflict window with A2 stays short |
| 2 | 4–5 | Start and status: `registrations/start`, `info`, `current/*`, `registrations/me`, `payments/mine` |
| 3 | 6–9 | Money flow: settle, callback, IPN, reconciliation, admin payments and settings. Kept apart from PR 2, so the review of the paths that mark a payment paid stays readable |
| 4 | 10–11 | Web: wizard, result page, dashboard status, admin fee dialog and payments page |
| 5 | 12–14 | Sandbox fixes, local k6, docs |
| 6 | 15–16 | Free book: M4, API, cover upload, web pages (section 16) |

## 11. Phase C Definition of Done: step and proof for each point

The 17 points below, plus point 18 for the free book (section 16.7).

| # | Requirement | Step | Proof |
|---|---|---|---|
| 1 | Form stored server-side; survives PayStation round trip, other device, cleared browser | 4, 6 | `registration-start` (payload stored before redirect); `payments-settle` (account built from the DB payload by a request without cookies); other device: the completion email and login work anywhere; sandbox S13 |
| 2 | Open/closed, fee, currency from `settings`, enforced by the API | 1, 4, 9 | `registration-start` (closed → 403; fee 0 → 503; currency ≠ BDT refused; snapshot = setting); `settings-fee`; `admin-settings` |
| 3 | No `role`; unknown fields rejected; category from `grade_levels` | 4, 6 | `registration-start` (`role`, `amount` → 400); `payments-settle` (role `student`, category from the table) |
| 4 | Duplicate email/phone: clear message, enumeration acceptable to the owner | 1, 4 | `registration-start` (the owner's Q3 texts in bn and en, phone normalisation, rate limits per email and per phone); `db-constraints` (`users.phone` UNIQUE, one open attempt per email and per phone); `phone.spec` |
| 5 | Payment row before redirect; unique invoice; no reuse | 1, 4 | `db-constraints`; `registration-start` (the fake server sees the row exist when initiate arrives; retry gets a new invoice) |
| 6 | Callback a hint; paid only after transaction status + amount + invoice | 3, 6, 7 | `payment-decision` matrix; `payments-callback` (success params, failed status → not paid); sandbox S4, S6, S15 |
| 7 | IPN idempotent and re-verified | 7 | `payments-ipn`; sandbox S9, S20 |
| 8 | Replays and parallel requests never create a second account | 1, 6, 7 | `db-constraints`; parallel callback ×10; callback + IPN race; late duplicate payment |
| 9 | Reconciliation settles abandoned payments; expiry configurable; alert | 8 | `payments-reconcile`; sandbox S12, S13 |
| 10 | Close the tab anywhere; resume or restart; no double charge; "Check my payment status" | 5, 8 | `registration-current`; one-active-payment constraint; sandbox S13, S27 |
| 11 | Success/failure redirect targets are config, e2e-tested | 7, 11 | `payments-callback` (Location from config, also when closed after start); web result page test; sandbox run |
| 12 | Promo validated server-side; referral credit only after payment | 4, 6 | `registration-start` (invalid/unapproved → 400); `payments-settle` (referrer set only at completion). Points are not awarded in this release (rules: OPEN-QUESTIONS #13); the ambassador module derives them later with event key `referral_paid:<paymentId>`. |
| 13 | Verification + welcome email queued, retried, never blocking | 6 | `payments-settle` (enqueued after commit; queue down → registration still completes); existing email worker tests |
| 14 | Mobile-first, weak network, bn/en, clear errors | 10, 11 | web tests (error-code → bn/en message, no raw text); phone check on step 12 |
| 15 | Admin lookup by invoice/trx/phone; manual reconcile audited | 9 | `admin-payments` |
| 16 | Sandbox end to end, then one real small payment | 12, 15 | `SANDBOX-CHECKLIST.md` results; real payment on the client's account (section 13) |
| 17 | k6 registration surge passes (p95 < 500 ms, errors < 0.5 %) | 13 | k6 report recorded in DECISIONS; counts only when run on the VPS (8.1) |

## 12. Conflict files: what changes when

State on 2026-10-31 (lead): the first-admin CLI (PR #10, `admin:create`) is merged and is in this branch through `git merge origin/main`. The A2 session is building the web session. Nobody is changing the schema.

**Git rule (lead):** no rebase and no force-push on a pushed branch. Conflicts are resolved with `git merge origin/main`, and the result is a new commit.

| File | When this work changes it | Handling |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Step 1 only, one commit | Our edit to `User` is `phone @unique` (Q3 c) and back-relation lines at the end of its relation list. Any later code that writes `users.phone` (e.g. a profile edit) must use the same `normalizeBdMobile`, or the format CHECK refuses it. If A2 later changes the schema (e.g. admin 2FA), whoever merges second regenerates (next row). |
| `apps/api/prisma/migrations/*` | Step 1 only (M1–M3) | Whoever merges second follows these steps:<br>1. `git merge origin/main`.<br>2. Delete its own not-yet-merged generated migration (M1).<br>3. Regenerate it on a fresh local DB (`prisma migrate dev --create-only` against `sirat_pay`, section 15), so its timestamp is the newest.<br>4. Commit that as a new commit.<br>The hand-written M2 and M3, also not yet merged, are renamed to timestamps after M1 in the same commit; their SQL does not change. A migration on `main` is never edited. The CI drift check must be green. |
| `apps/api/prisma/seed.ts` | Step 1 | Fee placeholder 40000, two new keys. |
| `apps/api/prisma/fixtures/dev-fixtures.ts`, new `test/dev-fixtures.int-spec.ts` | Step 1 (4.4) | **Conflict point with A2:** on A2's web-session branch, the CI "Dashboard pages" job and the e2e log in for real as `student1@fixtures.invalid`, so A2 may change the fixtures or the CI step that loads them. The fixture emails, `FIXTURE_PASSWORD` and the guards do not change (4.4), and "Dashboard pages" must be green after the merge. Whoever merges second adapts to the other's version after `git merge origin/main`:<br>- If A2 merges first, our PR 1 runs A2's page check against the new fixtures before it opens.<br>- If we merge first, A2's page check runs on the new fixtures as they are. |
| `apps/api/package.json` | Step 2 (`paystation:selfcheck` script) | `admin:create` is already on `main`, so our line goes in next to it, one line only (DECISIONS "Launch target"). Any later conflict is resolved with `git merge origin/main`. |
| `pnpm-lock.yaml` | No change planned (Node `fetch`, BullMQ, argon2, class-validator already present; k6 is a separate binary) | If a dependency becomes necessary: its own commit right after `git merge origin/main`; the lockfile is regenerated by `pnpm install`, never hand-merged. |
| `apps/api/src/app.module.ts` | No change planned (D10) | — |
| `apps/api/src/worker.ts` | Step 6 (one import of the payments worker module) | Step 8 adds to that module, not to `worker.ts`. A2's cleanup job may add an import next to ours. |
| `apps/api/src/config/env.ts`, both `.env.example` | Step 1 | Our block at the end, own heading. |
| `apps/api/test/helpers.ts`, `db-constraints.int-spec.ts`, `seed.int-spec.ts` | Step 1 | A2 should not touch the payment helpers. `truncateAll` now skips the append-only `payment_events`. |
| `apps/api/test/prepare-test-db.mjs` | Step 1 | Shared by every `test:int` run. After A2 merges main, its first `test:int` empties the old payment rows of `sirat_test` and applies M1–M3; nothing to do by hand. |
| `packages/shared/src/index.ts` | Step 1 (`export * from './phone'`) | One line at the end. |
| `apps/api/test/app-routes.int-spec.ts` | Steps 4, 5, 7 | Allow-list entries only. |
| `.github/workflows/*.yml` | Step 1 (`PAYSTATION_ENV=fake` for integration tests) | A2 adds the fixture load and the page check to CI: the second to merge resolves it with `git merge origin/main`, keeping both steps. |
| `infra/docker-compose.dev.yml` | Step 2 (fake PayStation, 127.0.0.1 only); the PgBouncer wildcard for the dev DB names if Rasel approves it (section 15) | Shared stack: changed only after telling Rasel. |
| `apps/web/**` | Steps 10–11 | Start only after A2's web session (`lib/session.ts`, login, API client) is merged. |
| `docs/DECISIONS.md` | Step 0 (five entries, in the docs PR), step 14 | Entries go at the top. A2's web-session branch also has a new entry, so whoever merges later runs `git merge origin/main` and keeps both sides' entries, newest first. |
| `docs/RUNBOOK.md` | Step 1 (section 0: the payments migration on an old dev database), step 14 | Our text sits right after the fixtures paragraph of section 0. |
| `docs/05-DATABASE.md` step 1; `06-API.md` step 4; `03-HOW-IT-WORKS.md`, `10-BUILD-PLAN.md`, `CLAUDE.md` §4 step 14 | | |
| Local dev database | Step 1 | This work migrates only its own `sirat_pay` and `sirat_pay_test` (section 15). A2's dev database and Rasel's data are never touched, so no reset is needed for M1's guard. |

After both branches merge: one `UsersService.create` for A2's `create-admin` and our settlement (one data-access path, RULEBOOK §18), as a follow-up agreed with the A2 session.

## 13. Switching to the client's PayStation account (checklist)

Now: Rasel's test account (sandbox), label `rasel-sandbox`, invoice prefix `T`. Later: the client's account, e.g. `client-live`, prefix `S`. The switch changes only `.env`: no code change, no new release. This moves into RUNBOOK on step 14.

### 13.1 Keeping test data apart (from day one)

1. **Sandbox payments never touch the production database.** They run locally (this worktree's `sirat_pay`, section 15) or on the staging stack (D8), with its own compose project, database, volumes and `.env`. The production database meets PayStation first on the day it gets the client's account.
2. **Every payment is labelled:** `gateway_account` plus the account's invoice prefix (`T…` on test accounts). Admin lists, KPIs and reports filter on the current label.
3. **Test students stand out everywhere:** addresses the owner controls (e.g. `owner+t01@…`), names starting with `TEST`, and a distinct phone number each (phones are unique, Q3 c) from a list agreed with Rasel. Real students' data is never used in tests.
4. **No copying between environments:** a test database never goes into production; production data never goes to staging without its personal data scrubbed.
5. **Rasel's account sends IPNs only to a test URL**, never to production.
6. **The two accounts' credentials never share an `.env` file.** Rasel's in the local or staging `.env`; the client's only in the production `.env` (mode 600). Never in git, chat, email, logs, notes or `NEXT_PUBLIC_*`.
7. **Pre-launch check** (`paystation:selfcheck --launch` or the SQL in RUNBOOK): production holds no payment with a label other than the live one and no user with a test address. Otherwise stop and ask the owner; never delete rows by hand (foreign keys RESTRICT, audit log append-only).

### 13.2 Before the switch (with the client)

- [ ] The client's merchant account is approved for live, with the wanted methods enabled (OPEN-QUESTIONS #1).
- [ ] The client's contract has the merchant bearing the charge (`pay_with_charge = 0`, Q1). If the client wants the student to pay it, stop: `1` is not built, and the API refuses to boot with it.
- [ ] The client's panel has exactly the production `PAYSTATION_IPN_URL` registered (S29); the callback domain is whitelisted if required (S30).
- [ ] Credentials delivered as in D9.
- [ ] Registration closed, or no payment `initiated`/`pending` (query in RUNBOOK): payments in flight on the old account cannot be verified after the switch.
- [ ] Not inside an exam window (CLAUDE.md DON'T #12): `api` and `worker` restart.

### 13.3 The switch: `.env`, then a restart

Change `PAYSTATION_ENV` (`live`: the host comes from the allow-list; `PAYSTATION_BASE_URL` stays blank or equals the live host), `PAYSTATION_MERCHANT_ID`, `PAYSTATION_PASSWORD`, `PAYSTATION_ACCOUNT_LABEL`, `PAYSTATION_INVOICE_PREFIX`, `PAYSTATION_CALLBACK_URL` and `PAYSTATION_IPN_URL` (production domain), `PAYSTATION_PAY_WITH_CHARGE`; and `payment_expiry_minutes` (admin setting) if S12 differs. Restart `api` and `worker`; read the boot log (host, label, last 4 characters of the merchant id, callback and IPN URLs).

### 13.4 Re-verify on the client's account (its settings can differ from Rasel's)

| Check | Why | How |
|---|---|---|
| `paystation:selfcheck` | Credentials and host work | One initiate with an `X…` invoice, never stored or paid; expects `"200"`. Leaves one unpaid invoice in the client's panel. |
| S10 / Q1 amount | Charge settings are per account | One small real payment: v1 `payment_amount` equals the fee exactly, and the checkout shows the fee with no charge added. |
| S12 | Link lifetime may be per account | `payment_expiry_minutes` ≥ it. |
| S15, S16, S20 | Status strings, callback, IPN on live | From the real payment (its IPN appears in `payment_events`). |
| S22 | Checkout shows the client's merchant name, not Rasel's | Look. |
| S17 | 2001 with the new merchant id | Status of an unknown invoice. |
| S25 | Rate limits on live | Ask PayStation. |
| S26 | A refund shows up as an alert, nothing more (Q4) | Only if the client refunds the small payment in the panel anyway: a re-check records `refund_reported` with a critical alert, and the payment stays `paid`. |
| Full flow | End to end on live | Register → pay → account → login → dashboard; close the tab → reconciliation settles it (DoD #16). |

Results go into `SANDBOX-CHECKLIST.md` (a "client account" column) and DECISIONS.

### 13.5 After the switch

- Remove any production IPN URL from Rasel's account; his test credentials stay only in local or staging `.env`.
- Watch the first live payments: alerts, `payment_events`, the review list.
- For the first week, compare daily the count and sum of successful transactions in the client's panel with our paid payments under the live label; any difference follows RUNBOOK §11.
- Rotate the password if D9 says so.
- There is no "switch back to the sandbox" in production. If something goes wrong: close registration (settings flag), then fix.

## 14. Risks

1. **The outside items decide the date, not the code** (10.2). The code dates are estimates at the measured pace. Delays go into the 8-day buffer (10.3). No DoD point, test or security check is cut to win time. If the buffer runs out, the owner decides the date.
2. **A2's web session is a dependency** for steps 10–11. If it is not merged by Wed 4 Nov, the web steps move into the buffer.
3. **S10 with `pay_with_charge=0` is not yet seen in the sandbox.** If PayStation reports an amount other than exactly 400 (for example, the charge added anyway), every payment fails closed (`rejected_amount`, critical alert); none is ever wrongly marked paid. The owner is asked before anything changes. Checked early on step 2 if credentials exist.
4. **DoD #16 needs the client's live account** (by Thu 12 Nov, 10.2). If it is not ready by 15 November, the release is ready but registration stays closed.
5. **A double charge** (a second or late payment). We do not return money (Q4), so prevention matters more: one attempt in progress per email and per phone, one active payment per attempt, expiry ≥ PayStation's link lifetime (S12), and the late watch. Any duplicate is a critical alert and shows in the admin list (D3).
6. **The worker is the only path to confirmation.** Health and queue-depth alerts; two worker replicas are safe with BullMQ.
7. **Unsigned IPNs and callbacks can be spammed.** Per-invoice verify throttle, body limit, nginx limit; unknown invoices never cause a gateway call.
8. **PayStation rate limits unknown (S25).** Concurrency cap and batch size from config.
9. **Personal data of minors** in attempts and gateway payloads: minimum fields (Q2), scrubbing, masked payer phone, never logged.
10. **Someone registers with another person's email.** They pay for nothing they can use: the inbox owner can reset the password, and lazy verification keeps the exam closed without the inbox.
11. **Account enumeration at start (Q3 a, c).** The owner accepts it. Rate limits per IP, per email and per phone.
12. **A student types another person's phone number.** That number is then taken for its real owner (Q3 c). The owner's final decision (DECISIONS, 17:35): email and phone are both unique, nobody can use another person's, and nothing more is built (no OTP, no admin tool to free a number, no extra flow). Accepted as is.
13. **argon2 at start during a surge.** Measured with k6.
14. **A wrong fee by an admin.** Bounds, the confirmation dialog, `expected`, the audit row; already-started payments keep their snapshot.
15. **Account switch with payments in flight** (13.2) and **Rasel's account sending IPNs to production** (13.1 #5).
16. **Two code paths create users** until unified (section 12).
17. **SES production sending is not set up yet** (OPEN-QUESTIONS #16): the completion email is the signal for another device.
18. **No VPS yet** (OPEN-QUESTIONS #22). The IPN is tested through a tunnel (8.1), k6 numbers stay provisional, and nothing can be deployed on 15 November until the VPS exists.
19. **Two sessions on one machine** (section 15): one Postgres, one Redis, one docker stack. Mixing them up would migrate the wrong database or let one session's worker take the other's jobs. Separate database names and Redis DBs, and the shared stack only after telling Rasel.

## 15. Local environment: working next to the A2 session

The A2 session uses the same Postgres, Redis and docker stack on Rasel's PC.

Since 31 Oct 17:31 there is also an exam session (`G:\sirat-exam`, plan only for now):
- it uses `sirat_exam` and `sirat_exam_test`, Redis DB 2 and ports 4200/4201;
- it only reads `registrations` and `payments`, and its migrations always come after the payments migrations;
- the launch PRs of this plan are reviewed and merged first;
- the shared stack is now split three ways, always with Rasel's permission.

Rules (lead, 2026-10-31):

**This worktree's `apps/api/.env`** (`G:\sirat-payments-plan`, git-ignored):
- It is copied from the main folder (`G:\sirat-olympiad\sirat-olympiad\apps\api\.env`). No value was read or printed: a script changed the URL paths and printed only key names.
- Changed, and nothing else:
  - `DATABASE_URL` and `DIRECT_URL` point to database `sirat_pay`;
  - `TEST_DATABASE_URL` points to `sirat_pay_test`;
  - `REDIS_CACHE_URL` and `REDIS_QUEUE_URL` end in `/1`.
- What that gives:
  - this work's migrations never reach A2's database, and Rasel's dev database needs no reset;
  - BullMQ queues (same names, other Redis DB) do not take each other's jobs;
  - throttle and cache keys stay apart;
  - integration tests use their own `*_test` database and Redis DB 1.
- `PAYSTATION_MERCHANT_ID` and `PAYSTATION_PASSWORD` are present and empty. **Rasel types the sandbox credentials in himself**; Claude never reads or prints them. The other PayStation keys are added on step 1 with the config code.

**Checked on 2026-10-31:**

| Check | Result |
|---|---|
| `DIRECT_URL` → `sirat_pay` | ✓ The database was created by `prisma migrate deploy`; main's 6 migrations are applied; the server marker is `development` |
| `REDIS_CACHE_URL`, `REDIS_QUEUE_URL` | ✓ Both reach DB 1 (empty) |
| `DATABASE_URL` through PgBouncer → `sirat_pay` | ✗ `FATAL: no such database: sirat_pay`. The compose file sets `DB_NAME=${POSTGRES_DB}`, so PgBouncer knows only `sirat` |

**PgBouncer fix (proposal, needs Rasel's OK):**
- What: in `infra/docker-compose.dev.yml`, override PgBouncer's `DB_NAME` with an empty value. The image then writes `* = host=postgres …`, so any local database name passes through; production keeps its single name.
- Cost: the PgBouncer container must be recreated, which drops A2's pooled connections for a few seconds. So it happens only when Rasel says A2 is not running anything.
- Until then: the Prisma CLI and the integration tests connect directly (`DIRECT_URL`, `TEST_DATABASE_URL`) and work, so steps 1–3 are not blocked. Only running this worktree's API and worker on the host (step 4 onward) needs it.

**Ports:** this worktree's host processes use API `PORT=4100` and `WORKER_HEALTH_PORT=4101` (added to its `.env` when first needed), so they never clash with A2's 4000/4001.

**The docker stack is shared** (project `sirat`, the same ports):
- `up -d --build`, the smoke test and e2e from this worktree replace A2's running containers.
- **Claude runs no `up`, `down`, smoke test or e2e on the stack until Rasel says so** (lead, 2026-10-31), and tells Rasel when finished. Work on the host against this worktree's own databases (`sirat_pay`, `sirat_pay_test`) and Redis DB 1 needs no permission.
- The `sirat-api` and `sirat-web` images may be built from A2's branch (A2's run on 31 October). So this worktree always starts the stack with `--build`, never a plain `up -d`.

**Cleanup after both branches merge:**
- drop `sirat_pay` and `sirat_pay_test`, and flush Redis DB 1;
- only with Rasel's OK.

## 16. Free book after payment (owner, 2026-10-31 17:37)

Every student who pays gets one free book. After a successful payment the student confirms a delivery address. The admin can change the book's title and cover later. This is part of the 15 November release unless Rasel says otherwise.

**Rules:**
- **No migration in PR 1.** The book has its own migration (M4) in its own PR, after the payments migrations. The exam session's migrations come after it.
- **Own session only:** a student reaches only their own order. There is no `:id` in any student route, and the user id comes from the session cookie.
- **Admin only:** addresses (a minor's personal data) are visible only to the student and to admins (not `manager`). They never appear in logs or audit rows, and every export is audited.

### 16.1 Questions and defaults

**All answered by Rasel (owner, 2026-10-31 18:17).** B1–B3 and the admin list with the CSV were accepted as proposed; B4 and B5 are "yes" (DECISIONS "Free book after payment").

| # | Question | Answer |
|---|---|---|
| B1 | Order fields | recipient name; recipient phone (pre-filled with the student's phone, may differ, **not unique here**); district (one of the 64); upazila/thana; address line; optional note |
| B2 | Where the book can go | Bangladesh only |
| B3 | How many books | one per student (`UNIQUE(user_id)`) |
| B4 | (ক) May the student skip the book page and confirm later from the dashboard? | **Yes (owner).** Until an address is given, the dashboard keeps reminding |
| B5 | (খ) May the address change after confirming? | **Yes (owner)**, until an admin marks the order shipped. After that it cannot change; the DB refuses it (trigger) |

Smaller choices, made here (say if you disagree):

| | Default |
|---|---|
| B6 | Order statuses: `confirmed` → `shipped` (admin). Nothing is tracked after shipping; `delivered` can be added later |
| B7 | The order keeps a copy of the book title at confirmation, so a later rename never changes what a student was promised or what the courier list says |
| B8 | Upazila/thana is free text (2–100 characters); district comes from a fixed list of 64 in `packages/shared` |
| B9 | Nothing is deleted automatically in this release. When the deliveries are done, the owner decides how long addresses are kept |

### 16.2 Schema (M4 `<ts>_book_orders`, its own PR)

| Table | Columns and constraints |
|---|---|
| `book_images` | `id`, `sha256` UNIQUE, `content_type` CHECK in (`image/jpeg`, `image/png`, `image/webp`), `byte_size` CHECK 1–819200 (800 KB), `width`, `height` CHECK 100–4000, `data` bytea, `uploaded_by` (FK users RESTRICT), `created_at`. Old covers stay: they are small, and the audit trail points to them |
| `settings` (existing) | new keys `book_title` (string, 1–200) and `book_cover_image_id` (uuid or null). Changed only through the admin endpoints below, with `expected` and an audit row (section 3.4) |
| `book_orders` | `id`; `user_id` UNIQUE; `registration_id` UNIQUE. Composite FK `(registration_id, user_id)` → `registrations (id, user_id)`, so an order exists only for the student's own **paid** registration: a registration exists only for a paid payment (trigger), and there are no refunds. Also: `status` (`BookOrderStatus`: `confirmed`, `shipped`); `recipient_name` (1–100), `recipient_phone` (CHECK `^01[3-9][0-9]{8}$`, not unique), `district` (CHECK in the 64 names), `upazila` (2–100), `address_line` (5–300), `note` (≤ 300, nullable); `book_title` (snapshot); `version` (int, +1 per change); `confirmed_at`, `shipped_at`, `shipped_by` (FK users RESTRICT), `created_at`, `updated_at` |
| `registrations` | a UNIQUE `(id, user_id)` index, for the composite FK above |

Further rules on `book_orders`:
- **CHECKs:** `shipped` exactly when `shipped_at` and `shipped_by` are set; lengths; `district` in the list.
- **Trigger `book_orders_locked_after_shipping`:** once `shipped`, the address columns cannot change, and the status cannot go back.
- **Indexes:** `(status, created_at)`, `district`, `recipient_phone`.

### 16.3 API contract (goes into `06-API.md` first, at the start of the book PR)

DTOs use `whitelist` + `forbidNonWhitelisted`. Every route has an explicit guard. The phone is normalised with `normalizeBdMobile`.

**Student** (role `student`, logged in; "me" routes only):

| Route | What it does |
|---|---|
| `GET /book` | `{ title, coverUrl }` |
| `GET /book-order/me` | `{ eligible, order }`. `eligible` is true when the student has a registration. `order` is null or the student's own order, including the address |
| `PUT /book-order/me` | Body `{ recipientName, recipientPhone, district, upazila, addressLine, note?, expectedVersion? }`. Creates the order or updates it (idempotent; `UNIQUE(user_id)`).<br>- 403 without a paid registration;<br>- 409 once shipped (B5) or when `expectedVersion` is stale (another tab);<br>- 400 on unknown fields (`role`, `userId`, `status` …);<br>- audit `book_order.confirmed` / `book_order.updated` with ids only, never the address |
| `GET /book/cover/:imageId` | **Public.** The cover bytes. `Content-Type` comes from the stored, sniffed type; also `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` and `Cache-Control: public, max-age=31536000, immutable`. The id changes with every new cover, so caching is safe. A cover is not personal data |

**Admin** (role `admin` only; `manager` gets 403):

| Route | What it does |
|---|---|
| `GET /admin/book` | title, current cover, upload limits |
| `PUT /admin/book/title` | `{ title, expected, reason }`. 409 when `expected` is stale. Audit `book.title_changed` (old, new, reason) |
| `POST /admin/book/cover` | multipart, one file. Checks in 16.5. Sets `book_cover_image_id`. Audit `book.cover_changed` (old and new image id, sha256, size) |
| `GET /admin/book-orders?page=&pageSize=&status=&district=&phone=&email=` | Paginated (max 100 per page), newest first.<br>- `phone` is normalised and matches the recipient's or the student's phone;<br>- `email` matches the student's email (citext, exact);<br>- these values are never logged (A2.0 gate 2 already drops query strings) |
| `GET /admin/book-orders/export.csv?status=&district=` | Streamed CSV for the courier: order code, recipient name, phone, district, upazila, address, note, book title.<br>- UTF-8 with a BOM (Bangla in Excel);<br>- cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` (formula injection);<br>- `Cache-Control: no-store`, `Content-Disposition: attachment`;<br>- audit `book_orders.exported`: admin, IP, the filter, the row count, never the rows;<br>- rate-limited |
| `POST /admin/book-orders/ship` | `{ ids (1–500), reason? }` → `shipped`. Audit `book_orders.shipped` (count, ids) |

### 16.4 Flow

1. **After payment:** the result page polls `/registrations/current` until `completed` (section 6.7). The payment browser has **no session** (D2: no automatic login), so the page says "Payment confirmed. Log in to get your free book." The button goes to `/login?next=/dashboard/book`. The student may also skip it (B4).
2. **Login:** the student logs in with the password they chose in the form (A2's login, merged in PR #12).
   - A2's `safeNext` (`apps/web/src/lib/auth/next-param.ts`) already accepts only same-origin paths under `/dashboard` and `/admin`. The book page therefore lives at **`/dashboard/book`**, and A2's login code does not change.
3. **`/dashboard/book`** (protected, own session only):
   - shows the title and cover;
   - the form is pre-filled from the student's account: name, phone, district;
   - the student checks it and confirms (`PUT`), and sees "Order confirmed".
   - If the student has no paid registration, the page shows "Available after your registration payment" (`eligible: false`).
4. **Dashboard:**
   - a card shows the order: not yet ordered (with the button, B4), confirmed (district only, plus a "Change address" button until shipped, B5), or shipped (with the date);
   - the registration and payment status card stays as before.
5. **Admin:** the book page (title, cover upload with a preview) and the orders page (search, paging, "Export for courier", "Mark shipped" for the selected rows). Every action asks for confirmation and is audited.

### 16.5 The cover image: the system's first upload (RULEBOOK §15)

**Where:** in Postgres, table `book_images` (bytea). Not on disk, and not in Cloudinary or any pay-per-request service. Why:
- **4 API replicas:** a file written by one container is invisible to the other three. A shared volume would work, but it is a second thing to back up and restore.
- **Backups for free:** the nightly `pg_dump` (`scripts/backup.sh`) already contains it, and the restore drill restores it. Nothing to change in the backup script.
- **Outside the web root by construction:** nginx never serves it from a directory. Only the API sends it, with fixed headers.
- **Tiny:** one cover of at most 800 KB, plus a few old ones.

**Limits and checks (restricted, not scanned):**
- **Size:** one file, at most 800 KB (multer memory storage with `limits`, already present through `@nestjs/platform-express`). This fits the existing nginx `client_max_body_size 1m`, so nginx does not change.
- **Type:** JPEG, PNG or WebP only, decided by the file's **magic bytes**, never by the file name or the browser's `Content-Type`. SVG (scriptable), GIF, HEIC and everything else are refused.
- **Dimensions:** read from the header; 100–4000 px per side.
- **Metadata stripped before storing** (an admin's phone photo can carry GPS):
  - JPEG: APP1 (EXIF/XMP), APP13 (IPTC) and COM segments;
  - PNG: `tEXt`, `zTXt`, `iTXt`, `eXIf` and `tIME` chunks;
  - WebP: `EXIF` and `XMP` chunks, with the header flags and size fixed.
  Done in a small `book-image.ts` with unit tests. No new dependency, so `pnpm-lock.yaml` does not change. If the owner prefers a re-encode with `sharp`, that is a new dependency and a lockfile change.
- **Served** with the sniffed type, `nosniff` and a `default-src 'none'` CSP, so even a crafted polyglot can never run as a page.

**Backup and restore:**
- The cover is in every `pg_dump`.
- RUNBOOK's restore drill gets one more check: after the restore, `GET /api/book/cover/<id>` returns the image.
- CSV exports are streamed and never stored on the server, so there is nothing more to back up or purge. The RUNBOOK tells the admin to delete the downloaded file after handing it to the courier.

### 16.6 Tests

**Unit:**
- `book-image.spec.ts`:
  - each allowed type is accepted;
  - a wrong extension or `Content-Type` makes no difference;
  - SVG, GIF, HEIC and an HTML/JPEG polyglot are refused or stored as an image only;
  - over 800 KB and over 4000 px are refused;
  - GPS EXIF in a JPEG and `tEXt` in a PNG are gone after stripping, and the result is still a valid image.
- `book-csv.spec.ts`: formula prefixes, quotes, commas, newlines, Bangla, the BOM.
- `districts.spec.ts`: 64 unique names.

**Integration:**
- `db-constraints`:
  - `book_orders UNIQUE(user_id)`;
  - the composite FK (no order for another user's registration, or without a registration);
  - the CHECKs;
  - the shipped lock trigger;
  - the `book_images` CHECKs.
- `book-orders.int-spec.ts` (HTTP):
  - no registration → 403;
  - first `PUT` creates, the second updates (version +1), a stale `expectedVersion` → 409;
  - shipped → 409, and the DB trigger refuses too;
  - unknown fields (`role`, `userId`, `status`) → 400;
  - phone forms are normalised, a bad district → 400;
  - another student can never see or change the order (there is no route with an id);
  - the title snapshot is unchanged after an admin rename;
  - the audit rows hold no address.
- `admin-book.int-spec.ts`:
  - student and manager → 403 on every admin route;
  - title with a stale `expected` → 409;
  - cover upload: valid → stored and audited; a wrong type → 400; too large → 413;
  - the cover response headers;
  - list paging and search by phone (all three forms), email (any case) and district;
  - CSV content, escaping and its audit row (count and filter, no rows);
  - ship → statuses and audit.
- Logs captured over a full flow contain no address, recipient phone or note.
- `app-routes`: the cover route is the only new public route.

**Web:**
- the book page's states: no session → login; not eligible; the form's errors in bn and en; confirmed;
- the dashboard card's three states;
- the admin pages' confirmations;
- the result page links to `/login?next=/dashboard/book`, which A2's `safeNext` accepts.

### 16.7 Definition of Done: new point 18

| # | Requirement | Step | Proof |
|---|---|---|---|
| 18 | Free book:<br>- after a paid registration, the logged-in student confirms one Bangladeshi delivery address and can change it until it is shipped;<br>- the admin changes the title and cover (audited), searches and pages orders, exports a courier CSV (audited) and marks orders shipped;<br>- addresses are seen only by the student and by admins, and never logged | 15, 16 | `book-orders`, `admin-book`, `db-constraints`, `book-image.spec`, `book-csv.spec`, web tests |

### 16.8 Schedule (estimate, at the measured pace)

| Step | Date (estimate) | Work | PR |
|---|---|---|---|
| 15 | Sat 7 Nov | 06-API contract; M4; `book-image.ts`; student and admin endpoints; CSV; tests | 6 |
| 16 | Sat 7 – Sun 8 Nov | Web: the result page's login button, `/dashboard/book`, the dashboard card, the admin book and orders pages | 6 |

- **About one and a half days, taken from the buffer.** It shrinks from 8 days (7–14 Nov) to about 6½ (8 Nov midday – 14 Nov).
- The book needs no PayStation, so the sandbox session on 6 Nov is not affected. One end-to-end walk (payment → login → book) is added to the buffer's real-payment day.

### 16.9 Files this touches (conflict list; Rasel is told before each push)

| File | Note |
|---|---|
| `schema.prisma`, new migration M4 | After PR 1's migrations; the exam session's come later |
| `apps/api/src/modules/payments/*`, new `apps/api/src/modules/book/*` | `BookModule` is imported by `PaymentsModule`, and admin routes go in `AdminModule`, so `app.module.ts` does not change |
| `packages/shared/src/index.ts` | one line (`districts`, book types) |
| `packages/ui` | possibly a file-input component (shared; the UI session is told) |
| `apps/web`: login `next` handling | **Not touched.** A2's merged `safeNext` already allows `/dashboard/book` |
| `apps/web`: student dashboard home (the card), new `/dashboard/book`, admin book and orders pages | New pages are our own files. The dashboard home card is a small edit in a file A2 owns: merge `origin/main` right before the push |
| `test/app-routes.int-spec.ts` | the public cover route |
| `docs/06-API.md`, `05-DATABASE.md`, `RUNBOOK.md` (restore check, CSV handling), `DECISIONS.md` | |
| Not touched | `app.module.ts`, `package.json`, `pnpm-lock.yaml`, `infra/nginx/*`, `scripts/backup.sh` |

# OPEN QUESTIONS (ask the owner before building the affected part)

Owner = Rasel Mridha. Client = GLTS Leadership × Sirat Olympiad. Add the answer + date, then move it to DECISIONS.md.

**Answered 2026-10-30 (see DECISIONS.md "Owner answers before Phase A"):** email verification is lazy; #3 and #13 defaults accepted as placeholders pending client confirmation; #16 provider still open (dev uses Mailpit); #22 owner will confirm VPS specs later.

## Blocking for specific modules

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| 1 | **PayStation:** merchant account + sandbox credentials? Which methods enabled? Who pays the gateway charge (`pay_with_charge`)? Callback parameter names, checkout expiry, IPN retry rules (not in public docs)? Currency BDT only? | Payments | Build against sandbox; expiry 60 min; `pay_with_charge=1`; verify callback params in sandbox |
| 2 | Registration fee amount and registration open/close dates | Registration | Config in `settings`, no hardcoding |
| 3 | Category ↔ grade-level mapping for the 17 grade levels (Activist / Ambassador / Achiever bands) | Seed data | Use old bands (SDG 1–4 → Activist, 5–10 → Ambassador, 11–17 → Achiever) |
| 4 | Exam format: question types, count, negative marking, image questions, languages | Exam engine | MCQ A–D, no negative marking, text only |
| 5 | Question **pool size** and questions per attempt | Exam engine | Pool configurable per exam |
| 6 | Exam window length per exam; is 30 min a hard max for every exam? | Exam config | CHECK ≤ 30 |
| 7 | Submit **grace period** after `ends_at` | Submit | 30 s |
| 8 | Disconnect mid-exam: timer keeps running — confirmed with client? | Exam rules | Yes (RULEBOOK 7.1) |
| 9 | Tab-switch / focus-loss logging: off, log-only, or auto-submit after N violations? | Exam player | Log-only, optional flag |
| 10 | Show **scores** on the leaderboard or only rank/name? | Leaderboard | Rank + name + institution only |
| 11 | **`manager` role:** what are its duties? | Roles/admin | Read-only staff until defined |
| 12 | **Ambassador:** admin approval required, or self-generated code? | Ambassador | Admin approval |
| 13 | Ranks (names + point thresholds) and points per event (referral paid, task) | Ambassador | Bronze/Silver/Gold, thresholds editable |
| 14 | Round structure after Round 1 (video? final? how many?) and jury count/criteria (old: 10 criteria 0–10) | Rounds | Data-driven; port old criteria |
| 15 | Certificates: types, wording, who gets which, signatures | Certificates | Participation + promotion + winner, server-issued |
| 16 | Email provider and sending domain (SPF/DKIM/DMARC) | Notifications | Queue + provider abstraction |
| 17 | Domain, Cloudflare available? TLS plan | Nginx | HTTP in compose, TLS TODO |
| 18 | Off-server backup target (S3-compatible or second machine) | Backups | Local dump + TODO |
| 19 | Import old Season 2 users/results, or start fresh? | Migration | Start fresh |
| 20 | Teachers/schools: dashboards, bulk registration? | Scope | Out of scope |
| 21 | Languages: Bangla + English both at launch? Mobile app later? | i18n | Both, web only |
| 22 | Hosting: confirm Hostinger KVM 8 specs; Malaysia/AWS fallback plan | Infra | Single VPS |
| 23 | Support coverage promised to client (exam-day only vs 24/7 any-time) | Runbook/contract | Exam-day only |
| 24 | Real expected **peak concurrency** and whether starts are bunched (e.g. at window open) | Load test | 1,300–3,800 estimate |
| 25 | **CI cannot block merges**: the repo is private on GitHub Free, where branch protection/required checks are unavailable (HTTP 403). Upgrade to GitHub Pro (or make the repo public) and switch to pull requests with required checks, or keep pushing to `main` with the rule "deploy only a commit with a green CI run"? | Release process | Advisory CI + green-SHA deploy rule |
| 26 | Postgres error logs include the conflicting value on unique violations (e.g. `Key (email)=(…) already exists`). Accept (logs are private and rotated), or set `log_error_verbosity = terse` (also drops deadlock/lock-wait detail)? | Logging / privacy | Keep default; A2 checks duplicates in code first so the constraint rarely fires |
| 27 | Run the API with a **non-superuser** DB role (separate from the bootstrap/migration role)? Needs a second PgBouncer user and grants. | Security hardening | Yes, in the hardening phase |

## PayStation — unconfirmed until the official docs PDF is read (owner, 2026-10-30)

Official sources are only the merchant-dashboard Postman collection (`docs/paystation/postmanCollection.json`, git-ignored because it holds credentials) and the official docs PDF (not yet in the repo). `docs/paystation/PAYSTATION-API.md` is superseded. The Postman collection contains only `POST /initiate-payment` (multipart form, `merchantId` + `password` in the body) and `POST /transaction-status` (header `merchantId`, JSON `invoice_number`), both on `https://api.paystation.com.bd`, with no example responses. Do not build on the items below until the PDF confirms them.

| # | Question | Postman shows | Blocks |
|---|---|---|---|
| P1 | **Callback parameters**: which query parameters does PayStation append to `callback_url` (names, values for success/failed/canceled, is `trx_id` included)? | Nothing | Callback handler |
| P2 | **IPN** (server-to-server notification): does it exist, URL registration, payload, signature, retry rules? RULEBOOK §8.2 assumes an unsigned IPN for successful payments only. Until confirmed the system must stay correct with callback + transaction status + reconciliation only. | Nothing | IPN endpoint |
| P3 | **Transaction status v2** (`/v2/transaction-status` by `trxId`, RULEBOOK §8.1): does it exist, and what are the response fields? | Only v1 `/transaction-status` by `invoice_number` | Verification |
| P4 | **Sandbox base URL**: the collection named "PayStation Sandbox" calls `https://api.paystation.com.bd` (same host as live); is sandbox selected by credentials only, or is there a separate host? | Same host as live | Config (`PAYSTATION_ENV`) |
| P5 | **Response shapes and codes** for both endpoints: `status_code` values (200, 1008 duplicate invoice, 2001, …), `payment_url`, `trx_status` values, amount field and format | No example responses | Client, settlement |
| P6 | `pay_with_charge` (RULEBOOK §8.1) is absent from the collection: is it supported, and does the status response amount include the gateway charge when the customer pays it? | Absent | Amount check |
| P7 | **invoice_number length**: we keep it ≤ 20 characters, but the collection's cURL example uses a 23-character invoice. What does the API (sandbox) do with longer values? See `docs/paystation/SANDBOX-CHECKLIST.md`. | 23-char example | Invoice generator |

## Notes from the old system worth confirming

* Old `/api/leaderboard` showed rank/name/institution/status but no scores.
* Old certificate eligibility was `is_participated` / round ≥ 2, decided in the browser; new rule: server decides from DB state.

# OPEN QUESTIONS (ask the owner before building the affected part)

Owner = Rasel Mridha. Client = GLTS Leadership × Sirat Olympiad. Add the answer + date, then move it to DECISIONS.md.

**Answered 2026-10-30 (see DECISIONS.md "Owner answers before Phase A"):** email verification is lazy; #3 and #13 defaults accepted as placeholders pending client confirmation; #16 email provider = Resend, replaced on 2026-10-31 by Amazon SES (sending domain still to verify; dev uses Mailpit); #22 owner will confirm VPS specs later. PayStation P2-P5 answered by the official docs (section below). #27 is on the pre-launch checklist (RUNBOOK §9).

## Blocking for specific modules

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| 1 | **PayStation:** production merchant account and approval? Which methods enabled? ~~Who pays the gateway charge (`pay_with_charge`, P6)?~~ **Answered 2026-10-31: the merchant, `pay_with_charge = 0`** (DECISIONS "Gateway charge"). Checkout expiry and the IPN retry count/interval (not in the official docs). Callback parameters: P1. (Shared sandbox credentials are published on PayStation's docs page; currency BDT per docs.) | Payments | Build against sandbox; expiry 60 min; `pay_with_charge=0` (owner); verify the rest in sandbox |
| 2 | ~~Registration fee amount~~ **Fee answered 2026-10-31: 400 BDT** in `settings` (DECISIONS "Registration fee"). Still open: registration open/close dates | Registration | Config in `settings`, no hardcoding |
| 3 | Category ↔ grade-level mapping for the 17 grade levels (Activist / Ambassador / Achiever bands) | Seed data | Use old bands (SDG 1–4 → Activist, 5–10 → Ambassador, 11–17 → Achiever) |
| 4 | ~~Exam format: question types, count, negative marking, image questions, languages~~ **Answered 2026-10-31 (owner):** MCQ, one correct answer, 4 options (2–6), 1 mark, no negative marking, text only (DECISIONS "Exam rules (owner)") | Exam engine | MCQ A–D, no negative marking, text only |
| 5 | ~~Question **pool size** and questions per attempt~~ **Answered 2026-10-31 (owner):** the same questions for everyone (pool = questions per attempt), order and options shuffled; a larger random pool only if the admin chooses it (DECISIONS "Exam rules (owner)") | Exam engine | Pool configurable per exam |
| 6 | ~~Exam window length per exam; is 30 min a hard max for every exam?~~ **Answered 2026-10-31 (owner):** the admin sets each window; 30 min is the hard maximum (CHECK) (DECISIONS "Exam rules (owner)") | Exam config | CHECK ≤ 30 |
| 7 | ~~Submit **grace period** after `ends_at`~~ **Answered 2026-10-31 (owner):** 30 s; with no submit by then, the server submits the last checkpoint (DECISIONS "Exam rules (owner)") | Submit | 30 s |
| 8 | ~~Disconnect mid-exam: timer keeps running — confirmed with client?~~ **Answered 2026-10-31 (owner):** yes, the timer keeps running; resume within the remaining time (DECISIONS "Exam rules (owner)") | Exam rules | Yes (RULEBOOK 7.1) |
| 9 | ~~Tab-switch / focus-loss logging: off, log-only, or auto-submit after N violations?~~ **Answered 2026-10-31 (owner):** a warning on every tab/app switch and developer-tools key; after 5 warnings the 6th ends the exam with the current answers; always on, no admin switch (DECISIONS "Exam rules (owner)") | Exam player | Log-only, optional flag |
| 10 | ~~Show **scores** on the leaderboard or only rank/name?~~ **Answered 2026-10-31 (owner):** rank + name + institution only; own score and review after the results are published (DECISIONS "Exam rules (owner)") | Leaderboard | Rank + name + institution only |
| 11 | **`manager` role:** what are its duties? | Roles/admin | Read-only staff until defined |
| 12 | **Ambassador:** admin approval required, or self-generated code? | Ambassador | Admin approval |
| 13 | Ranks (names + point thresholds) and points per event (referral paid, task) | Ambassador | Bronze/Silver/Gold, thresholds editable |
| 14 | Round structure after Round 1 (video? final? how many?) and jury count/criteria (old: 10 criteria 0–10) | Rounds | Data-driven; port old criteria |
| 15 | Certificates: types, wording, who gets which, signatures | Certificates | Participation + promotion + winner, server-issued |
| 16 | ~~Email provider~~ **Answered 2026-10-31: Amazon SES** (DECISIONS "Email provider: Amazon SES"; replaces Resend, chosen on 2026-10-30). Still open: the sending domain and its SPF/DKIM/DMARC setup | Notifications | Mailpit in dev until the domain is verified |
| 17 | Domain, Cloudflare available? TLS plan | Nginx | TLS plan decided (DECISIONS "TLS behind Cloudflare": Origin CA, Full (strict)); the domain and the Cloudflare account wait for the owner (LAUNCH-PLAN Q3) |
| 18 | Off-server backup target (S3-compatible or second machine) | Backups | Local dump + TODO |
| 19 | Import old Season 2 users/results, or start fresh? | Migration | Start fresh |
| 20 | Teachers/schools: dashboards, bulk registration? | Scope | Out of scope |
| 21 | Languages: Bangla + English both at launch? Mobile app later? | i18n | Both, web only |
| 22 | ~~Hosting: confirm Hostinger KVM 8 specs~~ **Specs confirmed 2026-11-03 on the VPS:** 8 vCPU (AMD EPYC 9354P), 31 GB usable (32 GB nominal), 387 GB disk, Ubuntu 26.04.1 LTS; no retune needed (DECISIONS "VPS specs confirmed"). Still open: the Malaysia/AWS fallback plan | Infra | Single VPS |
| 23 | Support coverage promised to client (exam-day only vs 24/7 any-time) | Runbook/contract | Exam-day only |
| 24 | Real expected **peak concurrency** and whether starts are bunched (e.g. at window open) | Load test | 1,300–3,800 estimate |
| 25 | **CI cannot block merges**: the repo is private on GitHub Free, where branch protection/required checks are unavailable (HTTP 403). Upgrade to GitHub Pro (or make the repo public) and switch to pull requests with required checks, or keep pushing to `main` with the rule "deploy only a commit with a green CI run"? | Release process | Advisory CI + green-SHA deploy rule |
| 26 | Postgres error logs include the conflicting value on unique violations (e.g. `Key (email)=(…) already exists`). Accept (logs are private and rotated), or set `log_error_verbosity = terse` (also drops deadlock/lock-wait detail)? | Logging / privacy | Keep default; A2 checks duplicates in code first so the constraint rarely fires |
| 27 | Run the API with a **non-superuser** DB role (separate from the bootstrap/migration role)? Needs a second PgBouncer user and grants. | Security hardening | Yes, before launch (owner, A1 approval). The role `sirat_app` and its grants exist (L2, 05-DATABASE "Roles"); the API switches to it in L8 |

## PayStation (official docs read 2026-10-30; summary: `docs/paystation/PAYSTATION-NOTES.md`)

Official sources: the documentation page (printed copy `docs/paystation/paystation.pdf`) and the merchant-dashboard Postman collection, both local and git-ignored (shared sandbox credentials inside). `PAYSTATION-API.md` is superseded.

**Open**

| # | Question | What the official docs say | Blocks |
|---|---|---|---|
| P1 | **Callback parameters**: names and values PayStation appends to `callback_url` (success/failed/cancelled), the HTTP method, and whether cancel/failure return at all. **Mostly answered in the sandbox 2026-10-31:** GET; success `status=Successful`, `invoice_number`, `trx_id`; failure `status=Failed`, an empty `trx_id`, `message=Failed`. Still open: cancel (`SANDBOX-CHECKLIST.md` S4, S5, S16) | Only "parameters indicating payment outcomes"; no names. PayStation's own WooCommerce/OpenCart plugins read GET `status`, `invoice_number`, `trx_id` (`status=canceled` for cancel), which is plugin code, not API docs. We carry our invoice in the callback path and verify via transaction status, so nothing depends on these names | Callback handler (sandbox S4, S5, S16) |
| P6 | ~~`pay_with_charge`: with 1 (customer pays the charge), is the status amount ours or ours + charge? Which value does the owner choose?~~ **Owner answered 2026-10-31: `0`**, the merchant pays the charge; only `0` is built (DECISIONS "Gateway charge"). Still open: confirm in the sandbox that with `0` v1 `payment_amount` is exactly the fee and the checkout shows only the fee | Marked "Required", "1 customer / 0 merchant", "default 0"; nothing on amounts. v2 returns both `request_amount` and `payment_amount` | Amount check (sandbox S10) |
| P7 | invoice_number length the gateway accepts | No limit stated. Our rule stays: at most 20 characters, unique, never reused | Informational (sandbox S1, S2) |
| P8 | ~~**Refunds**: when a payment is refunded (merchant panel; there is no refund API), what happens to the student's registration and exam access?~~ **Owner answered 2026-10-31: no refund handling.** The status never changes to `refunded`; a refund reported by PayStation is recorded with a critical alert; returning money is outside the system (DECISIONS "No refund handling") | Not a PayStation question: owner policy | RUNBOOK §11, admin payments screen |

**Answered by the official docs (closed 2026-10-30)**

| # | Answer |
|---|---|
| P2 | **IPN exists**: JSON POST to an HTTPS URL registered with PayStation, successful transactions only, no auth/signature, retried a limited (unstated) number of times on non-2xx or timeout. Payload `invoice_number`, `trx_status`, `trx_id`, `trx_amount` (number), `order_date_time`, `payment_method`, optional `reference` |
| P3 | **Transaction status v2 exists**: `POST /v2/transaction-status`, headers `merchantId` + `Content-Type: application/json`, JSON `{"trxId"}`; adds `trx_amount`, `trx_date`, `request_amount`, `payment_amount`. v1 (`/transaction-status`, form `invoice_number`) stays our main check |
| P4 | **Sandbox** `https://sandbox.paystation.com.bd`, **live** `https://api.paystation.com.bd`. The docs' code samples still call the live host with sandbox credentials: confirm the host in sandbox (S11) |
| P5 | `status_code` is a string: `"200"` success, `"1008"` duplicate invoice, `"2001"` not found **or** credential mismatch. `data` only on `"200"`; top-level `status` = lookup result; `data.trx_status` = `processing`/`success`/`failed`/`refund` (case varies); amounts as `"120"`, `"120.00"` or numbers; empty `trx_id` when none |

## Notes from the old system worth confirming

* Old `/api/leaderboard` showed rank/name/institution/status but no scores.
* Old certificate eligibility was `is_participated` / round ≥ 2, decided in the browser; new rule: server decides from DB state.

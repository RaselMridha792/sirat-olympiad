# 10 — Build plan and phase rules (owner decision, 2026-10-30)

**Decision:** the public frontend design is not final. So we build in this order: **(A) backend + data model, (B) student/admin dashboards, (C) registration + payment made perfect**, and only then (D) the public marketing site once the design is confirmed.

## Phase rules (apply to every task)

1. **API-contract first.** Define/adjust the endpoint in `docs/06-API.md` and the DTO, then implement, then build UI on top. The UI never invents data shapes.
2. **UI is design-agnostic for now.** Build screens only from `@sirat/ui` components and tokens. Layout and look can change later by editing tokens/components, not page logic. Keep logic (hooks, API calls, forms, validation) separate from presentation.
3. **Do NOT polish public marketing pages** (home, about, gallery, FAQ, contact) in phases A-C. Keep the placeholder. Do not hardcode copy; leave content in `src/i18n` / config so the final design can drop in.
4. **Dashboards are real, not mock.** Every dashboard screen must read from a real endpoint with loading/empty/error states. Delete `lib/mock.ts` usage as each endpoint lands.
5. **Backend is complete before its UI is called done.** A feature counts as done only with: migration, DTO validation, guard, ownership check, unit/e2e test, audit log where required, and docs updated.
6. **One phase at a time.** Do not start the next phase until the current one's "Definition of done" below is shown with real command output.
7. **Ask before guessing** on auth, payments, exam logic, or anything in `docs/OPEN-QUESTIONS.md`.

## Phase A — Backend foundation (do first)

Order: migrations + seed → CI → **auth** → **payments** → **exam engine** → leaderboard/results → admin APIs → rounds/jury/promotion/certificates → ambassador program → queues/workers.
Definition of done per module: tests for the DB constraints and rules in `05-DATABASE.md`/`RULEBOOK.md` §18, and the "no unguarded route" CI test passing.

## Phase B — Dashboards (on top of the finished APIs)

* **Student dashboard:** home, profile (allow-list edit), my registration/payment status, exams (waiting room, player, receipt), leaderboard, results, certificates, announcements, payment history.
* **Admin dashboard:** KPIs, users, exams/questions, settings, payments lookup + reconcile, leaderboard + publish, promotion, jury, announcements, ambassadors/tasks/points, audit log.
* **Ambassador dashboard:** code, referrals, points, rank, team, tasks.
Port looks from `reference/` via `docs/07-UI-MIGRATION.md`. Role-based menus on the server; API enforces access.

## Phase C — Registration + payment, made perfect

This flow earns money, so it gets the most care and the most tests. Definition of done (ALL must hold, each covered by an automated test or a documented sandbox check):

| # | Requirement |
|---|---|
| 1 | Server-side form storage in `pending_registrations`; survives PayStation round trip, other device, cleared browser |
| 2 | Registration open/closed, fee, currency come from `settings` and are enforced by the API |
| 3 | No `role` accepted from the client; unknown fields rejected; category derived from `grade_levels` |
| 4 | Duplicate email/phone handled with a clear message and no account enumeration leak beyond what is acceptable (decide with owner) |
| 5 | Payment row created before redirect; unique `invoice_number`; no reuse |
| 6 | Callback is a hint only; paid only after PayStation transaction-status confirms success AND amount + invoice match |
| 7 | IPN handled idempotently and re-verified through the status API |
| 8 | Replaying callback/IPN/parallel requests never creates a second account (`UNIQUE(payment_id)`, `UNIQUE(trx_id)`, row lock, one transaction) |
| 9 | Reconciliation job settles abandoned payments; expiry configurable; alert when pending beyond expiry |
| 10 | User can close the tab at any step and later resume or restart without double charge; "Check my payment status" works |
| 11 | Success/failure redirect targets are config and covered by an e2e test |
| 12 | Referral/promo code validated server-side; referral credit only after payment confirmed (ledger event key) |
| 13 | Email verification + welcome email queued; failures retried; never block registration |
| 14 | Mobile-first, weak-network friendly, Bangla/English, clear error messages, no raw errors |
| 15 | Admin can look up a payment by invoice/trx/phone and manually reconcile (audit-logged) |
| 16 | Full flow tested end-to-end in PayStation **sandbox**, then one real small payment before launch |
| 17 | k6 registration-surge scenario passes (p95 < 500 ms, errors < 0.5%) |

## Phase D — Public site (after design is confirmed)

Marketing pages, SEO (real sitemap/robots/metadata), content from one source, optimized images, bn/en. Starts only when the owner confirms the design.

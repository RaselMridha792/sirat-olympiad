# 04 — Features

Legend: **P0** must exist for the first real exam · **P1** needed for the full competition · **P2** later/optional.
Old-system source is in `reference/` (see `07-UI-MIGRATION.md`). SDG is removed from this product.

## Roles

| Role | Can do |
|---|---|
| `student` | Register, pay, take exams, see own results/certificates, profile |
| `ambassador` | Student + ambassador dashboard (promo code, referrals, points, rank, team, tasks). Needs admin approval (confirm) |
| `jury` | Score video submissions (own scores only) |
| `manager` | Duties **not yet defined** by the client (see OPEN-QUESTIONS). Treat as read-only staff until defined |
| `admin` | Everything, audit-logged. 2FA recommended before launch |

## Student-facing

| # | Feature | Pri | Acceptance rules |
|---|---|---|---|
| S1 | Public site (home, about, instructions, FAQ, contact, legal) | P0 | Server-rendered/static, per-page metadata, real sitemap/robots, content from one source, bn/en |
| S2 | Registration wizard + PayStation payment | P0 | See HOW-IT-WORKS §1. Server-side form storage. Category from grade table. Closed/open enforced on server |
| S3 | Payment status/recovery page | P0 | Poll + "Check my payment status", resume/restart, never double-charge |
| S4 | Login / logout / forgot / reset / verify email | P0 | Cookie session, rotation, rate limits, no enumeration |
| S5 | Dashboard home | P0 | Current exam/round card, status, rules, announcements |
| S6 | Waiting room + Start | P0 | Start enabled at `window_start` (server time) |
| S7 | Exam player | P0 | One question at a time, nav palette, local autosave, checkpoints, connection status indicator, auto-submit with current answers, resume, mobile-first |
| S8 | Submission receipt | P0 | Receipt id, no score shown |
| S9 | Leaderboard | P0 | Snapshot after window closes, server paging + search, no scores unless owner decides |
| S10 | Profile view/edit | P0 | Allow-list fields only; photo upload through server-controlled flow |
| S11 | Results + review | P1 | Unlocks after window closed for everyone |
| S12 | Certificates | P1 | Server-issued, verification URL, PDF generated server-side/queued |
| S13 | Payment history / invoice | P1 | Real status (not hardcoded "PAID"), server-generated PDF |
| S14 | Announcements | P1 | Read-only list |
| S15 | Video submission (Round 2) | P1 | Link submit inside window, edit until close, see score after evaluation |
| S16 | Learning resources ("My Courses") | P2 | Content from config, not hardcoded |

## Ambassador

| # | Feature | Pri | Rules |
|---|---|---|---|
| A1 | Ambassador dashboard (code, referrals, points, rank) | P1 | Derived from ledger/rows; cached |
| A2 | Team create/view | P1 | Visible only to members + admin |
| A3 | Tasks (view assigned, submit proof) | P1 | Points only after admin approval |
| A4 | Ambassador leaderboard | P2 | Cached, paged |

## Admin / staff

| # | Feature | Pri | Rules |
|---|---|---|---|
| M1 | Dashboard KPIs | P0 | Cached aggregates; registrations trend, by category, payments, active attempts |
| M2 | User management | P0 | Paged/search/filter; role change admin-only + audited; block/unblock; no hard delete without audit |
| M3 | Exam + question management | P0 | CRUD; pool; lock after publish; versioned questions; CSV import (P1) |
| M4 | Competition settings | P0 | Registration open/closed, fee, currency, windows, leaderboard public flag |
| M5 | Payments admin | P0 | Lookup by invoice/trx/phone, manual reconcile (audited), pending-too-long alerts |
| M6 | Leaderboard admin | P1 | Full data (email, score, time), publish toggle |
| M7 | Promotion tool | P1 | Idempotent, audited, previews top-N before commit |
| M8 | Jury evaluation | P1 | Pending/evaluated tabs, 10 criteria, judge recorded, history |
| M9 | Announcements CRUD | P1 | |
| M10 | Ambassador admin (approve, tasks, points corrections, rank thresholds) | P1 | Compensating ledger entries only |
| M11 | Traffic sources / UTM | P2 | |
| M12 | Reset participant | P2 | Guarded, audited, reason required |
| M13 | Audit log viewer | P1 | |
| M14 | Certificates admin | P1 | Issue/revoke, verification page |

## Cross-cutting (P0)

Rate limiting; audit log; health/ready; structured logging; Sentry; queue dashboards/alerts; backups + restore drill; k6 load tests; CI gates; i18n bn/en; accessibility basics; mobile-first.

## Build order (recommended; phase rules in `10-BUILD-PLAN.md` take precedence)

1. **Foundation:** Prisma migrations (incl. raw-SQL CHECKs), seed (grade levels, rank thresholds, settings), CI, Docker compose up, `/api/ready` green.
2. **Auth** (S4) with tests: argon2id, sessions, rotation/reuse, CSRF, rate limits, guards + the "all routes have guards" CI test. Replace the mock `getSession`.
3. **Payments** (S2, S3, M5) against PayStation sandbox: state machine, callback+status, IPN, reconciliation job, idempotency tests.
4. **Exam engine** (S6–S8, M3, M4): attempts, Redis checkpoints, idempotent submit, scoring queue, auto-submit test, resume. First k6 exam simulation here, early.
5. **Leaderboard + results** (S9, S11, M1, M6).
6. **Admin core** (M2, M9) and student shell polish (S1, S5, S10, S14).
7. **Rounds/jury/promotion/certificates** (S12, S15, M7, M8, M14).
8. **Ambassador program** (A1–A3, M10).
9. **Hardening:** full load tests at 1.5–2× peak, monitoring + fake alert, restore drill, pre-exam checklist (`RULEBOOK.md` §13).

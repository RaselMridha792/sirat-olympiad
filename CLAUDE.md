# CLAUDE.md — Sirat Leadership Olympiad

Read this file first, every session. It is short on purpose. Details live in `docs/`.
Owner: Rasel Mridha (Exprovia). Reply to the owner in Bengali; code, comments and docs stay in English.

## 1. DO and DON'T (the rules that matter most)

### DO
1. **Do read `docs/RULEBOOK.md` before writing code.** It is the source of truth; this file only summarises it. If a task conflicts with it, stop and ask the owner.
2. **Do plan first** for anything bigger than a small fix: files to touch + risks, then code in small steps. One feature/fix per commit (`feat:`, `fix:`, `chore:`).
3. **Do keep the server the authority** on time, score, price, role and payment status. The browser only displays.
4. **Do take the acting user id and role only from the verified session cookie.** Check ownership of every `:id` on the server.
5. **Do use DTOs** (class-validator, `whitelist` + `forbidNonWhitelisted`) on every endpoint, and an explicit guard on every route (deny by default).
6. **Do put every schema change in a Prisma migration**, including indexes and raw-SQL CHECKs.
7. **Do paginate every list on the server.** Cache read-heavy data in Redis with explicit invalidation.
8. **Do move slow work to the queue** (email, PDF, certificates, scoring). Every job is idempotent with retries.
9. **Do reuse `packages/ui` components and the tokens in `packages/ui/src/styles/tokens.css`.** Add new shared components there.
10. **Do treat `reference/` as a read-only specification** of the old Zero Olympiad (UI look, business rules). Re-write in TypeScript against our rules; see `docs/07-UI-MIGRATION.md`.
11. **Do run checks at the right time, never skip them** (owner, 2026-10-31): before each commit `tsc --noEmit` in apps/api, lint on the changed files and the related tests; once before opening a PR the full `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, `pnpm --filter @sirat/api test:int` and the docker smoke test; password hashing, refresh rotation/reuse, CSRF, login limits/lockout, the guard coverage test and the audit log run their related tests at every step.
    Report success in one line (`api types ✓, lint ✓, auth tests 14 ✓`) and failures with their error lines only; never say "done" without the checks.
12. **Do log every non-obvious decision** in `docs/DECISIONS.md` and keep `docs/RUNBOOK.md` current.
13. **Do ask the owner** when auth, payments or exam logic is unclear. See `docs/OPEN-QUESTIONS.md`.

### DON'T
1. **Don't import or copy code blindly from `reference/`.** It has known critical bugs (privilege escalation, unauthenticated refunds, leaked answers). Port the idea, not the code.
2. **Don't use Supabase, Vercel serverless, Auth0, Clerk, Firebase** or any pay-per-request service in the critical path.
3. **Don't store tokens in localStorage / JS-readable cookies / redux-persist.** One httpOnly session cookie only.
4. **Don't trust the client** for time, score, price, role, `user_id` or payment result. Never accept `role` at registration or in profile update.
5. **Don't write to the database per answer/keystroke** during an exam. Local save in the browser, checkpoints to Redis, one idempotent final submit.
6. **Don't send `correct_answer`, explanations or scores to any client** before the window has closed for everyone.
7. **Don't mark a payment paid** from the browser redirect. Only after the PayStation transaction-status API confirms (amount + invoice match).
8. **Don't delete and re-create questions** once an exam is published. Version them.
9. **Don't log** passwords, tokens, OTPs, full payloads or personal-data objects. Don't return raw DB errors or stack traces.
10. **Don't put `.env` or secrets in git**, `NEXT_PUBLIC_*`, images or logs. Never open, print or copy the old project's `.env` files.
11. **Don't expose Postgres, PgBouncer or Redis publicly.** Only Nginx publishes ports.
12. **Don't deploy during a live exam window**, run destructive commands, or force-push without explicit owner confirmation.
13. **Don't put mock JSON in `public/`**, use `dangerouslySetInnerHTML` with user text, or use the Google Translate widget (real i18n only).
14. **Don't claim "done"** without showing what you ran and the output.

## 1b. Current build strategy (owner decision, see `docs/10-BUILD-PLAN.md`)

Frontend design is NOT final. Build in this order, one phase at a time:
**A) backend + data model → B) student/admin/ambassador dashboards on real APIs → C) registration + payment made perfect → D) public marketing site (only after the design is confirmed).**

* Do **not** polish public marketing pages now; keep placeholders, keep copy in i18n/config.
* UI uses only `@sirat/ui` + tokens so the look can change later without touching logic.
* API contract first (`docs/06-API.md`), then DTO, implementation, tests, then UI. A feature is done only with migration + validation + guard + ownership check + tests + docs.
* Registration/payment has a 17-point Definition of Done in `docs/10-BUILD-PLAN.md` Phase C. Do not call it done until every point is shown with real output.
* Do not start the next phase until the current one is proven with real command output.

## 2. Read order (documents)

| # | File | Purpose |
|---|---|---|
| 1 | `docs/RULEBOOK.md` | Hard rules (architecture, security, payments, exam engine, ops). Source of truth |
| 2 | `docs/01-TECH-STACK.md` | Every technology and why (handoff) |
| 3 | `docs/02-SYSTEM-DESIGN.md` | Architecture, capacity, data flow, failure modes |
| 4 | `docs/03-HOW-IT-WORKS.md` | Step-by-step flows: register, pay, login, exam, results |
| 5 | `docs/04-FEATURES.md` | Every feature by role, with acceptance rules |
| 6 | `docs/05-DATABASE.md` | Tables, constraints, indexes, migrations plan |
| 7 | `docs/06-API.md` | Endpoint list, guards, DTO rules |
| 8 | `docs/07-UI-MIGRATION.md` | Old UI -> new component mapping (login, register, leaderboard, dashboards) |
| 9 | `docs/08-DESIGN-TOKENS.md` | Colors, fonts, spacing, component rules |
| 10 | `docs/09-FOLDER-STRUCTURE.md` | What lives where |
| 11 | `docs/10-BUILD-PLAN.md` | Phase order (backend → dashboards → registration → public site) and Definition of Done |
| 12 | `docs/DECISIONS.md`, `docs/RUNBOOK.md`, `docs/OPEN-QUESTIONS.md` | Living documents |

## 3. Commands

```bash
pnpm install
pnpm --filter @sirat/shared build     # required once before api/web build (shared is compiled)
pnpm dev:web                          # http://localhost:3000 (proxies /api -> :4000)
pnpm dev:api                          # NestJS on :4000 (needs apps/api/.env, Postgres, Redis)
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm --filter @sirat/api test:int     # DB + Redis integration tests (needs the dev data services; uses *_test DB only)
pnpm db:generate && pnpm db:migrate   # Prisma (needs DATABASE_URL + DIRECT_URL)
pnpm --filter @sirat/api db:seed      # idempotent config seed (also runs in the compose `migrate` job)
docker compose --env-file .env -f infra/docker-compose.yml up -d --build                                  # server
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d --build  # local only
```
Local setup, fixtures and ports: `docs/RUNBOOK.md` section 0. Git: commits/pushes are authored by the owner only, no AI co-author trailers; no direct pushes to `main` (branch + pull request; pull requests are merged only by the lead session (owner decision 2026-10-31, DECISIONS)) until OPEN-QUESTIONS #25 is decided.

## 4. Current state (update this when it changes)

- **Launch target (Lead, 2026-10-31): 2026-11-15, first step registration and payment only.** Students log in after paying, so the first-admin CLI and the web session are on the critical path. Launch readiness (deploy, TLS, backups, runtime DB role, monitoring, maintenance page, checklist): `docs/plans/LAUNCH-PLAN.md`.
- **Sessions** (the lead session gives the tasks and merges the pull requests): **A2** (auth, launch readiness; DBs `sirat`/`sirat_test`, Redis DB 0); **payments** (registration + PayStation, `docs/plans/PAYMENTS-PLAN.md`; `sirat_pay`/`sirat_pay_test`, Redis DB 1); **exam** (`docs/plans/EXAM-PLAN.md`; `sirat_exam`/`sirat_exam_test`, Redis DB 2); **core** (`docs/plans/CORE-PLAN.md`; `sirat_core`/`sirat_core_test`, Redis DB 3: admin students list, the public entry page, privacy/terms/refund-policy pages, profile, announcements, ambassador, rounds/jury/certificates).
- **Merged:** A1 foundation (A1.1). Auth (owner's login rules, DECISIONS): A2.0 (#3), guard rails (#4), passwords + sessions (#5), email queue + worker, SES/Mailpit (#6), login with the owner's limits and alerts, change-password, forgot/reset/verify/resend, operator alerts (#7), first-admin CLI (#10), web session (#12), refresh rotation budget (#15), per-user API limits (#20). UI port on a mock data layer: student (#8) and admin (#9) dashboards. Payments: plan (#11), foundation (schema, fee 400 BDT, fixtures, PayStation settings, #14), PayStation client, fake server, selfcheck and decision rules (#18), registration start and status (start, info, current/resume/retry/cancel, `/registrations/me`, `/payments/mine`, #21). Exam: plan (#13), schema + exam/question admin API (#16), student engine (start, resume, Redis checkpoints, idempotent submit, #17), results E3 (scoring, server-side finalize, snapshot, publish, leaderboards, review, #19), exam room and player with the violation rule (E4, #24). Core: plan (#22), public entry and legal pages with placeholder texts (#25), admin students list with search, filters and audited CSV export (C1, #26). Web: HTTP data source, the student exam list wired (#23). Open: payments PR 3 (verify job, settle, callback, IPN, reconciliation, admin payments and settings, #27). Details: `docs/DECISIONS.md`.
- Phase A scope (owner): auth (A2), exam engine, leaderboard/results, admin core. Rounds/jury/certificates/ambassador later; registration + payment is Phase C. Phases: `docs/10-BUILD-PLAN.md`.
- Not built yet: payments PR 3–6 (settle, callback/IPN, recheck, reconciliation, admin payments and settings; the wizard, result page and dashboard status; sandbox and k6; the free book: PAYMENTS-PLAN §10.4); exam E5–E6 (admin UI, load test); core C3, C4 and C5a before launch (profile, announcements with the dashboard home, ambassador approval), C5b and C6 after; `GET /admin/stats` (no owner yet); the launch work in LAUNCH-PLAN (TLS on nginx, off-server backups, the runtime DB role, monitoring, maintenance page, "coming soon" states, the cleanup job for old sessions and tokens); admin 2FA (end of Phase A); other queue workers (PDF, certificates).
- PayStation: official docs read; summary in `docs/paystation/PAYSTATION-NOTES.md` (the PDF and Postman export stay local, git-ignored).
- The web reads the real session (`apps/web/src/lib/session.ts`). Production dashboards read the API through `apps/web/src/data/http/` (#23): the student exam list and exam room (#23, #24) and the admin students list (#26) are wired, and every other method shows the error state until its area file lands. Development uses the mock unless `DATA_SOURCE=http`.
- The local docker stack (project `sirat`, same ports) is shared between sessions (Lead, 2026-10-31): use it only after the lead or the owner says so, with `origin/main` merged first; rebuild only the app services (`$DCD up -d --build --no-deps migrate api worker web nginx`, plain `up -d --build` only when infra/compose changed or the data services are down); announce the start and the end in one line, and run nothing on it after releasing it (RUNBOOK §0).

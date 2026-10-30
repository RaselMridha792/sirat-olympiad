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
11. **Do run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`** before saying anything works, and report the real output.
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
Local setup, fixtures and ports: `docs/RUNBOOK.md` section 0. Git: commits/pushes are authored by the owner only, no AI co-author trailers; no direct pushes to `main` (branch + pull request, the owner merges) until OPEN-QUESTIONS #25 is decided.

## 4. Current state (update this when it changes)

- **Phase A, step A1 (foundation) approved by the owner (2026-10-30); A1.1 merged.** A2 (auth) approved with the owner's login rules (DECISIONS, "A2 (auth) approval"). **A2.0** (the four logging/secret gates and the rate-limiter stall fix) is in PR #3; **A2.1a** (auth guard rails) in PR #4 stacked on it; **A2.1b** (passwords + sessions) in a pull request stacked on #4. Next, in order: the rest of A2.1 (login + the other auth endpoints with their limits, email, admin CLI, web session) → payments (PayStation) → the rest of Phase A per `docs/10-BUILD-PLAN.md`. Built so far: Prisma migrations (init, raw-SQL CHECKs, review hardening, reference data, DB session timeouts, append-only `audit_logs`), idempotent config seed, dev fixtures guarded by a server marker, DB/Redis/AppModule integration tests, Redis-backed global rate limiter, `/api/ready` (DB + both Redis), allow-list Docker builds with a `migrate` job, CI with a full-stack smoke test, one shared HTTP pipeline (`configureApp`), env validation that refuses weak JWT secrets, 25 s request timeout, deny-by-default `AuthGuard` (`@Public`/`@Roles`, access-token cookie), CSRF header guard, and the route inventory test against the public allow-list; argon2id passwords with the owner's policy (8–128, top-10k list), refresh sessions with rotation and reuse detection, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `/auth/me`, and the audit service. Details: `docs/DECISIONS.md` (A2.1b, A2.1a, A2.0, A1.1, A1, A1 review fixes).
- Phase A scope (owner): auth (A2), exam engine, leaderboard/results, admin core. Rounds/jury/certificates/ambassador later; registration + payment is Phase C. Phases: `docs/10-BUILD-PLAN.md`.
- Not built yet: login, forgot/reset/verify/resend, change-password (sessions exist, but only tests start them; registration is Phase C), payments, exam engine, queues/workers, email (Resend in production, Mailpit in dev; part of A2.1), admin features. The login limits wait for the owner's answer on the shared-school-IP proposal (nginx `/api/auth/` zone, failure-only IP limit, per-user keys) and the lock semantics.
- PayStation: official docs read; summary in `docs/paystation/PAYSTATION-NOTES.md` (the PDF and Postman export stay local, git-ignored). PayStation code starts after A2.
- Auth session in the web app is a **mock** (`apps/web/src/lib/session.ts`). Replaced in A2.

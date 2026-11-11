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
10. **Do treat `reference/` as a read-only specification** of the old Zero Olympiad (UI look, business rules). Re-write in TypeScript against our rules; see `docs/07-UI-MIGRATION.md`. Since 2026-11-08 it is local-only and never in the public repo: git-ignored, with a copy at `G:\sirat-reference\reference` (and in the private archive).
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
Local setup, fixtures and ports: `docs/RUNBOOK.md` section 0. The repo is public since 2026-11-08 (DECISIONS): the old history and PRs up to #87 are in the private `RaselMridha792/sirat-olympiad-archive`, so PR numbers in older docs point there; never push an old-history commit (`git merge-base --is-ancestor 7587f2f HEAD` must fail before every push). Git: commits/pushes are authored by the owner only, no AI co-author trailers; no direct pushes to `main` (branch + pull request; pull requests are merged only by the lead session (owner decision 2026-10-31, DECISIONS)) until OPEN-QUESTIONS #25 is decided.

## 4. Current state (update this when it changes)

- **Launch target (Lead, 2026-10-31): 2026-11-15, first step registration and payment only.** Everything is ready on 15 Nov; registration stays closed until an admin opens it, expected 25 Nov (owner, DECISIONS). Launch readiness (deploy, TLS, backups, runtime DB role, monitoring, maintenance page, checklist): `docs/plans/LAUNCH-PLAN.md`.
- **Sessions** (the lead session gives the tasks and merges the pull requests): **A2** (auth, launch readiness; DBs `sirat`/`sirat_test`, Redis DB 0); **payments** (registration + PayStation, `docs/plans/PAYMENTS-PLAN.md`; `sirat_pay`/`sirat_pay_test`, Redis DB 1); **exam** (`docs/plans/EXAM-PLAN.md`; `sirat_exam`/`sirat_exam_test`, Redis DB 2); **core** (`docs/plans/CORE-PLAN.md`; `sirat_core`/`sirat_core_test`, Redis DB 3: admin students list, the public entry page, privacy/terms/refund-policy pages, profile, announcements, ambassador, rounds/jury/certificates).
- **Merged (main 5f261e3, PRs to #79, numbers of the private archive; details in `docs/DECISIONS.md`):**
  - Auth: A2.0–A2.x (#3–#7), first-admin CLI (#10), web session (#12), refresh budget (#15), per-user limits (#20), admin 2FA (#76).
  - Payments: plan (#11), foundation (#14), PayStation client, fake and selfcheck (#18), registration start and status (#21), the money flow (#27), the wizard, result page and admin payments (#33), the k6 registration surge (#44), the free book (#36, #42), the 10-minute checkout (#50), the D6 attempt scrub (#56), the fake PayStation image (#65), the CSV question import (E7a, #67).
  - Exam: plan (#13), schema and admin API (#16), engine (#17), results (#19), player (#24), results web (#30), authoring (#45), k6 simulation (#66), CI exam smoke (#73), login surge (#74), answer-key correction (#77).
  - Core: plan (#22), public pages with placeholder texts (#25), students list (#26), profile and grade correction (#28), announcements and home (#35), ambassadors (#41), admin stats (#46), audit-log viewer (#51), points (#54), tasks (#61), teams (#63), rounds and promotion (#71), video round and jury (#75), certificates without the PDF (#78).
  - Launch: L1 (#49), L2 (#57), L3 (#37), L4 (#68), L5 (#43), L6 (#34), L7 (#62), L9 (#53), L10 (#38), L11 (#40), L12 (#59, #70), L13 (#47), L14 part 1 (#79), the VPS load-test kit (#72).
  - Web: the dashboards ported on a mock layer (#8, #9), then the HTTP data source (#23); every area is wired.
- **Merged since the repo went public (public PR numbers, to #44; main 854800e):**
  - 8–9 Nov:
    - the public repo (#4, #6) and the pre-push hook (#8, #11);
    - the admin 2FA requirement as a setting (#5);
    - PayStation links https-only (#10); Postgres readiness over TCP (#18, #19); hex secrets (#21);
    - the brand colours and logo (#12, #27); the header menu (#7); the accessibility pass (#9);
    - the multi-page public site, parts 1–2, with placeholder texts (#14, #15);
    - demo data with one click and its phase 2 (#13, #17, #20, #22–#26);
    - the legal-text drafts (#2), the sandbox-run docs (#1), the registration-check design note (#16).
  - 10–11 Nov:
    - the participant ID (#31) and its re-issue (#34);
    - the round rule (#32);
    - the ambassador leaderboard (#33), ID card (#35) and UX pass (#41);
    - discount codes (#37, #40);
    - the admit card (#43) and the next exam it shows (#29);
    - the participant-ID login (plan #28, spray alert #30, login #39);
    - C1 certificate templates, API (#42);
    - demo follow-ups (#36, #38, #44).
- **Login:**
  - Students and ambassadors log in with email + participant ID, the ID on the admit card, and have no password (owner, 2026-11-10; DECISIONS 2026-11-11).
  - Staff (admin, manager, jury) log in with a password, plus 2FA for admin and manager.
  - The 2FA requirement is a setting on /admin/security; it is off on the VPS for testing, and the prelaunch check FAILs while it is off.
- Phases: `docs/10-BUILD-PLAN.md`. Every buildable item is built now (owner, 2026-11-01); the public site waits for the design (core's homepage draft is in progress).
- **VPS:** a Hostinger VPS runs the release at https://sirat.raselmridha.com (`deploy.sh`), with payments switched off there for now.
  - The domain is a Hostinger DNS A record; the sslip host is retired.
  - The Let's Encrypt certificate is renewed by hand before ~2027-01-09.
  - Still to come (LAUNCH-PLAN): Cloudflare, the off-server backup bucket, SES production access (an AWS review of up to ~24 h: RUNBOOK §12) and the live PayStation merchant.
- Not built or not merged yet:
  - L8, the switch to `sirat_app` (A2's draft #3, waiting on Rasel's values), and the prelaunch check of its boot line;
  - L14 part 2 (k6 on the VPS: exam's login surge, then the numbers to A2; since #39 the student login has no argon2);
  - the certificate PDF (C2, in progress), the admit card PDF (#45, open) and the C1 web pages;
  - payments' P2: the registration form without a password. It brings the reverse CHECK; exam's demo-user change goes in before or with it;
  - the legal texts: the client's review of #2's drafts;
  - the public site (Phase D): the pages exist with placeholder texts and wait for the design;
  - owner decisions pending: the two age groups instead of the three categories, the brand name, and jury 2FA.
- PayStation: official docs read; summary in `docs/paystation/PAYSTATION-NOTES.md` (the PDF and Postman export stay local, git-ignored).
- The web reads the real session (`apps/web/src/lib/session.ts`). Production dashboards read the API through `apps/web/src/data/http/` (one file per area, all wired); a method without an area file would show the error state. Development uses the mock unless `DATA_SOURCE=http`.
- The local docker stack (project `sirat`, same ports) is shared between sessions (Lead, 2026-10-31): use it only after the lead or the owner says so, with `origin/main` merged first; rebuild only the app services (`$DCD up -d --build --no-deps migrate api worker web nginx`, plain `up -d --build` only when infra/compose changed or the data services are down); announce the start and the end in one line, and run nothing on it after releasing it (RUNBOOK §0).

# 07 — UI migration guide (old Zero Olympiad → new app)

The look of these screens is reused. The code is not (the old app is JavaScript with token handling, Redux persist, MUI/daisyUI and several security bugs). Re-implement each screen in TypeScript using `@sirat/ui` and the tokens.

Old source lives in `reference/zero-olympiad-ui/app/…` (committed). A fuller local copy of the old frontend, including `public/` and without `.env*` or large assets, is `reference/zero-olympiad/` (git-ignored; see its `COPY-NOTES.md`). New home is `apps/web/src/app/…`.

## Mapping

Status as of 2026-10-31 (UI port on the dev-only mock data layer; see "Data layer" below). Branches: student screens `feat/ui-student` (PR to `main`), admin screens `feat/ui-admin` (PR to `feat/ui-student`), student ambassador panel `feat/ui-ambassador` (local, held until the ambassador backend exists).

| Screen | Old file(s) | New file(s) | Status | What to keep | What to change |
|---|---|---|---|---|---|
| Login | `login/page.jsx` | `(auth)/login/page.tsx`, `components/LoginForm.tsx`, `AuthSplitLayout` | **Built, real session** (bn/en, errors by status, safe `next`) | Split panel (dark brand left, form right), icon inputs, "Back to home", forgot link, 15 s timeout + "try again" on slow networks | No token in localStorage/cookie/Redux; call `/api/auth/login`, server sets cookie. Rate-limit feedback from API. i18n |
| Forgot password | `Components/ForgotPasswordModal.js`, `update-password/page.jsx` | `(auth)/forgot-password`, `(auth)/reset-password`, `(auth)/verify-email`, `components/auth/*` | **Built** (token from the `#` fragment, button press only) | Simple email form | No direct Supabase call; own reset token flow; identical response |
| Registration wizard | `registration-full/*` (`Step1_Auth`, `Step2_Auth`, `Step_Payment`, `Step3_Auth`, `page.jsx`) | `(auth)/register/page.tsx`, `components/RegisterForm.tsx` | **Step 1 shell only** | 3-step flow, field set (name, promo code, phone, district, institution, education type, 17 grade levels, email, password), payment step | Step data stored server-side; no `role`; no SDG; category from grade table; register/payment order per HOW-IT-WORKS §1; phone input lib optional |
| Registration closed page | `registration/page.jsx` | `(marketing)/registration-closed` (TODO) | — | Message | Driven by `registration_open` setting |
| Payment result pages | `payment-failed/page.jsx`, `successful-registration/page.jsx` | `(auth)/payment/status` (TODO) | — | Friendly states | Poll our status API; "Check my payment status"; resume/restart |
| Student dashboard shell | `dashboard/layout.js`, `Sidebar/Sidebar.jsx`, `Dashboard/Dashboard.jsx` | `(student)/dashboard/layout.tsx`, `components/student/UserChip.tsx`, `NavShell`, `AppShell` | **Ported** | Navy top bar + dark sidebar, active item with a right accent bar, user chip | Menu filtered on the server (Ambassador link only for role `ambassador`); bn/en switch; no logout until auth lands |
| Student dashboard home | `dashboard/page.jsx` | `(student)/dashboard/page.tsx` | **Ported (mock)** | Welcome hero, current-round card, rules | SDG card and "Continue Courses" dropped; rules rendered from the next exam's config |
| My exams (old "quizzes") | `dashboard/quizzes/page.jsx` | `(student)/dashboard/exam/page.tsx` | **Ported (mock)** | Card grid with a state strip, dates, duration | State (`upcoming/open/in_progress/submitted/closed`) decided by the server clock; no Start button until the exam engine exists |
| Leaderboard (student) | `dashboard/leaderboard/page.jsx` | `(student)/dashboard/leaderboard/page.tsx` | **Ported (mock)** | Table (rank, name, institution/status), round tabs, search | Server-side paging/search on a published snapshot (old loaded 4000 rows); "not published yet" state; no scores, times or emails |
| Leaderboard (public marketing) | `leaderboard/page.jsx` (reads mock `students.json`) | — | Not ported | — | Only if owner wants a public board; same snapshot API, no mock JSON |
| Admin shell | `admin/layout.js`, `admin/components/Sidebar.jsx`, `Header.jsx` | `admin/layout.tsx`, `NavShell`, `AppShell` | **Ported** | Dark sidebar, white top bar, user chip | Nav filtered on the server (admin: 6 links, manager: Dashboard + Leaderboard) |
| Admin dashboard | `admin/page.js`, `adminHome/DashboardHome.jsx`, `ChartStatTable/*` | `admin/page.tsx`, `StatCard`, `@sirat/ui/charts` (`LineChart`, `BarList`) | **Ported (mock)** | Hero with refresh, KPI cards, 45-day registrations trend | Own server-rendered SVG charts (no chart library); SDG curve and donut replaced by category bars and a pipeline |
| Admin users | `admin/user-management/page.jsx`, `Table.jsx`, `RoleEditModal.jsx` | `admin/users/page.tsx`, `components/RouteDialog.tsx`, `DataTable`, `Dialog` | **Ported (mock, read-only)** | Table, role/status badges, search, role filter, detail modal | Server paging/filter; detail dialog by URL (`?user=`); role change/block/delete/add member hidden until audited admin APIs exist (no plaintext temp-password emails, ever) |
| Quiz management | `admin/quiz-management/*` | `admin/exams/page.tsx`, `admin/exams/[id]/page.tsx` | **List + view ported (read-only)** | Card grid, view with correct answers highlighted | Add/edit/publish hidden until the versioned-question API exists; lock after publish, never delete/re-create |
| Exam player | `quiz/page.jsx`, `Components/QuizePageComponents/QuizForm.jsx`, `StartModal.jsx` | `(student)/dashboard/exam/[id]/*` (TODO), `Countdown` | TODO | Rules modal + agree, one-question-at-a-time, violation warnings (if owner enables) | Server attempt + remaining seconds; local autosave; checkpoints; auto-submit sends **current** answers; connection indicator |
| Video evaluation | `admin/video-evaluation/page.jsx` | `admin/jury/*` (TODO) | — | Pending/Evaluated tabs, 10 criteria 0–10 | Judge recorded; history; server totals |
| Mark controller (promotion) | `admin/mark-controller/page.jsx` | `admin/rounds/*` (TODO) | — | Top-N preview | Idempotent, audited, no overwrite |
| Ambassadors | `dashboard/ambassador/page.jsx`, `admin/ambassadors-list` | `(student)/dashboard/ambassador/page.tsx` (branch `feat/ui-ambassador`), `admin/ambassadors/page.tsx` | **Ported (mock)**; student panel held | Code box, referral stats, referral list; admin list | Points/rank/team/tasks (RULEBOOK §19); code assigned by the server (the old "set your own code" input is gone); rank names as badges |
| Certificates | `dashboard/certificates/page.jsx`, `Components/CertificateCard.jsx` | TODO | — | Card list | Server-issued with verification URL; Bangla font handled server-side |
| Invoice | `dashboard/history/page.jsx`, `InvoiceDocument.jsx` | TODO | — | Invoice layout | Real status; server-generated PDF |
| Announcements | `dashboard/announcement`, `admin/announcement` | `(student)/dashboard/announcements/page.tsx`, `admin/announcements/page.tsx` | **Ported (mock, list only)** | Card list (student), table (admin) | Admin create/edit/delete with the API |
| Profile | `dashboard/profile/*` | `(student)/dashboard/profile/page.tsx`, `profile/edit/page.tsx` + `actions.ts`, `components/profile/ProfileForm.tsx` | **Ported (mock)** | View/edit layout | Allow-list Server Action (`data/profile.ts`); option lists from the server; no photo field in the schema yet |
| Marketing pages | `Components/Home2`, `Pricing`, `Timeline`, `JuryCard`, `Supporters`, `app/about|faq|gallery|instruction|contact-us` | `(marketing)/…` | Hero only | Section structure, copy ideas | Server-rendered; one content source; optimized images (old shipped a 17 MB image in an 84 px circle); real sitemap/metadata |

## Data layer (UI port, 2026-10-31)

Pages never fetch on their own. Server Components call `getData()` from `apps/web/src/data`, which returns a `DataSource` (`data/source.ts`). Response types live in `@sirat/shared`: `records.ts` mirrors `schema.prisma` field names and nullability (enforced at compile time and by `data/schema-sync.test.ts`), and `dashboard.ts` is the response contract the API will implement.

- **Development:** the mock source (`data/mock/`, fictional data, never in `public/`). Preview states with `?mock=empty`, `?mock=error`, `?mock=slow`; `?mock=leak` adds canary fields for the leak check.
- **Production:** the `unavailable` source, so every dashboard page shows its polite error state until the API exists. The mock module is not in the bundle: `getData()` gates it behind a literal `NODE_ENV` check and `scripts/assert-no-mock.mjs` fails `next build` if it ever ships.
- **Connecting the API:** add `data/http/` implementing `DataSource` (server-side calls with the session cookie, using the auth team's session helper) and return it from `getData()` in production. Pages do not change.
- **Mutations** go through Server Actions that call the data layer (profile edit today).

| `DataSource` method | Planned endpoint | Guard |
|---|---|---|
| `student.getHome()` | `GET /dashboard/home` (new, to add to `06-API.md`) | Auth |
| `student.getProfile()` | `GET /users/me` | Auth |
| `student.getProfileOptions()` | `GET /content/profile-options` (new) | Public or Auth |
| `student.updateProfile(input)` | `PATCH /users/me` | Auth, allow-list DTO |
| `student.listExams()` | `GET /exams` | Auth |
| `student.listAnnouncements(q)` | `GET /announcements` | Auth |
| `student.getAmbassador()` | `GET /ambassador/me` | Role(ambassador) |
| `leaderboard.get(q)` | `GET /leaderboard?round=&page=&q=` | Auth; 404/403 until published |
| `admin.getStats()` | `GET /admin/stats` | admin/manager |
| `admin.listUsers(q)`, `admin.getUser(id)` | `GET /admin/users`, `GET /admin/users/:id` | admin |
| `admin.getLeaderboard(q)` | `GET /admin/leaderboard` (new) | admin/manager |
| `admin.listExams(q)`, `admin.getExam(id)` | `GET /admin/exams`, `GET /admin/exams/:id` (with questions) | admin |
| `admin.listAmbassadors(q)` | `GET /admin/ambassadors` | admin |
| `admin.listAnnouncements(q)` | `GET /admin/announcements` | admin |

## Checks for the UI

- `pnpm -F web test` (`node --test`, no extra dependencies): schema mirror, mock gate, students-get-no-scores, leak harness, WCAG AA contrast of every tone and every bg+text pair in the code, rank states, profile validation, URL parsing, i18n formatting.
- Every check runs with real sessions: it logs in through the API as a fixture student and an admin (RUNBOOK §0); without a cookie a page must go to `/refresh`.
- `pnpm -F web check:leak` against a dev server on port 3100: every student page is rendered with canary data (scores, times, other people's emails, answer keys) and the HTML, including the inline RSC payload, must contain none of it.
- `pnpm -F web check:prod` against a production server (`next build && next start -p 3100`): every dashboard page, opened in headless Chrome/Edge, shows the shell and a heading (pages that read data show their polite error state, because production has no data source yet), never a blank page or raw error text. Each page is opened with the role that may open it (`src/lib/access.ts`) and must end on the URL asked for; the other area must redirect home and a restricted page must show not found.
- `pnpm -F web check:api-down` against the production server with the API stopped: pages show the error page and stay put, never `/login`.
- `pnpm -F web e2e` against the whole local stack: the session flows in a real browser (refresh, logout, two tabs, reset email); the same CDP driver (`scripts/lib/cdp.mjs`) as the checks.
- Routes are discovered from `src/app` (every `page.tsx` under `/dashboard` and `/admin`); a new dynamic segment needs a sample value in `SAMPLE` in `scripts/check-pages.mjs`.
- CI runs leak, prod and api-down in the `web-pages` job of `.github/workflows/ci.yml` (API on :4000 with its own Postgres and Redis, dev server on :3100, production server on :3101).

## Remaining work (owner decisions, 2026-10-31)

| Item | Plan |
|---|---|
| `<html lang>` | Stays `en` in the static root layout (shared with the auth pages). It follows the locale together with the public pages; dashboard content already carries `lang` on its wrapper. |
| nginx access log | The default `combined` format logs `$request`, so admin search terms (names, emails) in the URL reach the logs. A separate infra commit drops the query string; the UI work does not touch nginx. |
| CI | The `web-pages` job runs `check:leak`, `check:prod` and `check:api-down` with real sessions. Make it a required check once branch protection is available (OPEN-QUESTIONS #25). |
| Unknown exam id | `/admin/exams/:id` calls `notFound()` and shows the translated not-found card with `noindex`, but answers HTTP 200: the `loading.tsx` boundaries above it start the stream first (Next 16 `loading.md`, "Status codes"). The skeletons stay; a real 404 needs a Proxy check once the exams API exists. |
| HTTP data source | `data/http/` implementing `DataSource`, calling the API server-side with the session cookie (`lib/server-api.ts`, as `lib/session.ts` does for `/auth/me`). The route guards are in place (`requireAccess`, `lib/access.ts`). |
| API contract | Add `GET /dashboard/home`, `GET /content/profile-options` and `GET /admin/leaderboard` to `06-API.md`; decide the leaderboard tie rule (the mock shares a rank: 1, 2, 2, 4). |
| Later screens | Exam player, results/review, certificates, payment history, video submission, jury evaluation, promotion, admin create/edit flows, the ambassador panel (branch `feat/ui-ambassador`). |

## Old components → shared components

| Old | New (`packages/ui`) |
|---|---|
| `admin/components/StatCard.jsx` | `StatCard` |
| `admin/components/Table.jsx`, leaderboard tables | `DataTable` |
| manual prev/next in leaderboard | `LinkPagination` (server paging via `?page=`), `Pagination` (callback) |
| round switcher ("ROUND 1 / 2 / 3"), role filters | `Tabs` (links) |
| search inputs | `SearchBox` (GET form, server search) |
| avatar images, ui-avatars | `Avatar` (initials) |
| user detail / role modals | `Dialog` (+ `RouteDialog` in the web app) |
| profile info tiles | `DetailList` |
| recharts line/bar/donut | `@sirat/ui/charts`: `LineChart`, `BarList` |
| login page frame | `AuthSplitLayout` |
| `Sidebar.jsx` (both) | `AppShell` + `NavShell` |
| `Components/CountdownTimer` | `Countdown` (display-only, server seconds) |
| `Components/Fallbacks`, `FullPageLoader`, `admin/components/loadign.jsx` | `Skeleton`, `Spinner`, `EmptyState`, `ErrorState` |
| ad-hoc buttons (`.btn-primary`, `.btn-Secondary`, `.bg-btn` in `globals.css`) | `Button` (variants), `buttonClasses()` for links |
| inline styled inputs | `Field`, `SelectField` |
| badges via inline classes | `Badge` (tones in `tones.ts`, all WCAG AA) |

## How to port a screen (procedure for Claude Code)

1. Open the old file under `reference/` and read it for **layout and states**, not logic.
2. Check `docs/04-FEATURES.md` and `docs/06-API.md` for the rules that apply.
3. Compose with `@sirat/ui` components and token classes (`bg-primary`, `text-ink-muted`, …). No hex values in components. Text uses the `-strong` colour variants (or ink/secondary); base colours are for icons and large accents.
4. Server Component by default; `'use client'` only for interaction. Data via `getData()` from `@/data`; mutations via Server Actions that call the data layer. No browser storage, no client-side fetching.
5. Handle loading, empty and error states (`loading.tsx` + `PageSkeleton`, `error.tsx` + `RouteError`, `EmptyState`). Mobile-first. All text through a typed message module in `src/i18n/messages/` (bn + en).
6. Add the port to this table (status column) and note decisions in `DECISIONS.md`.

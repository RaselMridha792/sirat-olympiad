# 07 — UI migration guide (old Zero Olympiad → new app)

The look of these screens is reused. The code is not (the old app is JavaScript with token handling, Redux persist, MUI/daisyUI and several security bugs). Re-implement each screen in TypeScript using `@sirat/ui` and the tokens.

Old source lives in `reference/zero-olympiad-ui/app/…` (committed). A fuller local copy of the old frontend, including `public/` and without `.env*` or large assets, is `reference/zero-olympiad/` (git-ignored; see its `COPY-NOTES.md`). New home is `apps/web/src/app/…`.

## Mapping

Status as of 2026-10-31 (UI port on the dev-only mock data layer; see "Data layer" below). Branches: student screens `feat/ui-student` (PR to `main`), admin screens `feat/ui-admin` (PR to `feat/ui-student`), student ambassador panel `feat/ui-ambassador` (merged into core C5a on 2026-11-01).

| Screen | Old file(s) | New file(s) | Status | What to keep | What to change |
|---|---|---|---|---|---|
| Login | `login/page.jsx` | `(auth)/login/page.tsx`, `components/LoginForm.tsx`, `AuthSplitLayout` | **Built, real session** (bn/en, errors by status, safe `next`) | Split panel (dark brand left, form right), icon inputs, "Back to home", forgot link, 15 s timeout + "try again" on slow networks | No token in localStorage/cookie/Redux; call `/api/auth/login`, server sets cookie. Rate-limit feedback from API. i18n |
| Forgot password | `Components/ForgotPasswordModal.js`, `update-password/page.jsx` | `(auth)/forgot-password`, `(auth)/reset-password`, `(auth)/verify-email`, `components/auth/*` | **Built** (token from the `#` fragment, button press only) | Simple email form | No direct Supabase call; own reset token flow; identical response |
| Registration wizard | `registration-full/*` (`Step1_Auth`, `Step2_Auth`, `Step_Payment`, `Step3_Auth`, `page.jsx`) | `(auth)/register/page.tsx`, `components/registration/RegisterWizard.tsx` | **Built, real API** (payments PR 4) | 3 steps (about you, your school, check and pay), then PayStation; bn/en; the owner's duplicate texts next to the field; resume, retry or start over for this browser's earlier attempt | Nothing stored in the browser (the form goes once to `POST /registrations/start`, kept server-side); `method="post"` and submit disabled until hydrated; no `role`; category from the grade table on the server; e2e `pnpm --filter @sirat/web e2e:register` (fake PayStation) |
| Registration closed page | `registration/page.jsx` | `(auth)/register/page.tsx` (closed state) | **Built** (payments PR 4) | Message, with the opening time when one is set | Driven by `GET /registrations/info` (`open`: the switch, the window, a valid fee and PayStation configured) |
| Payment result pages | `payment-failed/page.jsx`, `successful-registration/page.jsx` | `(auth)/register/result/page.tsx`, `components/registration/PaymentResult.tsx` | **Built, real API** (payments PR 4) | One page for every state (waiting, confirming, registered, failed, expired, needs help) | The API's callback 303s here with nothing in the URL; polls `GET /registrations/current` 2 s → 10 s for 2 minutes, then "Check my payment status" (recheck); continue, try again or start over |
| Free book (student) | — (new, owner 2026-10-31) | `(student)/dashboard/book/page.tsx`, `components/book/BookOrderForm.tsx`, `components/book/BookOrderCard.tsx` | **Built, real API** (payments PR 6b) | The cover and title; the delivery address, pre-filled; confirmed / change / shipped; a dashboard card core's home composes | The result page's "Log in to get your free book" → `/login?next=/dashboard/book`; the version always sent (no silent overwrite) |
| Student dashboard shell | `dashboard/layout.js`, `Sidebar/Sidebar.jsx`, `Dashboard/Dashboard.jsx` | `(student)/dashboard/layout.tsx`, `components/student/UserChip.tsx`, `NavShell`, `AppShell` | **Ported** | Navy top bar + dark sidebar, active item with a right accent bar, user chip | Menu filtered on the server (Ambassador link only for role `ambassador`); bn/en switch; no logout until auth lands |
| Student dashboard home | `dashboard/page.jsx` | `(student)/dashboard/page.tsx` | **Built, real API** (core C4; composed from `/users/me`, `/exams`, `/exams/:id`, `/announcements`, `/registrations/me`) | Welcome hero, current-round card, rules | SDG card and "Continue Courses" dropped; rules rendered from the next exam's config |
| My exams (old "quizzes") | `dashboard/quizzes/page.jsx` | `(student)/dashboard/exam/page.tsx` | **Ported (real API)** | Card grid with a state strip, dates, duration | State (`upcoming/open/in_progress/submitted/closed`) decided by the server clock; each card links to its room: Waiting room, Start, Continue, Receipt (E4) |
| Leaderboard (student) | `dashboard/leaderboard/page.jsx` | `(student)/dashboard/leaderboard/page.tsx` | **Ported (real API, E5a)** | Table (rank, name, institution/status), tabs, search | One board per exam: tabs are the student's own exams with published results (newest first); server-side paging/search on the snapshot (old loaded 4000 rows); "not published yet" state; no scores, times or emails |
| Exam review (new) | — | `(student)/dashboard/exam/[id]/review/page.tsx` | **New (real API, E5a)** | Option cards as in the player, correct option green, a wrong choice red | Own score, rank and time; each question with the student's answer, the correct option and the explanation; only after the results are published |
| Leaderboard (public marketing) | `leaderboard/page.jsx` (reads mock `students.json`) | — | Not ported | — | Only if owner wants a public board; same snapshot API, no mock JSON |
| Admin shell | `admin/layout.js`, `admin/components/Sidebar.jsx`, `Header.jsx` | `admin/layout.tsx`, `NavShell`, `AppShell` | **Ported** | Dark sidebar, white top bar, user chip | Nav filtered on the server (admin: 6 links, manager: Dashboard + Leaderboard) |
| Admin dashboard | `admin/page.js`, `adminHome/DashboardHome.jsx`, `ChartStatTable/*` | `admin/page.tsx`, `StatCard`, `@sirat/ui/charts` (`LineChart`, `BarList`) | **Ported (mock)** | Hero with refresh, KPI cards, 45-day registrations trend | Own server-rendered SVG charts (no chart library); SDG curve and donut replaced by category bars and a pipeline |
| Admin users | `admin/user-management/page.jsx`, `Table.jsx`, `RoleEditModal.jsx` | `admin/users/page.tsx`, `components/RouteDialog.tsx`, `components/admin/ExportUsersButton.tsx`, `DataTable`, `Dialog` | **Built, real API** (core C1, read-only) | Table, role/status badges, search, role filter, detail modal | Server paging, search (name, email, phone, invoice) and filters (category, registration, email verified); registration/payment and email-verified columns; phone masked in the list (last 3 digits), full in the detail; CSV export with a reason (audited). Role change/block/delete/add member hidden until audited admin APIs exist (no plaintext temp-password emails, ever) |
| Admin payments and settings | — (the old admin had none; refunds were an unauthenticated API) | `admin/payments/page.tsx`, `admin/settings/page.tsx`, `components/admin/payments/*` | **Built, real API** (payments PR 4; admin only) | Payments: look up by invoice, trx_id, mobile, email, status or "needs review"; a detail dialog with the history, "ask PayStation again" and, for a success without a trx_id only, the manual reconcile. Settings: open/close registration and the fee dialog (৳old → ৳new, a reason, `expected`) | No refund action (owner: no refund handling); RUNBOOK §11 says what to do with each review reason |
| Free book (admin) | — | `admin/book/page.tsx`, `admin/book-orders/page.tsx`, `components/admin/book/*` | **Built, real API** (payments PR 6b; admin only) | Title (with a reason), cover upload with a preview; orders: search, "Export for courier" (CSV), "Mark shipped" for ticked rows after a confirmation | Addresses only for admins; the CSV is audited; a shipped order cannot change (RUNBOOK §11) |
| Quiz management | `admin/quiz-management/*` | `admin/exams/page.tsx`, `admin/exams/new/page.tsx`, `admin/exams/[id]/page.tsx`, `admin/exams/[id]/edit/page.tsx` | **Real API: list, view, results and attempts (E5a), authoring (E5b)** | Card grid, view with correct answers highlighted | Results panel (counts, snapshot, build/publish/unpublish) and attempts with violations, filters and an events dialog (owner Q4). E5b: "New exam" and "Edit settings" (one form, Bangladesh time, frozen fields read-only after publishing, a later close with a reason), publish/unpublish/archive dialogs listing every refused check, and the question dialog (2–6 options lettered by place, the correct one marked, explanation, keep order; a published edit saves version n+1; delete in a draft, retire with a random draw). Lock after publish, never delete/re-create. Rounds have no API yet: no round field |
| Exam player | `quiz/page.jsx`, `Components/QuizePageComponents/QuizForm.jsx`, `QuizQuestion.jsx`, `StartModal.jsx`, `FinalSubmitModal.jsx`, `TimeUpModal.jsx` | `(student)/dashboard/exam/[id]/page.tsx`, `components/exam/ExamRoom.tsx`, `Countdown` | **Ported (real API, E4)** | Rules dialog + agree, one question at a time with a progress bar, option cards with letter boxes, sticky timer bar, blurred grey exam behind a warning | Server attempt + remaining seconds; local copy at once; checkpoints every 60–120 s; time-up and the 6th violation submit the **current** answers; connection badge; honest rules text (no "AI detection"); question palette added; time-up is an inline "submitting" card, then the receipt |
| Video evaluation | `admin/video-evaluation/page.jsx` | `admin/jury/*` (TODO) | — | Pending/Evaluated tabs, 10 criteria 0–10 | Judge recorded; history; server totals |
| Mark controller (promotion) | `admin/mark-controller/page.jsx` | `admin/rounds/*` (TODO) | — | Top-N preview | Idempotent, audited, no overwrite |
| Ambassadors | `dashboard/ambassador/page.jsx`, `admin/ambassadors-list` | `(student)/dashboard/ambassador/page.tsx`, `admin/ambassadors/page.tsx`, `components/admin/AmbassadorButton.tsx` | **Built, real API** (core C5a) | Code box, referral stats, referral list; admin list | Code assigned by the server (the old "set your own code" input is gone); an admin makes a paid student an ambassador, or revokes, with a reason (audited); referrals without contact details; points and rank from the ledger, rank names as badges; team and tasks empty until C5b (RULEBOOK §19) |
| Certificates | `dashboard/certificates/page.jsx`, `Components/CertificateCard.jsx` | TODO | — | Card list | Server-issued with verification URL; Bangla font handled server-side |
| Invoice | `dashboard/history/page.jsx`, `InvoiceDocument.jsx` | TODO | — | Invoice layout | Real status; server-generated PDF |
| Announcements | `dashboard/announcement`, `admin/announcement` | `(student)/dashboard/announcements/page.tsx`, `admin/announcements/page.tsx`, `components/admin/AnnouncementEditor.tsx`, `AnnouncementStateButton.tsx`, `TextAreaField` | **Built, real API** (core C4) | Card list (student), table (admin) | Admins write, edit, schedule, archive and restore (never delete) from the browser through `lib/api.ts`, with the version they saw; status tabs; for everyone or one category; plain text with line breaks |
| Profile | `dashboard/profile/*` | `(student)/dashboard/profile/page.tsx`, `profile/edit/page.tsx`, `components/profile/ProfileForm.tsx` | **Built, real API** (core C3) | View/edit layout | Saved from the browser through `lib/api.ts` (`PATCH /users/me`); name, phone, district (one of 64), institution, education type; the grade is read only (an admin corrects it); the owner's phone message; option lists from the server; no photo field in the schema yet |
| Marketing pages | `Components/Home2`, `Pricing`, `Timeline`, `JuryCard`, `Supporters`, `app/about|faq|gallery|instruction|contact-us` | `(marketing)/…`, `components/public/*`, `content/site.ts`, `i18n/messages/legal.ts`, `Prose` | **Entry, about, privacy, terms, refund policy built** (core C2; en at `/`, bn under `/bn`; placeholder texts, `noindex` until the client's texts arrive). The rest is Phase D | Section structure, copy ideas | Server-rendered; one content source; optimized images (old shipped a 17 MB image in an 84 px circle); real sitemap/metadata |

## Data layer (UI port, 2026-10-31)

Pages never fetch on their own. Server Components call `getData()` from `apps/web/src/data`, which returns a `DataSource` (`data/source.ts`). Response types live in `@sirat/shared`: `records.ts` mirrors `schema.prisma` field names and nullability (enforced at compile time and by `data/schema-sync.test.ts`), and `dashboard.ts` is the response contract the API will implement.

- **Development:** the mock source (`data/mock/`, fictional data, never in `public/`). Preview states with `?mock=empty`, `?mock=error`, `?mock=slow`; `?mock=leak` adds canary fields for the leak check.
- **Production:** the HTTP source (`data/http/`): server-side reads from the API, one file per area. A method no area file implements yet falls back to `unavailable`, so its page shows its polite error state. The mock module is not in the bundle: `getData()` gates it behind a literal `NODE_ENV` check and `scripts/assert-no-mock.mjs` fails `next build` if it ever ships.
- **Connecting a method:** add or extend its area file in `data/http/` and spread it into `createHttpSource` (DECISIONS "Web data layer over HTTP"). Pages do not change. `DATA_SOURCE=http pnpm dev:web` uses it in development, against `pnpm dev:api`.
- **Writes** go from the browser through `lib/api.ts`, never through the web server (DECISIONS "Web data layer over HTTP"). The profile edit's Server Action (mock only) moves to that pattern with its API (core plan C3).

| `DataSource` method | Planned endpoint | Guard |
|---|---|---|
| `student.getHome()` | `GET /dashboard/home` (new, to add to `06-API.md`) | Auth |
| `student.getProfile()` | `GET /users/me` | Auth |
| `student.getProfileOptions()` | `GET /content/profile-options` (new) | Public or Auth |
| `student.updateProfile(input)` | `PATCH /users/me` | Auth, allow-list DTO |
| `student.listExams()` | `GET /exams` (with `resultsPublished`) | Auth |
| `student.getExam(id)` | `GET /exams/:id` (the waiting room; the own attempt's id) | Auth |
| `student.getReview(attemptId)` | `GET /attempts/:id/review` | Own attempt; 403 until published |
| `student.listAnnouncements(q)` | `GET /announcements` | Auth |
| `student.getAmbassador()` | `GET /ambassador/me` | Role(ambassador) |
| `leaderboard.get(q)` | `GET /leaderboard?exam=&page=&q=` | Auth; empty and `unpublished` until published |
| `admin.getStats()` | `GET /admin/stats` | admin/manager |
| `admin.listUsers(q)`, `admin.getUser(id)` | `GET /admin/users`, `GET /admin/users/:id` | admin |
| `admin.getLeaderboard(q)` | `GET /admin/leaderboard?exam=&page=&q=` | admin/manager |
| `admin.listExams(q)`, `admin.getExam(id)` | `GET /admin/exams`, `GET /admin/exams/:id` (with questions and the `updatedAt` token) | admin |
| `admin.getExamResults(id)`, `admin.listAttempts(id, q)`, `admin.getAttempt(id, attemptId)` | `GET /admin/exams/:id/results`, `/attempts`, `/attempts/:attemptId` | admin |
| `admin.listAmbassadors(q)` | `GET /admin/ambassadors` | admin |
| `admin.listAnnouncements(q)` | `GET /admin/announcements` | admin |

## Checks for the UI

- `pnpm -F web test` (`node --test`, no extra dependencies): schema mirror, mock gate, students-get-no-scores, leak harness, WCAG AA contrast of every tone and every bg+text pair in the code, rank states, profile validation, URL parsing, i18n formatting.
- Sessions are real (RUNBOOK §0): `check:prod` logs in through the API as a fixture student and an admin, `check:leak` as the student; both check that a page without a cookie goes to `/refresh`. `check:api-down` uses a dummy cookie with the API stopped.
- `pnpm -F web check:leak` against a dev server on port 3100: every student page is rendered with canary data (scores, times, other people's emails, answer keys) and the HTML, including the inline RSC payload, must contain none of it. Pages only an ambassador may open are checked with an ambassador's session (`CHECK_AMBASSADOR_*`; CI approves a fixture student through the API).
- `pnpm -F web check:prod` against a production server (`next build && API_INTERNAL_URL=http://localhost:4000 next start -p 3100`, with the API on :4000): every dashboard page, opened in headless Chrome/Edge, shows the shell and a heading (a page whose method has no area file in `data/http/` yet shows its polite error state), never a blank page or raw error text. Each page is opened with the role that may open it (`src/lib/access.ts`) and must end on the URL asked for; the other area must redirect home and a restricted page must show not found.
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
| HTTP data source | **Skeleton built** (`data/http/`, DECISIONS "Web data layer over HTTP"): `student.listExams` reads `GET /exams`; every other method is connected by the team that builds its API. The route guards are in place (`requireAccess`, `lib/access.ts`). |
| API contract | Add `GET /dashboard/home`, `GET /content/profile-options` and `GET /admin/leaderboard` to `06-API.md`; decide the leaderboard tie rule (the mock shares a rank: 1, 2, 2, 4). |
| Later screens | Certificates, payment history, video submission, jury evaluation, promotion, admin create/edit flows, ambassador tasks and teams (core C5b). |

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

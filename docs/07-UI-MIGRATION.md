# 07 — UI migration guide (old Zero Olympiad → new app)

The look of these screens is reused. The code is not (the old app is JavaScript with token handling, Redux persist, MUI/daisyUI and several security bugs). Re-implement each screen in TypeScript using `@sirat/ui` and the tokens.

Old source lives in `reference/zero-olympiad-ui/app/…`. New home is `apps/web/src/app/…`.

## Mapping

| Screen | Old file(s) | New file(s) | Status in scaffold | What to keep | What to change |
|---|---|---|---|---|---|
| Login | `login/page.jsx` | `(auth)/login/page.tsx`, `components/LoginForm.tsx`, `AuthSplitLayout` | **Built (layout + form)** | Split panel (dark brand left, form right), icon inputs, "Back to home", forgot link, 15 s timeout + "try again" on slow networks | No token in localStorage/cookie/Redux; call `/api/auth/login`, server sets cookie. Rate-limit feedback from API. i18n |
| Forgot password | `Components/ForgotPasswordModal.js`, `update-password/page.jsx` | `(auth)/forgot-password/page.tsx` (+ reset page TODO) | Form shell | Simple email form | No direct Supabase call; own reset token flow; identical response |
| Registration wizard | `registration-full/*` (`Step1_Auth`, `Step2_Auth`, `Step_Payment`, `Step3_Auth`, `page.jsx`) | `(auth)/register/page.tsx`, `components/RegisterForm.tsx` | **Step 1 shell only** | 3-step flow, field set (name, promo code, phone, district, institution, education type, 17 grade levels, email, password), payment step | Step data stored server-side; no `role`; no SDG; category from grade table; register/payment order per HOW-IT-WORKS §1; phone input lib optional |
| Registration closed page | `registration/page.jsx` | `(marketing)/registration-closed` (TODO) | — | Message | Driven by `registration_open` setting |
| Payment result pages | `payment-failed/page.jsx`, `successful-registration/page.jsx` | `(auth)/payment/status` (TODO) | — | Friendly states | Poll our status API; "Check my payment status"; resume/restart |
| Student dashboard shell | `dashboard/layout.js`, `dashboard/Sidebar/Sidebar.jsx` | `(student)/dashboard/layout.tsx`, `NavShell`, `AppShell` | **Built** | Dark `#0f172a` sidebar, rounded active item, role-filtered menu | Menu filtered on the server; sidebar only hides, API enforces |
| Student dashboard home | `dashboard/page.jsx` | `(student)/dashboard/page.tsx` | Shell | Welcome banner, current-round card, rules | No SDG topic; content from config; round card from API |
| Leaderboard (student) | `dashboard/leaderboard/page.jsx` | `(student)/dashboard/leaderboard/page.tsx`, `DataTable`, `Pagination` | **Built (mock data)** | Table (rank, name, institution/status), round tabs, search | **Server-side** paging/search (old loaded 4000 rows); snapshot after window closes; real status labels |
| Leaderboard (public marketing) | `leaderboard/page.jsx` (reads mock `students.json`) | — | Not ported | — | Only if owner wants a public board; same snapshot API, no mock JSON |
| Admin shell | `admin/layout.js`, `admin/components/Sidebar.jsx` | `admin/layout.tsx`, `NavShell`, `AppShell` | **Built** | Sidebar + user footer | Role gating server-side; no mismatch between sidebar and layout |
| Admin dashboard | `admin/page.js`, `adminHome/DashboardHome.jsx`, `ChartStatTable/*` | `admin/page.tsx`, `StatCard` | **KPI cards built; charts TODO** | KPI cards, 45-day trend line, category/ambassador charts | Cached aggregates; pick ONE chart lib (lazy); drop SDG chart |
| Admin users | `admin/user-management/page.jsx`, `Table.jsx`, `RoleEditModal.jsx` | `admin/users/page.tsx`, `DataTable` | **Built (mock)** | Table, role badge, status badge, edit-role modal | Server paging/filter; no plaintext temp-password emails (invite link instead); audited role change |
| Quiz management | `admin/quiz-management/*` | `admin/exams/*` (TODO) | Placeholder | List/search/publish, add/edit forms, view with answers highlighted | Lock after publish, version questions; no delete/re-create |
| Exam player | `quiz/page.jsx`, `Components/QuizePageComponents/QuizForm.jsx`, `StartModal.jsx` | `(student)/dashboard/exam/*` (TODO), `Countdown` | Waiting-room shell | Rules modal + agree, one-question-at-a-time, violation warnings (if owner enables) | Server attempt + remaining seconds; local autosave; checkpoints; auto-submit sends **current** answers; connection indicator |
| Video evaluation | `admin/video-evaluation/page.jsx` | `admin/jury/*` (TODO) | — | Pending/Evaluated tabs, 10 criteria 0–10 | Judge recorded; history; server totals |
| Mark controller (promotion) | `admin/mark-controller/page.jsx` | `admin/rounds/*` (TODO) | — | Top-N preview | Idempotent, audited, no overwrite |
| Ambassadors | `dashboard/ambassador/page.jsx`, `admin/ambassadors-list` | `(student)/dashboard/ambassador/page.tsx` | Shell with stat cards | Code + referral list | Points/rank/team/tasks (new scope, RULEBOOK §19) |
| Certificates | `dashboard/certificates/page.jsx`, `Components/CertificateCard.jsx` | TODO | — | Card list | Server-issued with verification URL; Bangla font handled server-side |
| Invoice | `dashboard/history/page.jsx`, `InvoiceDocument.jsx` | TODO | — | Invoice layout | Real status; server-generated PDF |
| Announcements | `dashboard/announcement`, `admin/announcement` | TODO | — | List + CRUD | |
| Profile | `dashboard/profile/*` | `(student)/dashboard/profile/page.tsx` | Shell | View/edit layout, photo | Allow-list DTO; photo via server-controlled upload; compress client-side |
| Marketing pages | `Components/Home2`, `Pricing`, `Timeline`, `JuryCard`, `Supporters`, `app/about|faq|gallery|instruction|contact-us` | `(marketing)/…` | Hero only | Section structure, copy ideas | Server-rendered; one content source; optimized images (old shipped a 17 MB image in an 84 px circle); real sitemap/metadata |

## Old components → shared components

| Old | New (`packages/ui`) |
|---|---|
| `admin/components/StatCard.jsx` | `StatCard` |
| `admin/components/Table.jsx`, leaderboard tables | `DataTable` |
| manual prev/next in leaderboard | `Pagination` |
| login page frame | `AuthSplitLayout` |
| `Sidebar.jsx` (both) | `AppShell` + `NavShell` |
| `Components/CountdownTimer` | `Countdown` (display-only, server seconds) |
| `Components/Fallbacks`, `FullPageLoader` | `Spinner`, `EmptyState`, `ErrorState` |
| ad-hoc buttons (`.btn-primary`, `.btn-Secondary`, `.bg-btn` in `globals.css`) | `Button` (variants) |
| inline styled inputs | `Field` |
| badges via inline classes | `Badge` |

## How to port a screen (procedure for Claude Code)

1. Open the old file under `reference/` and read it for **layout and states**, not logic.
2. Check `docs/04-FEATURES.md` and `docs/06-API.md` for the rules that apply.
3. Compose with `@sirat/ui` components and token classes (`bg-primary`, `text-ink-muted`, …). No hex values in components.
4. Server Component by default; `'use client'` only for interaction. Data via `lib/api.ts` (cookies, no tokens).
5. Handle loading, empty and error states. Mobile-first.
6. Add the port to this table (status column) and note decisions in `DECISIONS.md`.

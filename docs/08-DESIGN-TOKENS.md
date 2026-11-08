# 08 — Design tokens and component rules

Single source: `packages/ui/src/styles/tokens.css` (Tailwind v4 `@theme`). Never hardcode hex in components. Change a color there once.

## Colors (carried over from Zero Olympiad)

| Token (utility) | Hex | Use |
|---|---|---|
| `primary` | `#E3621C` | Brand orange: primary buttons, active accents, highlights (old `--color-Primary`) |
| `primary-hover` / `primary-soft` | `#C95416` / `#FDEEE5` | Hover, soft backgrounds (icon tiles, badges) |
| `secondary` | `#083E5F` | Brand navy: secondary buttons, links (old `--color-Secondary`) |
| `secondary-hover` / `secondary-soft` | `#062F48` / `#E6EFF5` | |
| `shell` / `shell-soft` | `#0F172A` / `#1E293B` | Sidebar + auth brand panel (old dashboards used `#0f172a`) |
| `page` | `#F8FAFC` | App background |
| `surface` | `#FFFFFF` | Cards |
| `line` | `#E2E8F0` | Borders, dividers |
| `ink` / `ink-muted` / `ink-faint` | `#0F172A` / `#64748B` / `#94A3B8` | Text levels |
| `success` / `warning` / `danger` / `info` (+ `-soft`) | `#10B981` / `#F59E0B` / `#EF4444` / `#2563EB` | Status |
| `rank-bronze` / `-silver` / `-gold` | `#B45309` / `#94A3B8` / `#F59E0B` | Ambassador tiers |

Old code also used `#4F46E5` indigo and `#5B2EFF` violet in places (leaderboard, charts). They are intentionally **not** tokens; unify on primary/secondary unless the designer says otherwise.

## Typography

`--font-sans`: Inter Variable → Noto Sans Bengali Variable → system. Both self-hosted via fontsource (no Google Fonts request). `--font-arabic` (`font-arabic`): system Arabic fonts only, for the honorific ﷺ through `<Honorific>` (owner, 2026-11-03: no font package). Bangla public pages use `leading-[1.7]` for body text and `leading-snug` or more for headings, never `tracking-tight` on Bangla. Page titles `text-2xl/3xl font-extrabold`, labels `text-sm font-semibold`, table headers `text-xs uppercase tracking-wider text-ink-faint`.

## Shape and elevation

`--radius-card: 1rem` (`rounded-card`), `--radius-control: 0.75rem` (`rounded-control`), `--shadow-card`. Auth frame uses `rounded-3xl` + `shadow-2xl`.

## Shared components (`@sirat/ui`)

`Button` (primary|secondary|outline|ghost|danger, sm|md|lg, `loading`) · `Card` · `StatCard` · `Badge` (neutral|success|warning|danger|info|brand) · `Field` (label + icon + error, `aria-invalid`) · `DataTable` (presentational; paging is server-side) · `Pagination` · `EmptyState` / `Spinner` / `ErrorState` · `PageHeader` · `AuthSplitLayout` · `AppShell` (sidebar + content; app passes `renderLink`) · `Countdown` (display-only) · `Prose` · for public pages: `Section` (page, surface, tint and shell bands), `Timeline` (dates, steps), `Accordion` (`details`/`summary`), `BigStats`, `StarMark` / `GeometricPattern` / `StarOrnament` (inline SVG geometry in `currentColor`), `Honorific` / `WithHonorific`.

## Motion

`--animate-rise` (`animate-rise`). Every animation or transition sits behind `motion-safe:` (prefers-reduced-motion). Ornaments are geometry, never figures: no person, and never the Prophet ﷺ or any prophet.

## Rules

1. New shared component → `packages/ui/src/components`, export in `index.ts`, tokens only.
2. Icons are passed as nodes (ui package has no icon dependency); the apps use `lucide-react`.
3. Mobile-first; sidebar collapses under `xl`; tables scroll horizontally.
4. Every screen has loading, empty and error states. No raw error text from the server.
5. Accessibility: labels tied to inputs, visible focus, `aria-live` for status, sufficient contrast (verify `primary` on white for small text; use `secondary` for text links).
6. Tailwind must scan the UI package: `apps/web/src/app/globals.css` has `@source '../../../../packages/ui/src'`. Keep it.
7. Dark mode: not in scope yet.

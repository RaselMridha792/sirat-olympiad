# 08 — Design tokens and component rules

Single source: `packages/ui/src/styles/tokens.css` (Tailwind v4 `@theme`). Change a colour there once. `apps/web/src/design/no-raw-colours.test.ts` fails on any hex, rgb/hsl/oklch/color-mix literal, default palette class (`bg-orange-500`, `text-emerald-700`, …) or brand scale class (`bg-green-600`, `text-gold-50`) anywhere else in `apps/web/src` and `packages/ui/src`. Components use the semantic names below only.

## Colours: the client's Sirat Olympiad brand (owner, 2026-11-08)

The brand is the client's green and gold. The scales come from the client's old site (`theme-color #007a48`), **to confirm** with the client; until then the site is built on them. The scales are declared in tokens.css only (`--color-green-50…950`, `--color-gold-50…800`), and the semantic tokens refer to them (`--color-primary: var(--color-green-600)`), so swapping the client's palette is an edit of the scales only. The contrast test resolves those references and checks the result.

| Token (utility) | Scale | Hex | Use |
|---|---|---|---|
| `primary` | green-600 | `#007A48` | Brand green: buttons, active accents, icons on light surfaces. White on it is 5.4:1 |
| `primary-hover` / `primary-soft` | green-700 / green-50 | `#00623B` / `#EAF6F0` | Hover; soft backgrounds (icon tiles, badges) |
| `primary-strong` / `primary-strong-hover` | green-700 / green-800 | `#00623B` / `#044E31` | Green text on white, filled buttons (7.4:1) |
| `secondary` | green-800 | `#044E31` | Links, dark cards (white text) |
| `secondary-hover` / `secondary-soft` | green-900 / green-100 | `#06402A` / `#D0EBE0` | |
| `accent` | gold-500 | `#ED9D19` | Brand gold: highlights, icons, rules. On the deep-green shell also text (kickers, dates, the active menu item), 8.1:1. **Never text on white**; on a gold fill, text is `ink` (8:1) |
| `accent-hover` / `accent-soft` | gold-600 / gold-50 | `#D2820F` / `#FEF8EC` | Hover of a gold fill; soft gold backgrounds |
| `accent-strong` | gold-800 | `#8A5A05` | Gold text on white or `accent-soft` (5.9:1) |
| `shell` / `shell-soft` | green-950 / green-900 | `#021C12` / `#06402A` | Headers, heroes, the dashboard sidebar and the auth brand panel. White on it is about 18:1. Green `primary` on it is only 3.3:1, so text and small icons on the shell use `accent` |
| `page` | | `#F8FAFC` | App background (neutrals stay slate; the client's warm greys are an open option) |
| `surface` | | `#FFFFFF` | Cards |
| `line` | | `#E2E8F0` | Borders, dividers |
| `ink` / `ink-muted` / `ink-faint` | | `#0F172A` / `#475569` / `#64748B` | Text levels |
| `success` / `warning` / `danger` / `info` (+ `-soft`, `-strong`) | | `#10B981` / `#F59E0B` / `#EF4444` / `#2563EB` | Status |
| `rank-bronze` / `-silver` / `-gold` | | `#B45309` / `#94A3B8` / `#F59E0B` | Ambassador tiers |

The contrast test (`apps/web/src/design/contrast.test.ts`) checks every brand pair above at WCAG AA (gold icons on the dark-green cards at 3:1, as non-text). The orange `#E3621C` and navy `#083E5F` of the first UI port are retired.

## Typography

`--font-sans`: Inter Variable → Noto Sans Bengali Variable → system. Both self-hosted via fontsource (no Google Fonts request). `--font-system` (`font-system`): a language's own name in a language switch ("বাংলা" on an English page), so English pages do not download the Bangla web font. `--font-arabic` (`font-arabic`): system Arabic fonts only, for the honorific ﷺ through `<Honorific>` (owner, 2026-11-03: no font package). Bangla public pages use `leading-[1.7]` for body text and `leading-snug` or more for headings, never `tracking-tight` on Bangla. Page titles `text-2xl/3xl font-extrabold`, labels `text-sm font-semibold`, table headers `text-xs uppercase tracking-wider text-ink-faint`.

## Shape and elevation

`--radius-card: 1rem` (`rounded-card`), `--radius-control: 0.75rem` (`rounded-control`), `--shadow-card`. Auth frame uses `rounded-3xl` + `shadow-2xl`.

## Shared components (`@sirat/ui`)

`Button` (primary|secondary|outline|ghost|danger, sm|md|lg, `loading`) · `Card` · `StatCard` · `Badge` (neutral|success|warning|danger|info|brand) · `Field` (label + icon + error, `aria-invalid`) · `DataTable` (presentational; paging is server-side) · `Pagination` · `EmptyState` / `Spinner` / `ErrorState` · `PageHeader` · `AuthSplitLayout` · `AppShell` (sidebar + content; app passes `renderLink`) · `Countdown` (display-only) · `Prose` · `SkipLink` (the first Tab stop of every page frame, to `main#main`) · for public pages: `Section` (page, surface, tint and shell bands), `Timeline` (dates, steps), `Accordion` (`details`/`summary`), `BigStats`, `StarMark` / `GeometricPattern` / `StarOrnament` (inline SVG geometry in `currentColor`), `Honorific` / `WithHonorific`.

## Motion

`--animate-rise` (`animate-rise`). Every animation or transition sits behind `motion-safe:` (prefers-reduced-motion). Ornaments are geometry, never figures: no person, and never the Prophet ﷺ or any prophet.

## Rules

1. New shared component → `packages/ui/src/components`, export in `index.ts`, tokens only.
2. Icons are passed as nodes (ui package has no icon dependency); the apps use `lucide-react`.
3. Mobile-first; sidebar collapses under `xl`; tables scroll horizontally.
4. Every screen has loading, empty and error states. No raw error text from the server.
5. Every page frame has a `SkipLink` and one `main#main`. Focus is always visible: a ring or an outline, never a colour change alone. Interactive targets are at least 24 × 24 px.
5. Accessibility: labels tied to inputs, visible focus, `aria-live` for status, sufficient contrast (verify `primary` on white for small text; use `secondary` for text links).
6. Tailwind must scan the UI package: `apps/web/src/app/globals.css` has `@source '../../../../packages/ui/src'`. Keep it.
7. Dark mode: not in scope yet.

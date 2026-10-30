# 01 — Tech stack and handoff

Fixed unless the owner approves a change. Versions are what the scaffold was built and verified with (2026-10-30).

| Layer | Choice | Version in scaffold | Why |
|---|---|---|---|
| Monorepo | pnpm workspaces | pnpm 10 | One folder, shared types/UI, one lockfile |
| Frontend | Next.js App Router, TypeScript strict, `output: 'standalone'` | Next 16, React 19 | Server-rendered public pages, container deploy (not Vercel) |
| Styling | Tailwind CSS v4 with `@theme` tokens | 4.x | Tokens in one CSS file, no UI-kit lock-in |
| Icons | lucide-react | 0.540 | Small, tree-shakable (old site used 4+ icon/UI libs) |
| Fonts | `@fontsource-variable/inter` + `noto-sans-bengali` | self-hosted | No Google Fonts call; Bangla support |
| Backend | NestJS, TypeScript strict | Nest 11 | Modules, guards, DTO validation, DI |
| ORM | Prisma (single data-access layer) | 6.19 | Migrations, typed queries. PgBouncer: `?pgbouncer=true` + `DIRECT_URL` for migrate |
| Database | PostgreSQL in Docker, behind PgBouncer (transaction mode) | PG 17 | Same host as API: no network latency (lesson from Tokyo DB) |
| Cache | Redis `allkeys-lru` | 7 | Cache, rate limit, exam checkpoints, leaderboard snapshot |
| Queue | Redis `noeviction` + AOF, BullMQ | BullMQ 5 | Email, scoring, reconciliation, certificates. Jobs must not be lost |
| Auth | Own system: argon2id, JWT access (15 min) + rotating refresh (7 days), httpOnly cookies | argon2 0.44 | No third-party dependency in login path |
| Payments | PayStation hosted checkout (BDT) | sandbox first | Wallets + cards on their page; no card data on our servers |
| Email | **Resend** (owner, 2026-10-30) behind a provider interface; Mailpit in dev; sent via the BullMQ queue with retries | — | SPF/DKIM/DMARC required before production sending |
| Validation | class-validator + class-transformer (API); env validated at boot | 0.14 | Global `ValidationPipe` whitelist |
| Logging | pino via nestjs-pino (JSON, redacts auth headers) | 9 | Structured logs |
| Proxy | Nginx (Cloudflare in front) | 1.30 (pinned 1.30.6) | TLS, gzip, rate limit, static caching, real-IP restore |
| Hosting | ONE Hostinger KVM 8 VPS (verify specs) | — | Predictable cost. Single point of failure is accepted, so backups + rebuild script are mandatory |
| Monitoring | Uptime monitor + Netdata or Prometheus/Grafana + Sentry | to set up | Know before the client does |
| Load test | k6 from another machine | — | Required before any real exam |
| CI | GitHub Actions: install, lint, typecheck, test, build; key-based SSH deploy | to set up | No root/password deploys |

## Removed from the old stack (do not bring back)

Supabase (Auth, DB, REST), Vercel (frontend + serverless API), Express 5 API, Redux Toolkit + redux-persist, persisted TanStack Query cache, MUI, daisyUI, sweetalert2, react-toastify/hot-toast, framer-motion everywhere, Google Translate widget, Cloudinary unsigned uploads (replace with a server-controlled upload), SendGrid + Resend mix, bKash direct integration (replaced by PayStation), `jspdf`/browser-side certificate generation.

## Allowed later, only with a reason in DECISIONS.md

A chart library for admin charts (pick ONE, lazy-loaded), a toast library (one), `@react-pdf/renderer` on the **server** for invoices/certificates, `react-phone-input-2` or a lighter phone input for the registration form, `next-intl` for locale routing.

## Environment

All configuration is environment variables validated at API boot (`apps/api/src/config/env.ts`). Template: `.env.example`. Secrets never in git, `NEXT_PUBLIC_*`, or logs.

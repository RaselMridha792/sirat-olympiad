# 09 — Folder structure

```
sirat-olympiad/
├─ CLAUDE.md                  Do's/Don'ts + read order (start here)
├─ README.md
├─ package.json  pnpm-workspace.yaml  tsconfig.base.json  .prettierrc  .editorconfig  .gitignore  .env.example
├─ apps/
│  ├─ web/                    Next.js (App Router, TS, standalone)
│  │  ├─ Dockerfile  next.config.mjs  postcss.config.mjs  eslint.config.mjs
│  │  └─ src/
│  │     ├─ app/
│  │     │  ├─ layout.tsx  globals.css  error.tsx  loading.tsx  not-found.tsx
│  │     │  ├─ (marketing)/            public pages (server-rendered/static)
│  │     │  ├─ (auth)/                 login, register, forgot-password (AuthSplitLayout)
│  │     │  ├─ (student)/dashboard/…   student shell + pages (exam, leaderboard, profile, ambassador)
│  │     │  └─ admin/…                 admin shell + pages
│  │     ├─ components/               app-specific (NavShell, LoginForm, RegisterForm)
│  │     ├─ lib/                      api.ts (same-origin client), session.ts (MOCK), mock.ts (delete later)
│  │     └─ i18n/                     en.json, bn.json, t()
│  └─ api/                    NestJS
│     ├─ Dockerfile  nest-cli.json  eslint.config.mjs
│     ├─ prisma/                    schema.prisma, migrations/, seed.ts, fixtures/ (dev-only, excluded from images)
│     ├─ test/                      DB + Redis integration tests (*.int-spec.ts, test:int)
│     └─ src/
│        ├─ main.ts  app.module.ts
│        ├─ config/env.ts             validated env
│        ├─ common/                   exception filter (add guards, decorators, interceptors here)
│        ├─ prisma/  redis/           global modules
│        ├─ health/                   /api/health, /api/ready
│        └─ modules/                  auth users exams attempts payments notifications admin
│                                     ambassadors rounds leaderboard certificates   (stubs)
├─ packages/
│  ├─ ui/                     shared React components + tokens.css (source-consumed by web)
│  └─ shared/                 types/constants for web+api (compiled to dist; run its build first)
├─ .github/workflows/ci.yml   CI gates (checks, DB integration tests, Docker images)
├─ infra/                     docker-compose.yml, docker-compose.dev.yml (local only), nginx/, postgres/, redis/
├─ scripts/                   bootstrap.sh backup.sh restore.sh healthcheck.sh
├─ loadtests/                 k6 scripts (smoke.js + README)
├─ docs/                      this documentation set
└─ reference/                 OLD Zero Olympiad (read-only spec, excluded from workspace)
```

## Module layout convention (API)

```
modules/<name>/
  <name>.module.ts  <name>.controller.ts  <name>.service.ts
  dto/…            class-validator DTOs (one per endpoint)
  guards/…         only if module-specific
  <name>.service.spec.ts   unit tests next to code
```

Cross-module access goes through exported services, never direct table access to another module's tables (except read-only through the owning service).

## Web conventions

* Server Components by default; `'use client'` for interactive pieces only.
* Route groups: `(marketing)`, `(auth)`, `(student)`, `admin`. Layouts do the server-side session check and role-filtered menus.
* One API client (`lib/api.ts`). No axios, no per-file fetch with hand-built headers.
* Shared UI → `packages/ui`. App-specific composition → `apps/web/src/components`.
* Naming: files `kebab-case` or `PascalCase.tsx` for components; routes follow Next conventions.

## Dependency direction

`apps/*` → `packages/*`. `packages/ui` and `packages/shared` never import from apps. `reference/` is imported by nobody.

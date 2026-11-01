# API image. Build context = repo root (monorepo); .dockerignore is an allow-list (no env, keys, infra, tests, fixtures).
FROM node:22-slim AS build
RUN corepack enable && apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
# pnpm 10: `deploy` needs --legacy without inject-workspace-packages. `deploy` re-installs packages into /out,
# so the Prisma client must be generated again there (otherwise @prisma/client has no generated client).
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @sirat/shared build \
 && pnpm --filter @sirat/api prisma:generate \
 && pnpm --filter @sirat/api build \
 && pnpm --filter @sirat/api deploy --prod --legacy /out \
 && apps/api/node_modules/.bin/prisma generate --schema /out/prisma/schema.prisma

# One-shot job (compose service `migrate`): apply migrations, set up the runtime role's login (prisma/runtime-role.ts),
# then the idempotent config seed. Never runs fixtures.
# Copies only what `prisma migrate deploy` and `tsx prisma/seed.ts` need from the build stage: no sources of the other
# apps, no pnpm store. pnpm's isolated layout: apps/api/node_modules/* are symlinks into /repo/node_modules/.pnpm
# (which also holds the generated Prisma client and engines), so the /repo paths are kept as they are.
FROM node:22-slim AS migrate
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/tsconfig.base.json ./
COPY --from=build /repo/apps/api/package.json /repo/apps/api/tsconfig.json ./apps/api/
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
WORKDIR /repo/apps/api
USER node
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node_modules/.bin/tsx prisma/runtime-role.ts && node_modules/.bin/tsx prisma/seed.ts"]

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /out ./
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]

# API image. Build context = repo root (monorepo); .dockerignore keeps .env, reference/ and fixtures out.
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

# One-shot job (compose service `migrate`): apply migrations, then the idempotent config seed.
# Uses the build stage because it needs the Prisma CLI and tsx (dev dependencies). Never runs fixtures.
FROM build AS migrate
WORKDIR /repo/apps/api
USER node
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node_modules/.bin/tsx prisma/seed.ts"]

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /out ./
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]

# Next.js standalone image. Build context = repo root (monorepo); .dockerignore is an allow-list.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# public/ may be empty or untracked in a fresh clone; create it so the COPY below always works.
RUN mkdir -p apps/web/public \
 && pnpm install --frozen-lockfile && pnpm --filter @sirat/shared build && pnpm --filter @sirat/web build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# Standalone output leaves public/ out; without this, favicon/robots/logos 404 in production only.
COPY --from=build /repo/apps/web/public ./apps/web/public
# Next writes at runtime: regenerated ISR pages (.next/server/route-cache; the public pages revalidate every 60 s) and
# fetch results (.next/cache). Only those two folders belong to the runtime user; the rest of .next stays root-owned.
RUN mkdir -p apps/web/.next/cache apps/web/.next/server/route-cache \
 && chown node:node apps/web/.next/cache apps/web/.next/server/route-cache
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM node:22-slim AS build
RUN corepack enable && apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @sirat/shared build \
 && pnpm --filter @sirat/api prisma:generate && pnpm --filter @sirat/api build \
 && pnpm --filter @sirat/api deploy --prod /out

FROM node:22-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /out ./
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]

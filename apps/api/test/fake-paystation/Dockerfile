# DEV/TEST ONLY: the fake PayStation (PAYMENTS-PLAN D5) as a container, for load and staging stacks
# (infra/fake-paystation.compose.yml). Built from this folder alone, so nothing else of the repo is in it, and it is
# never part of the api image (the root .dockerignore keeps apps/api/test out of every build from the root).
# The API refuses PAYSTATION_ENV=fake under NODE_ENV=production; see the compose file.

FROM node:22-slim AS build
WORKDIR /src
# The esbuild the workspace already uses; the only package this image ever installs, and only in this stage.
RUN npm install --no-save --no-audit --no-fund esbuild@0.28.2
COPY fake-paystation.ts run.ts ./
RUN npx esbuild run.ts --bundle --platform=node --target=node22 --format=cjs --outfile=/out/fake-paystation.js

FROM node:22-slim
WORKDIR /app
COPY --from=build /out/fake-paystation.js ./
ENV FAKE_PAYSTATION_HOST=0.0.0.0 \
    FAKE_PAYSTATION_PORT=18090
USER node
EXPOSE 18090
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:18090/__fake/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "fake-paystation.js"]

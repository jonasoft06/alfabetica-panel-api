# syntax=docker/dockerfile:1

FROM node:24-trixie-slim AS base
# openssl: required by Prisma's schema engine (migrate deploy).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
# pnpm version comes from package.json "packageManager".
# Downloaded once here; build and runtime stages reuse this layer.
# Corepack is bundled up to Node 24; it is no longer shipped from Node 25.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack install

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile
COPY . .
# Dummy URL only for this command: prisma.config.ts reads DATABASE_URL, but
# generate never connects. It does not persist in any layer.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm exec prisma generate
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
# "pnpm.onlyBuiltDependencies" lets @prisma/engines download the schema engine
# here (as root), so `prisma migrate deploy` works when running as USER node.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --prod --frozen-lockfile
# dist/ already contains the compiled client (dist/generated/prisma) and seed.
# prisma/ + prisma.config.ts: predeploy runs `prisma migrate deploy`.
# certs/: CA referenced by sslrootcert in DATABASE_URL.
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/certs ./certs
USER node
EXPOSE 4000
# Exec form: node is PID 1 and receives SIGTERM (enableShutdownHooks).
CMD ["node", "dist/src/main"]
# One image holds the whole app: the built web pages plus the API server that serves them.
# Built by GitHub Actions (.github/workflows/docker.yml) and run on Unraid (see deploy/README.md).
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# Install first, from the lockfile only, so code changes don't redo the install layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_PORT=8080 \
    DATA_DIR=/data \
    WEB_DIST=/app/apps/web/dist
# The server runs its TypeScript through tsx, so it ships with node_modules and sources as is.
COPY --from=build /app /app
# Tokens, snapshots, chats, and caches live here. Map it to an Unraid share so they survive updates.
VOLUME /data
EXPOSE 8080
# Runs as root like most Unraid containers, so it can write to an appdata share without a chown step.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]

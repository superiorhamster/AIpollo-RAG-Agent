FROM node:22.23.5-bookworm-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install --global pnpm@10.34.9
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY next.config.ts proxy.ts tsconfig.json ./
COPY app/ app/
COPY scripts/ scripts/
RUN pnpm build

FROM node:22.23.5-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.next/standalone/ ./
COPY --from=build --chown=node:node /app/.next/static/ ./.next/static/

COPY --from=build /app/public/ ./public/

USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(response => { if (!response.ok) process.exitCode = 1 }).catch(() => { process.exitCode = 1 })"]
CMD ["node", "server.js"]

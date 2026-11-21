FROM mcr.microsoft.com/playwright:v1.64.1-noble

RUN npm install --global pnpm@10.34.9 && mkdir /tests && chown pwuser:pwuser /tests
WORKDIR /tests
USER pwuser
COPY --chown=pwuser:pwuser package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY --chown=pwuser:pwuser playwright.config.ts workspace.spec.ts ui.config.ts ui.spec.ts ui-gateway.mjs ./
CMD ["pnpm", "test"]

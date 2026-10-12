FROM node:24.21.0-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd AS dependencies
WORKDIR /opt/opencareers
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global corepack@0.34.6 \
    && corepack prepare pnpm@12.4.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24.21.0-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    AUTOPILOT_SKIP_ENV_FILE=1
WORKDIR /opt/opencareers
COPY --from=dependencies /opt/opencareers/node_modules ./node_modules
COPY package.json ./
COPY dist ./dist
RUN node node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/opencareers \
    && chown -R node:node /opt/ms-playwright /var/lib/opencareers
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "const host=new URL(process.env.AUTOPILOT_ALLOWED_ORIGINS.split(',')[0].trim()).host; fetch('http://127.0.0.1:4317/health/runtime',{headers:{host},signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/api/src/main.js"]

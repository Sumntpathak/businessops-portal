FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/voice/package.json apps/voice/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/calendar/package.json packages/calendar/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS development
COPY . .
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @recepto/shared build && pnpm --filter @recepto/db build && pnpm --filter @recepto/calendar build && pnpm --filter @recepto/voice dev"]

FROM deps AS build
COPY . .
RUN pnpm --filter @recepto/shared build && pnpm --filter @recepto/db build && pnpm --filter @recepto/calendar build && pnpm --filter @recepto/voice build
RUN pnpm deploy --filter @recepto/voice --prod --legacy /prod/voice

FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 recepto
COPY --from=build --chown=recepto:nodejs /prod/voice ./
COPY --from=build --chown=recepto:nodejs /workspace/apps/voice/dist ./dist
COPY --from=build --chown=recepto:nodejs /workspace/packages/shared/dist ./node_modules/@recepto/shared/dist
COPY --from=build --chown=recepto:nodejs /workspace/packages/db/dist ./node_modules/@recepto/db/dist
COPY --from=build --chown=recepto:nodejs /workspace/packages/calendar/dist ./node_modules/@recepto/calendar/dist
USER recepto
EXPOSE 3001
CMD ["node", "dist/server.js"]


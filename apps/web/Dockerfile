FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/calendar/package.json packages/calendar/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS development
COPY . .
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @recepto/shared build && pnpm --filter @recepto/db build && pnpm --filter @recepto/calendar build && pnpm --filter @recepto/web dev"]

FROM deps AS build
COPY . .
RUN pnpm --filter @recepto/shared build && pnpm --filter @recepto/db build && pnpm --filter @recepto/calendar build && pnpm --filter @recepto/web build
RUN pnpm deploy --filter @recepto/web --prod --legacy /prod/web

FROM node:20-alpine AS production
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=build --chown=nextjs:nodejs /prod/web ./
COPY --from=build --chown=nextjs:nodejs /workspace/apps/web/.next ./.next
COPY --from=build --chown=nextjs:nodejs /workspace/apps/web/public ./public
COPY --from=build --chown=nextjs:nodejs /workspace/packages/shared/dist ./node_modules/@recepto/shared/dist
COPY --from=build --chown=nextjs:nodejs /workspace/packages/db/dist ./node_modules/@recepto/db/dist
COPY --from=build --chown=nextjs:nodejs /workspace/packages/calendar/dist ./node_modules/@recepto/calendar/dist
USER nextjs
EXPOSE 3000
CMD ["pnpm", "start"]



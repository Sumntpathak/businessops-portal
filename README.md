# Recepto

Recepto is a multi-tenant AI receptionist SaaS. This repository is a pnpm workspace containing the Next.js dashboard, Fastify voice gateway, shared contracts, and PostgreSQL data layer.

## Quickstart

1. Clone the repository and enter it: `git clone <repository-url> recepto && cd recepto`
2. Create local configuration: `cp .env.example .env`
3. Start the full hot-reloading stack: `pnpm dev`

The web placeholder is available at [http://localhost:3000](http://localhost:3000). The voice service health endpoint is [http://localhost:3001/health](http://localhost:3001/health).

## Workspace

- `apps/web` — Next.js 14 App Router, Tailwind, and shadcn/ui
- `apps/voice` — Fastify HTTP service and `ws` media-stream upgrade endpoint
- `packages/db` — Drizzle ORM, PostgreSQL driver, and migrations
- `packages/shared` — environment validation, zod schemas, constants, and shared types

## Commands

- `pnpm dev` — build and start the development Compose stack with bind-mounted hot reload
- `pnpm build` — build all workspaces
- `pnpm db:generate` — generate a Drizzle migration from the schema
- `pnpm db:migrate` — apply pending Drizzle migrations
- `pnpm db:studio` — open Drizzle Studio
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d` — start production images

Postgres listens on `:5432` and Redis on `:6379` during local development. Both persist data in named volumes. Production removes those host port bindings.

All runtime configuration is validated when each app starts. Missing or invalid variables produce one readable error listing every problem.

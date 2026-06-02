# BusinessOps Portal

BusinessOps Portal is a Next.js operations dashboard for leads, follow-ups, invoices, payments, and role-based team access.

## Stack

- Next.js App Router with TypeScript
- React
- Tailwind CSS
- Neon PostgreSQL
- Drizzle ORM
- JWT sessions in httpOnly cookies
- Vercel deployment

## Project Layout

```text
src/
  app/                 Next.js pages, layouts, and route handlers
  features/            Business domains grouped by product area
  server/              Backend-only auth, database, HTTP, and audit helpers
  shared/              Reusable UI, layout, hooks, constants, and utilities
```

See `PROJECT_STRUCTURE.md` for folder and naming conventions.

## Environment

Copy `.env.example` to `.env.local` and fill values from your private providers.

```bash
DATABASE_URL=
JWT_SECRET=
MOCK_WEBHOOK_SECRET=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
NEXT_PUBLIC_APP_URL=

SEED_ADMIN_PASSWORD=
SEED_MANAGER_PASSWORD=
SEED_AGENT_ONE_PASSWORD=
SEED_AGENT_TWO_PASSWORD=
SEED_FINANCE_PASSWORD=
```

Do not commit `.env*` files. They are ignored by git.

## Local Development

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

The app starts on `http://localhost:3000` unless that port is already in use.

## Scripts

```bash
npm run dev      # start local server
npm run build    # production build
npm run lint     # lint source files
npm run db:push  # push Drizzle schema
npm run db:seed  # seed sample data using SEED_* env vars
```

## Deployment

Vercel deploys from GitHub. Configure all environment variables in Vercel before deploying.

## Security Notes

- No credentials or seed passwords are stored in the repository.
- Auth cookies are httpOnly and secure in production.
- Password hashes are generated with bcrypt.
- Follow-up production issues are tracked in `PRODUCTION_ISSUES.md`.

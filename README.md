# BusinessOps Portal

BusinessOps Portal is a production-style operations dashboard for a small service company to manage leads, follow-ups, invoices, mock payments, file attachments, internal users, and audit activity.

## Tech Stack

- Next.js App Router, React, and TypeScript for full-stack routing and server-rendered protected pages.
- Tailwind CSS for responsive UI without paid templates.
- Neon PostgreSQL with Drizzle ORM for hosted relational data and typed schema access.
- JWT sessions in httpOnly cookies with backend role and ownership checks.
- Cloudinary free tier for attachment uploads.
- Mock payment routes instead of paid payment providers.
- Vercel free tier for deployment.

## Live Links

- Live Vercel URL: https://businessops-portal-c8rhiaazr-pathaksumnt4u-gmailcoms-projects.vercel.app
- GitHub repository URL: https://github.com/Sumntpathak/businessops-portal

## Demo Login

| Role | Email | Password |
|---|---|---|
| Admin | businessops.admin@yopmail.com | Admin@1234 |
| Manager | businessops.manager@yopmail.com | Manager@1234 |
| Agent 1 | businessops.agent1@yopmail.com | Agent@1234 |
| Agent 2 | businessops.agent2@yopmail.com | Agent@1234 |
| Finance | businessops.finance@yopmail.com | Finance@1234 |

Self-registration creates an active agent account by default. Set `REQUIRE_ADMIN_ACTIVATION=true` to require admin activation for new accounts.

## Database Schema

The Drizzle schema lives in `src/server/db/schema`.

- `users`: staff identity, bcrypt password hash, role, active state.
- `leads`: lead contact details, source, status, assignment, notes.
- `followups`: dated follow-up tasks linked to leads.
- `invoices`: invoice header, generated invoice number, server-calculated totals.
- `invoice_items`: invoice line items with quantity, unit price, and line total.
- `payment_logs`: immutable mock payment initiation and webhook records.
- `file_attachments`: uploaded file metadata and Cloudinary URL.
- `integration_configs`: mocked email, WhatsApp, and payment gateway settings.
- `message_logs`: mocked outbound email and WhatsApp message history.
- `user_permissions`: granular user permission overrides.
- `audit_logs`: important user/system actions.

Seed data creates 5 users, 20 leads, 10 follow-ups, 8 invoices, payment logs, one attachment, and audit logs.

## API Routes

- `POST /api/auth/login`: `{ "email": "...", "password": "..." }`
- `POST /api/auth/register`: `{ "name": "...", "email": "...", "password": "..." }`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/leads?page=&limit=&search=&status=&assignedTo=&sort=`
- `POST /api/leads`
- `GET /api/leads/:id`
- `PUT /api/leads/:id`
- `DELETE /api/leads/:id`
- `GET /api/followups?status=&due=today|overdue|upcoming`
- `GET /api/leads/:id/followups`
- `POST /api/leads/:id/followups`
- `PUT /api/followups/:id`
- `GET /api/invoices?page=&limit=&status=&search=`
- `POST /api/invoices`
- `GET /api/invoices/:id`
- `PUT /api/invoices/:id/status`
- `POST /api/invoices/:id/send`
- `POST /api/payments/mock-create`
- `POST /api/payments/mock-webhook` with `x-webhook-secret`
- `GET /api/uploads?entityType=&entityId=`
- `POST /api/uploads`
- `GET /api/integrations`
- `POST /api/integrations`
- `GET /api/integrations/status`
- `POST /api/integrations/test`
- `GET /api/messages?page=&limit=&channel=`
- `POST /api/messages/send`
- `GET /api/users/:id/permissions`
- `PUT /api/users/:id/permissions`
- `GET /api/dashboard`
- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:id`
- `GET /api/audit-logs?page=&limit=&entityType=&action=`

Protected APIs return `401` when unauthenticated and `403` when the authenticated role or owner is not allowed.

## Environment

Copy `.env.example` to `.env.local` and fill provider values.

```bash
DATABASE_URL=
JWT_SECRET=
MOCK_WEBHOOK_SECRET=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
REQUIRE_ADMIN_ACTIVATION=false
SEED_ADMIN_PASSWORD=
SEED_MANAGER_PASSWORD=
SEED_AGENT_ONE_PASSWORD=
SEED_AGENT_TWO_PASSWORD=
SEED_FINANCE_PASSWORD=
```

Do not commit `.env*` files. They are ignored by git.

### Cloudinary Upload Setup

BusinessOps uses signed Cloudinary uploads for lead and invoice attachments. The upload route is already integrated at `POST /api/uploads`; it requires these server-side environment variables:

```bash
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Get the values from Cloudinary Console > Settings > API Keys. Add the same variables in Vercel under Project Settings > Environment Variables for Production. Do not put the API secret in README, source code, or client-side variables.

Current Cloudinary status:

- Cloudinary code integration: implemented.
- Local/Vercel production credentials: configured.
- Production uploads require a fresh Vercel deployment after environment variable changes.
- Attachments are optional supporting files for leads and invoices.

## Local Setup

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

The app starts on `http://localhost:3000` unless that port is already in use.

## Deployment

1. Create a Neon PostgreSQL database and copy the connection string to Vercel as `DATABASE_URL`.
2. Add `JWT_SECRET`, `MOCK_WEBHOOK_SECRET`, Cloudinary values, and `NEXT_PUBLIC_APP_URL` in Vercel.
3. Run `npm run db:push` and `npm run db:seed` against the production database.
4. Deploy on Vercel from the GitHub repository.

### Vercel Environment Checklist

Required production variables:

- `DATABASE_URL`
- `JWT_SECRET`
- `MOCK_WEBHOOK_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `NEXT_PUBLIC_APP_URL`

Optional production variables:

- `REQUIRE_ADMIN_ACTIVATION`
- `SEED_ADMIN_PASSWORD`
- `SEED_MANAGER_PASSWORD`
- `SEED_AGENT_ONE_PASSWORD`
- `SEED_AGENT_TWO_PASSWORD`
- `SEED_FINANCE_PASSWORD`

## Known Limitations

- The seed script is intended for a fresh database and is not idempotent.
- File content validation checks extension, MIME type, and size, but does not perform deep magic-number inspection.
- Audit writes are non-blocking, so the main business action can succeed even if audit persistence fails.
- Automated Playwright smoke tests cover admin workflows plus manager, agent, and finance dashboard/navigation checks. Broader API contract and negative authorization tests would be added with more time.
- **Rate limiter is in-memory only.** `src/server/http/rate-limit.ts` uses a module-scope `Map`. On Vercel each serverless instance has its own memory, so login/register throttling is best-effort, not a hard cap. With one more week the upgrade would be Upstash Redis (free tier) with `rl:{scope}:{key}` keys and a TTL matching the existing window, swapping the `Map` for an atomic `INCR + EXPIRE` pipeline so limits hold across instances.



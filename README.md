# BusinessOps Portal

BusinessOps Portal is a production-style operations dashboard for a small service company to manage leads, follow-ups, invoices, mock payments, file attachments, internal users, and audit activity.

## Tech Stack and Why

| Layer | Choice | Why |
|-------|--------|-----|
| **Framework** | Next.js 14 App Router + React + TypeScript | Single repo for both frontend and backend API routes. App Router enables per-route server components with built-in layouts and middleware — no separate Express server needed. TypeScript catches schema mismatches between DB and UI at compile time. |
| **Styling** | Tailwind CSS | Utility-first approach ships zero dead CSS in production without a build step for purging. Chosen over MUI/shadcn to avoid opinionated component lock-in on a short timeline. |
| **Database** | Neon PostgreSQL | Free-tier hosted Postgres with a serverless HTTP driver that works inside Vercel Edge/serverless functions without a persistent TCP pool. Chosen over Supabase (larger cold-start) and MongoDB Atlas (relational data with FK constraints is a better fit for leads → invoices → payments). |
| **ORM** | Drizzle ORM | Generates SQL directly — no hidden N+1 queries and easy to audit. Type-safe schema with `.returning()` and `db.batch()` for atomic multi-table writes. Chosen over Prisma because Prisma's query engine binary is large and adds cold-start latency on Vercel. |
| **Auth** | Custom JWT in httpOnly cookies | Full control over expiry, claims, and revocation without a third-party auth service. httpOnly cookies prevent XSS token theft. Chosen over NextAuth because the role/permission model needed custom claims not easily expressed in NextAuth sessions. |
| **File storage** | Cloudinary free tier | Signed server-side uploads keep API secrets out of the browser. Free tier supports PDF and image uploads within the 2 MB limit required by the spec. |
| **Deployment** | Vercel free tier | Zero-config Next.js deployment. Each API route becomes a serverless function with automatic HTTPS and preview deployments per branch. |

## Live Links

- Live Vercel URL: https://businessops-portal.vercel.app
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

Protected APIs return `401` when unauthenticated and `403` when the authenticated role or owner is not allowed.

### Authentication

**POST /api/auth/login**
```json
// Request
{ "email": "businessops.admin@yopmail.com", "password": "Admin@1234" }

// 200 OK — sets httpOnly cookies sc_token + sc_refresh
{ "user": { "id": "uuid", "name": "Admin User", "email": "...", "role": "admin" } }

// 401 Unauthorized
{ "error": "Invalid email or password" }
```

**POST /api/auth/register**
```json
// Request
{ "name": "Jane Doe", "email": "jane@example.com", "password": "Secret@123" }

// 201 Created
{ "user": { "id": "uuid", "name": "Jane Doe", "role": "agent" } }

// 400 Bad Request (validation failure)
{ "error": "Validation failed", "details": { "email": ["Invalid email"] } }
```

**GET /api/auth/me** — returns current session user from cookie.

**POST /api/auth/logout** — clears session cookies.

### Leads

**GET /api/leads?page=1&limit=10&search=rajesh&status=New&assignedTo=&sort=desc**
```json
// 200 OK
{
  "data": [
    {
      "id": "uuid",
      "name": "Rajesh Kumar",
      "email": "rajesh@techcorp.in",
      "phone": "9876543210",
      "company": "TechCorp India",
      "source": "Website",
      "status": "New",
      "assignedTo": "uuid",
      "notes": null,
      "createdAt": "2026-06-01T10:00:00Z",
      "updatedAt": "2026-06-01T10:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

**POST /api/leads**
```json
// Request (admin/manager only)
{
  "name": "New Client",
  "email": "client@example.com",
  "phone": "9000000000",
  "company": "Example Co",
  "source": "Website",
  "status": "New",
  "assignedTo": "agent-uuid",
  "notes": "Met at conference"
}

// 201 Created
{ "id": "uuid", "name": "New Client", ... }

// 403 Forbidden (agent trying to create)
{ "error": "Forbidden" }
```

**PUT /api/leads/:id**
```json
// Request — any subset of lead fields
{ "status": "Contacted", "notes": "Called, interested" }

// 200 OK — returns updated lead
```

**DELETE /api/leads/:id** — `200 { "message": "Lead deleted" }` (admin/manager only).

### Follow-Ups

**GET /api/followups?due=today**
```json
// 200 OK
[
  {
    "id": "uuid",
    "leadId": "uuid",
    "leadName": "Rajesh Kumar",
    "followUpDate": "2026-06-06",
    "message": "Call to discuss proposal",
    "status": "Pending"
  }
]
```

**POST /api/leads/:id/followups**
```json
// Request
{ "followUpDate": "2026-06-10", "message": "Send pricing document" }

// 201 Created
{ "id": "uuid", "leadId": "uuid", "followUpDate": "2026-06-10", "status": "Pending" }
```

**PUT /api/followups/:id**
```json
// Request
{ "status": "Completed" }

// 200 OK — returns updated follow-up
// 403 if agent tries to update a follow-up on another agent's lead
```

### Invoices

**POST /api/invoices**
```json
// Request (admin/manager/finance only)
{
  "clientName": "Acme Corp",
  "leadId": "uuid-or-null",
  "taxPercentage": 18,
  "discount": 1000,
  "items": [
    { "description": "Consulting Services", "quantity": 2, "unitPrice": 5000 },
    { "description": "Report Writing",      "quantity": 1, "unitPrice": 3000 }
  ]
}

// 201 Created — totals are server-calculated, frontend values ignored
{
  "id": "uuid",
  "invoiceNumber": "INV-2026-0003",
  "subtotal": "13000.00",
  "taxAmount": "2340.00",
  "discount": "1000.00",
  "totalAmount": "14340.00",
  "status": "Draft"
}
```

**PUT /api/invoices/:id/status**
```json
// Request (admin/manager/finance only; cannot set Paid directly)
{ "status": "Cancelled" }

// 400 Bad Request — Paid invoices cannot be changed
{ "error": "Paid invoices cannot be changed" }
```

### Payments (Mock)

**POST /api/payments/mock-create**
```json
// Request
{ "invoiceId": "uuid" }

// 200 OK — initiates payment, status stays Sent until webhook fires
{ "transactionId": "MOCK-TXN-1717689600000", "message": "Payment initiated. Awaiting webhook confirmation." }
```

**POST /api/payments/mock-webhook**
```
Header: x-webhook-secret: <MOCK_WEBHOOK_SECRET value>
```
```json
// Request
{ "invoiceId": "uuid", "transactionId": "MOCK-TXN-1717689600000", "status": "Success" }

// 200 OK — invoice.status is now Paid, payment_log written
{ "message": "Webhook processed: Success" }

// 401 Unauthorized — missing or wrong secret
{ "error": "Invalid webhook secret" }
```

### File Upload

**POST /api/uploads** — multipart/form-data
```
file:        <binary — PDF/PNG/JPG/JPEG, max 2 MB>
entityType:  lead | invoice
entityId:    <uuid>
```
```json
// 201 Created
{
  "id": "uuid",
  "entityType": "lead",
  "entityId": "uuid",
  "fileName": "proposal.pdf",
  "fileUrl": "https://res.cloudinary.com/...",
  "fileType": "pdf",
  "fileSizeBytes": 204800
}

// 400 Bad Request — wrong type or oversized
{ "error": "File exceeds 2 MB limit" }
```

### Dashboard

**GET /api/dashboard**
```json
// 200 OK
{
  "leads":           { "total": 20, "open": 12, "converted": 4, "lost": 4 },
  "invoices":        { "total": 8, "paid": 2, "unpaid": 6, "revenue": "135000.00" },
  "followupsDueToday": 3,
  "recentAuditLogs": [ { "id": "uuid", "action": "LEAD_CREATED", "entityType": "lead", "createdAt": "..." } ]
}
```

### Other Routes

- `GET /api/users` — list users (admin/manager)
- `POST /api/users` — create user (admin)
- `PUT /api/users/:id` — update user (admin)
- `GET /api/users/:id/permissions` — get permissions (admin)
- `PUT /api/users/:id/permissions` — set permissions (admin)
- `GET /api/audit-logs?page=1&limit=20&entityType=lead&action=LEAD_CREATED`
- `GET /api/integrations` — list mock integration configs
- `POST /api/integrations` — upsert mock config (admin)
- `GET /api/messages?page=1&limit=20&channel=email`
- `POST /api/messages/send` — log a mock outbound message

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

## AI Tools Used

**Claude (Anthropic) — Claude Code CLI** was used throughout this project as a development assistant. Specific uses:

| Area | What AI was used for |
|------|----------------------|
| Schema design | Reviewing Drizzle schema for correct FK relationships, cascade rules, and index placement (e.g. unique index on `payment_logs.transaction_id` for webhook idempotency). |
| RBAC logic | Cross-checking that every API route handler enforced the correct role matrix from the spec — e.g. confirming agents receive 403 on another agent's lead even via direct URL. |
| Invoice number generation | Identifying and fixing a year-mismatch bug where the seed hardcoded `INV-2025-*` while the service used the current year, causing sequential numbering to restart from 0001 each year change. |
| Bug fixes | Diagnosing a `NeonDbError: fetch failed` crash on the dashboard caused by Neon's free-tier auto-pause hitting 13 parallel queries with no error boundary; adding `error.tsx` to show a user-friendly retry page. |
| DB fix script | Writing and running a one-off `fix-invoice-numbers.ts` script to rename two malformed invoice records (`INV-2026-MQ*`) to correct sequential format directly against the live database. |
| Code review | Reviewing service, repository, and handler files for security issues (timing-safe webhook secret comparison, no frontend-trusted totals, no role escalation via registration). |

All business logic, architecture decisions, schema design, and deployment configuration were authored and owned by the developer. AI was used as a coding assistant — equivalent to an accelerated code review and pair-programming tool — not as an autonomous builder.

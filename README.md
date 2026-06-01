# BusinessOps Portal

A production-style multi-page full-stack application for managing leads, follow-ups, invoices, payments, and internal users with role-based access control.

---

## Tech Stack & Rationale

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router + TypeScript | SSR enforces auth before page render, no FOUC on protected routes |
| Styling | Tailwind CSS | Utility-first, no paid templates, great responsive defaults |
| Database | **Neon (free PostgreSQL)** | Serverless-native HTTP driver, zero cold-start on Vercel Edge |
| ORM | **Drizzle ORM** | No Rust binary, Edge-compatible, type-safe, lighter than Prisma on serverless |
| Auth | JWT in httpOnly cookies via `jose` | XSS-proof, Edge-compatible (jose ≠ jsonwebtoken which requires Node crypto) |
| File Storage | Cloudinary free tier | Presigned server-side, no keys in frontend |
| Email/Payment | Mocked in-app | No paid API needed |
| Deployment | Vercel Hobby | Free, Edge-optimized, native Next.js support |

---

## Live URL

> **https://businessops-portal.vercel.app** _(update after deploy)_

## Repository

> **https://github.com/your-username/businessops-portal** _(update after push)_

---

## Test Credentials

| Role | Email | Password |
|---|---|---|
| Admin | admin@businessops.dev | Admin@1234 |
| Manager | manager@businessops.dev | Manager@1234 |
| Agent 1 | agent1@businessops.dev | Agent@1234 |
| Agent 2 | agent2@businessops.dev | Agent@1234 |
| Finance | finance@businessops.dev | Finance@1234 |

---

## Database Schema

**PostgreSQL on Neon** — 9 tables:

| Table | Description |
|---|---|
| `users` | All portal users with hashed passwords, role enum, isActive flag |
| `leads` | Lead records with status enum, source enum, assignedTo FK |
| `followups` | Per-lead follow-ups with date (UTC YYYY-MM-DD), status |
| `invoices` | Invoice headers — all monetary values `numeric(12,2)` |
| `invoice_items` | Line items with quantity, unitPrice, lineTotal |
| `payment_logs` | Immutable log of every payment attempt/webhook event |
| `file_attachments` | Cloudinary URL + metadata; entityType + entityId polymorphic ref |
| `audit_logs` | Append-only log of all important actions with actor and metadata |

**Timezone assumption:** All timestamps stored with timezone in PostgreSQL. Follow-up dates are stored as plain `DATE` (YYYY-MM-DD) strings assumed to be in the user's local timezone. The server always queries using UTC date comparisons.

---

## API Routes

### Auth
```
POST /api/auth/register    { name, email, password } → sets httpOnly cookie
POST /api/auth/login       { email, password } → sets httpOnly cookie
POST /api/auth/logout      → clears cookie
GET  /api/auth/me          → { id, email, name, role }
```

### Leads
```
GET    /api/leads?page=1&limit=10&search=&status=&assignedTo=&sort=desc
GET    /api/leads/:id
POST   /api/leads          { name, email, phone, company, source, status, assignedTo, notes }
PUT    /api/leads/:id
DELETE /api/leads/:id
```

### Follow-ups
```
GET  /api/followups?status=Pending&due=today|overdue|upcoming
GET  /api/leads/:id/followups
POST /api/leads/:id/followups   { followUpDate, message }
PUT  /api/followups/:id         { status }
```

### Invoices
```
GET  /api/invoices?page=&limit=&status=&search=
GET  /api/invoices/:id
POST /api/invoices              { leadId, clientName, items[], taxPercentage, discount }
PUT  /api/invoices/:id/status   { status }  — restricted (no Paid via this route)
POST /api/invoices/:id/send
```

### Payments (mock)
```
POST /api/payments/mock-create    { invoiceId }
POST /api/payments/mock-webhook   Header: x-webhook-secret required → marks invoice Paid
```

### Dashboard
```
GET /api/dashboard → { totalLeads, openLeads, convertedLeads, lostLeads,
                       totalInvoices, paidInvoices, unpaidInvoices, revenue,
                       followupsDueToday, recentAuditLogs }
```

---

## Environment Variables

```bash
DATABASE_URL=               # Neon PostgreSQL connection string
JWT_SECRET=                 # Min 64 chars, random string
MOCK_WEBHOOK_SECRET=        # Secret header for mock payment webhook
CLOUDINARY_CLOUD_NAME=      # Cloudinary dashboard
CLOUDINARY_API_KEY=         # Cloudinary dashboard
CLOUDINARY_API_SECRET=      # Cloudinary dashboard
NEXT_PUBLIC_APP_URL=        # e.g. https://businessops-portal.vercel.app
```

---

## Local Setup

```bash
git clone https://github.com/your-username/businessops-portal
cd businessops-portal
npm install
cp .env.example .env.local   # fill in your values
npm run db:push               # push schema to Neon
npm run db:seed               # seed test data
npm run dev
```

---

## Deployment (Vercel)

```bash
# 1. Push to GitHub
git push origin main

# 2. Import repo in Vercel dashboard
# 3. Add all env variables from .env.example in Vercel → Settings → Env Vars
# 4. Deploy — Vercel auto-detects Next.js

# After deploy, run seed against production DB:
DATABASE_URL=<prod_url> npm run db:seed
```

---

## Known Limitations & One-Week Improvements

- **File upload UI** is scaffold-only — Cloudinary upload route is wired but the drag-drop UI needs polish
- **Dashboard stats** are placeholder — `/api/dashboard` aggregation query is Day 4 work
- **Email notifications** are fully mocked — would integrate with Resend (free tier) with one more week
- **No rate limiting** on auth routes — would add `upstash/ratelimit` (free tier Redis)
- **No refresh token rotation** — 8h JWT works for assessment scope; production would use refresh tokens
- **Tests** — would add Vitest unit tests for RBAC logic and Playwright E2E for critical paths

---

## AI Tools Used

- **Claude (Anthropic)** — Used for architecture planning, boilerplate generation, and code review of security-critical paths (JWT middleware, RBAC matrix, invoice calculation logic). All business logic reviewed and verified manually.

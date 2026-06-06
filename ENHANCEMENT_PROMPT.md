# BusinessOps Portal — SaaS Settings Enhancement Prompt

> **Target audience:** Claude Sonnet / Codex / any AI code agent  
> **Goal:** Enhance the Settings page and backend to make the portal feel like a production SaaS product with email/WhatsApp integrations, per-user granular permissions, and payment gateway configuration — all as **mocked integrations** (no paid APIs needed).

---

## CRITICAL SAFETY RULES — READ FIRST

1. **DO NOT modify, delete, rename, or restructure ANY existing working file** unless the instructions below explicitly say to edit that specific file.
2. **DO NOT create new shared UI components.** The project already has a complete UI kit at `src/shared/ui/` (exported via `src/shared/ui/index.ts`). You MUST import and use these existing components: `Button`, `Card`, `CardBody`, `CardHeader`, `CardTitle`, `Input`, `Select`, `Textarea`, `Badge`, `Toast`, `ConfirmDialog`, `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeaderCell`, `TableRow`, `EmptyState`, `PageShell`, `Pagination`, `Tabs`, `Alert`, `StatusBadge`.
3. **DO NOT create new utility functions.** Use the existing `cn()` from `src/shared/utils/cn.ts` for className merging and `useToast` from `src/shared/hooks/useToast.ts` for toast notifications.
4. **DO NOT modify the existing tabs** (Profile, Security, Preferences, Workspace) in the settings page — only ADD new tabs alongside them.
5. **DO NOT touch these files at all** — they are working and tested:
   - `src/middleware.ts`
   - `src/server/auth/jwt.ts`
   - `src/server/auth/cookies.ts`
   - `src/server/auth/session.ts`
   - `src/server/http/with-auth.ts`
   - `src/server/http/response.ts` (use its `ok()`, `err()`, `paginated()` helpers)
   - `src/server/audit/audit-log.ts` (use its `writeAuditLog()` function)
   - `src/server/auth/rbac.ts` (extend `CAN` object — don't replace it)
   - `src/shared/layout/AppSidebar.tsx`
   - All files inside `src/features/leads/`, `src/features/follow-ups/`, `src/features/invoices/`
   - All existing API route files
   - `src/server/db/schema/core.ts`, `leads-schema.ts`, `billing.ts` (ADD new tables — don't modify existing ones)
6. **Keep the same code patterns.** Every API route uses `withAuth()` wrapper, `requireRole()` for access control, Zod for validation, `ok()`/`err()` for responses, and `writeAuditLog()` for audit trailing. Follow these exact same patterns.
7. **All new integrations are MOCKED.** No real SendGrid, Twilio, Razorpay, or WhatsApp API calls. Store config in DB, simulate sends with console.log + audit logs, return mock success responses.

---

## EXISTING CODEBASE CONTEXT

### Tech Stack
- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + custom UI components (no shadcn, no Material UI)
- Drizzle ORM + Neon PostgreSQL (serverless)
- JWT auth with httpOnly cookies (jose library)
- Cloudinary for file uploads

### Key Architecture Patterns
```
API route:     src/app/api/{resource}/route.ts
                → exports GET/POST/PUT/DELETE wrapped in withAuth()
                → uses requireRole(ctx, ["admin", ...]) for RBAC
                → uses Zod schemas for input validation
                → calls ok(data) or err(message, status) for responses
                → calls writeAuditLog({...}) for audit trail

DB schema:     src/server/db/schema/{file}.ts
                → uses Drizzle pgTable, pgEnum, uuid, varchar, etc.
                → exports types via $inferSelect and $inferInsert
                → re-exported through src/server/db/schema/index.ts

Settings page: src/app/(app)/settings/page.tsx
                → "use client" component
                → uses TabType union for tab switching
                → all state managed with useState
                → uses localStorage for client preferences
                → admin/manager see "Workspace" tab (isManagement check)
```

### Current Settings Tab Structure
```typescript
type TabType = "profile" | "security" | "preferences" | "workspace";
```
The `tabs` array at line ~420 builds the sidebar nav. Workspace tab is only shown when `isManagement` is true (admin or manager). Each tab renders conditionally via `{activeTab === "tabName" && (...)}`.

### Existing Role System
```typescript
// src/shared/constants.ts
export const ROLES = ["admin", "manager", "agent", "finance"] as const;
export type Role = (typeof ROLES)[number];

// src/server/auth/rbac.ts — CAN object for permission checks
export const CAN = {
  manageUsers: (role: Role) => role === "admin",
  viewAllLeads: (role: Role) => role === "admin" || role === "manager" || role === "finance",
  assignLeads: (role: Role) => role === "admin" || role === "manager",
  deleteLead: (role: Role) => role === "admin",
  createInvoice: (role: Role) => role === "admin" || role === "manager" || role === "finance",
  markInvoicePaid: () => false,
  viewAuditLogs: (role: Role) => role === "admin" || role === "manager",
  elevateRole: () => false,
} as const;
```

### User Schema (DO NOT MODIFY — reference only)
```typescript
// src/server/db/schema/core.ts
export const users = pgTable("users", {
  id:           uuid("id").defaultRandom().primaryKey(),
  name:         varchar("name", { length: 255 }).notNull(),
  email:        varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role:         roleEnum("role").notNull().default("agent"),
  isActive:     boolean("is_active").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### DB Client
```typescript
import { db } from "@/server/db/client";
```

### Toggle Switch Pattern (already used in settings — reuse this exact pattern)
```tsx
<button
  type="button"
  onClick={() => handleToggle(!value)}
  className={cn(
    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
    value ? "bg-blue-600" : "bg-gray-200"
  )}
>
  <span className={cn(
    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
    value ? "translate-x-5" : "translate-x-0"
  )} />
</button>
```

---

## FEATURE 1: Email Service Integration (Mocked)

### What to build
An "Integrations" tab in Settings (visible to admin only) where the admin can configure SMTP/email provider settings. When "enabled," leads and invoices pages show a "Send Email" action that logs a mock email send.

### Database Changes — ADD to `src/server/db/schema/billing.ts`

```typescript
// Add a new table for integration configs (append to billing.ts, don't modify existing tables)
export const integrationConfigs = pgTable("integration_configs", {
  id:          uuid("id").defaultRandom().primaryKey(),
  type:        varchar("type", { length: 50 }).notNull(), // 'email' | 'whatsapp' | 'payment'
  provider:    varchar("provider", { length: 100 }).notNull(), // 'smtp' | 'sendgrid_mock' | 'twilio_mock' | 'razorpay_mock'
  config:      text("config").notNull(), // JSON string of provider-specific settings
  isEnabled:   boolean("is_enabled").notNull().default(false),
  createdBy:   uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Table for tracking all mock message sends
export const messageLogs = pgTable("message_logs", {
  id:           uuid("id").defaultRandom().primaryKey(),
  channel:      varchar("channel", { length: 20 }).notNull(), // 'email' | 'whatsapp'
  recipient:    varchar("recipient", { length: 255 }).notNull(),
  subject:      varchar("subject", { length: 500 }),
  body:         text("body").notNull(),
  status:       varchar("status", { length: 20 }).notNull().default("sent"), // 'sent' | 'failed' | 'queued'
  relatedEntity: varchar("related_entity", { length: 50 }), // 'lead' | 'invoice'
  relatedId:    uuid("related_id"),
  sentBy:       uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("message_logs_channel_idx").on(t.channel),
  index("message_logs_entity_idx").on(t.relatedEntity, t.relatedId),
]);

// Per-user feature permission overrides (admin-managed)
export const userPermissions = pgTable("user_permissions", {
  id:          uuid("id").defaultRandom().primaryKey(),
  userId:      uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  permission:  varchar("permission", { length: 100 }).notNull(), // e.g., 'can_send_email', 'can_send_whatsapp', 'can_view_payments', 'can_export_data', 'can_bulk_operations'
  granted:     boolean("granted").notNull().default(false),
  grantedBy:   uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("user_perms_user_idx").on(t.userId),
]);
```

**IMPORTANT:** After adding these tables, also export them from `src/server/db/schema/index.ts` by adding to `billing.ts` exports. Then add the exports alongside the existing type exports at the bottom of `billing.ts`.

### API Routes to Create

**`src/app/api/integrations/route.ts`** — GET (list all configs), POST (upsert config)
- GET: `requireRole(ctx, ["admin"])` → return all integration configs
- POST: `requireRole(ctx, ["admin"])` → validate with Zod, upsert by type+provider, writeAuditLog

**`src/app/api/integrations/test/route.ts`** — POST (test connection)
- `requireRole(ctx, ["admin"])`
- Accept `{ type: "email" | "whatsapp", provider: string }`
- Return mock success: `{ success: true, message: "Connection test passed (mock)" }`
- writeAuditLog with action "INTEGRATION_TEST"

**`src/app/api/messages/send/route.ts`** — POST (send mock email/whatsapp)
- `requireRole(ctx, ["admin", "manager", "agent", "finance"])` (all roles, but check per-user permission)
- Check if the user has `can_send_email` or `can_send_whatsapp` permission in `userPermissions` table
- Check if the relevant integration is enabled in `integrationConfigs`
- Validate: `{ channel, recipient, subject?, body, relatedEntity?, relatedId? }`
- Insert into `messageLogs` with status "sent"
- writeAuditLog with action "MESSAGE_SENT"
- Return `ok({ messageId, status: "sent" })`

**`src/app/api/messages/route.ts`** — GET (list message logs)
- `requireRole(ctx, ["admin", "manager"])`
- Support pagination: `page`, `limit`, `channel` filter
- Return paginated message logs

### Email Config UI (inside the new "Integrations" tab)

Show a card titled "Email Service Configuration" with fields:
- Provider select: "Mock SMTP" | "Mock SendGrid"
- SMTP Host (text input, e.g., "smtp.mock-server.local")
- SMTP Port (number input, default 587)
- Sender Email (text input)
- Sender Name (text input)
- Enable/disable toggle (use the existing toggle switch pattern from Preferences tab)
- "Test Connection" button → calls `/api/integrations/test`
- "Save Configuration" button → calls POST `/api/integrations`

---

## FEATURE 2: WhatsApp Service Integration (Mocked)

### WhatsApp Config UI (same "Integrations" tab, separate card below email)

Card titled "WhatsApp Business Configuration" with fields:
- Provider: "Mock Twilio WhatsApp" | "Mock WhatsApp Business API"
- API Endpoint (text input, e.g., "https://mock-wa.api.local/v1")
- Business Phone Number (text input, e.g., "+91-9876543210")
- Template namespace (text input)
- Enable/disable toggle
- "Test Connection" button
- "Save Configuration" button

### Message Sending UI (add to lead detail and invoice detail pages)

On `src/app/(app)/leads/[id]/page.tsx`:
- Add a "Send Message" dropdown button (next to existing action buttons)
- Options: "Send Email" and "Send WhatsApp" (only if respective integration is enabled)
- Clicking opens a small inline form/modal with: recipient (pre-filled from lead email/phone), subject (for email), body textarea, send button
- On send, POST to `/api/messages/send` with `relatedEntity: "lead"` and `relatedId`

On `src/app/(app)/invoices/[id]/page.tsx`:
- Similar "Send Message" button
- For email: pre-fill subject as "Invoice #{invoiceNumber}" and body with invoice summary
- For WhatsApp: pre-fill body with "Your invoice #{invoiceNumber} for Rs. {totalAmount} is ready."

**IMPORTANT:** Read these pages first before modifying. Only add the send message button — don't restructure the existing page layout or remove any existing functionality.

---

## FEATURE 3: Admin Per-User Permission Management

### What to build
On the `/users` page, when admin clicks a user row or an "Edit Permissions" button, show a panel/modal where the admin can toggle granular permissions for that specific user.

### Available Permissions (defined as constants)

Add to `src/shared/constants.ts` (APPEND only — don't change existing exports):
```typescript
export const USER_PERMISSIONS = [
  { key: "can_send_email", label: "Send Emails", description: "Allow sending emails from leads and invoices", category: "messaging" },
  { key: "can_send_whatsapp", label: "Send WhatsApp", description: "Allow sending WhatsApp messages", category: "messaging" },
  { key: "can_view_payments", label: "View Payment Logs", description: "Access payment transaction history", category: "billing" },
  { key: "can_export_data", label: "Export Data", description: "Export leads, invoices as CSV/PDF", category: "data" },
  { key: "can_bulk_operations", label: "Bulk Operations", description: "Perform bulk updates and deletes", category: "operations" },
  { key: "can_manage_integrations", label: "Manage Integrations", description: "Configure email, WhatsApp, and payment settings", category: "admin" },
  { key: "can_view_audit_logs", label: "View Audit Logs", description: "Access workspace audit trail", category: "admin" },
] as const;
```

### API Routes

**`src/app/api/users/[id]/permissions/route.ts`** — GET and PUT
- GET: `requireRole(ctx, ["admin"])` → return all permissions for the user
- PUT: `requireRole(ctx, ["admin"])` → accept `{ permissions: [{ permission: string, granted: boolean }] }`, upsert each, writeAuditLog with action "USER_PERMISSIONS_UPDATED"

### UI Changes

On `src/app/(app)/users/page.tsx`:
- Add a "Permissions" button on each user row (visible only to admin)
- Clicking opens a slide-out panel or modal showing the user's name and all available permissions as toggle switches
- Group toggles by category (Messaging, Billing, Data, Operations, Admin)
- Each toggle calls PUT `/api/users/[id]/permissions` on change
- Show toast on success

### Settings "User Management" Tab (admin only)

Add a new tab "User Controls" to the settings page (only for admin role). This tab shows:
- A table of all users with columns: Name, Email, Role, Status (Active/Inactive), Permissions count
- Quick toggle to activate/deactivate users (calls existing PUT `/api/users/[id]` with `{ isActive: true/false }`)
- Click a user row → expands to show permission toggles inline

---

## FEATURE 4: Payment Gateway Configuration (Mocked)

### What to build
A "Payments" card inside the "Integrations" tab where admin can configure mock payment gateways.

### Payment Config UI

Card titled "Payment Gateway Configuration":
- Gateway select: "Mock Razorpay" | "Mock Stripe" | "Mock PayU"
- API Key ID (text input, masked)
- API Key Secret (text input, masked with reveal toggle — reuse the webhook secret reveal pattern from Workspace tab)
- Webhook URL (read-only, auto-generated: `{origin}/api/payments/mock-webhook`)
- Currency (select: INR, USD, EUR)
- Enable/disable toggle
- "Test Gateway" button → calls `/api/integrations/test` with type "payment"
- "Save Configuration" button

Store in `integrationConfigs` table with `type: "payment"`.

### Invoice Page Enhancement

On `src/app/(app)/invoices/[id]/page.tsx`, if payment gateway is enabled:
- Show a "Payment Link" section that displays a mock payment URL
- Add "Generate Payment Link" button that creates a mock link (just a formatted string like `https://pay.mock-razorpay.local/inv/{invoiceNumber}`)
- The existing "Process Mock Payment" functionality should still work unchanged

---

## FEATURE 5: Settings Page Tab Restructuring

### Updated Tab Type
```typescript
type TabType = "profile" | "security" | "preferences" | "integrations" | "user-controls" | "workspace";
```

### Tab Visibility Rules
| Tab | Who sees it |
|---|---|
| Profile | Everyone |
| Security | Everyone |
| Preferences | Everyone |
| Integrations | Admin only |
| User Controls | Admin only |
| Workspace | Admin + Manager (unchanged) |

### Tab Icons
Use inline SVG icons matching the existing style (24x24 viewBox, `className="size-4 mr-2"`, stroke-based). Pick appropriate icons:
- Integrations: a plug/link icon
- User Controls: a shield/key icon

---

## IMPLEMENTATION ORDER

1. **Database schema** — Add new tables to `billing.ts`, export from `index.ts`
2. **Constants** — Add `USER_PERMISSIONS` to `constants.ts`
3. **API routes** — Create `/api/integrations/`, `/api/integrations/test/`, `/api/messages/send/`, `/api/messages/`, `/api/users/[id]/permissions/`
4. **Settings page** — Add "Integrations" and "User Controls" tabs to `src/app/(app)/settings/page.tsx`
5. **Lead detail page** — Add "Send Message" button to `src/app/(app)/leads/[id]/page.tsx`
6. **Invoice detail page** — Add "Send Message" button and payment link section to `src/app/(app)/invoices/[id]/page.tsx`
7. **Users page** — Add "Permissions" button to `src/app/(app)/users/page.tsx`
8. **Seed data** — Add default integration configs and default permissions in `src/server/db/seed.ts`

### Seed Data to Add (append to existing seed function — don't replace it)

```typescript
// Default integration configs (all disabled by default)
await db.insert(integrationConfigs).values([
  {
    type: "email",
    provider: "smtp_mock",
    config: JSON.stringify({ host: "smtp.mock-server.local", port: 587, senderEmail: "noreply@businessops.local", senderName: "BusinessOps Portal" }),
    isEnabled: false,
    createdBy: adminUser.id,
  },
  {
    type: "whatsapp",
    provider: "twilio_mock",
    config: JSON.stringify({ endpoint: "https://mock-wa.api.local/v1", phone: "+91-9876543210", namespace: "businessops_templates" }),
    isEnabled: false,
    createdBy: adminUser.id,
  },
  {
    type: "payment",
    provider: "razorpay_mock",
    config: JSON.stringify({ keyId: "rzp_mock_xxxxxxxxxxxxx", currency: "INR" }),
    isEnabled: false,
    createdBy: adminUser.id,
  },
]);

// Default permissions for all seeded users
const defaultPermissions = [
  // Admin gets everything
  ...USER_PERMISSIONS.map(p => ({ userId: adminUser.id, permission: p.key, granted: true, grantedBy: adminUser.id })),
  // Manager gets messaging + data
  ...["can_send_email", "can_send_whatsapp", "can_view_payments", "can_export_data", "can_bulk_operations", "can_view_audit_logs"]
    .map(p => ({ userId: managerUser.id, permission: p, granted: true, grantedBy: adminUser.id })),
  // Agents get basic messaging
  ...["can_send_email", "can_send_whatsapp"]
    .map(p => ({ userId: agent1User.id, permission: p, granted: true, grantedBy: adminUser.id })),
  ...["can_send_email"]
    .map(p => ({ userId: agent2User.id, permission: p, granted: true, grantedBy: adminUser.id })),
  // Finance gets billing-related
  ...["can_send_email", "can_view_payments", "can_export_data"]
    .map(p => ({ userId: financeUser.id, permission: p, granted: true, grantedBy: adminUser.id })),
];
await db.insert(userPermissions).values(defaultPermissions);

// Sample message logs
await db.insert(messageLogs).values([
  {
    channel: "email",
    recipient: "neha.sharma@techcorp.com",
    subject: "Follow-up on Your Consultation Request",
    body: "Dear Neha, Thank you for your interest in our consulting services...",
    status: "sent",
    relatedEntity: "lead",
    relatedId: leads[0].id, // reference first seeded lead
    sentBy: agent1User.id,
  },
  {
    channel: "whatsapp",
    recipient: "+91-9876543210",
    subject: null,
    body: "Hi Rahul, your invoice INV-2025-001 for Rs. 45,000 is ready. Please check your email for details.",
    status: "sent",
    relatedEntity: "invoice",
    relatedId: invoices[0].id, // reference first seeded invoice
    sentBy: financeUser.id,
  },
]);
```

---

## STYLING GUIDELINES

- Use Tailwind classes consistent with existing code: `bg-white`, `border-gray-200/80`, `shadow-sm`, `rounded-lg`, `text-sm`, `text-gray-500`, `text-gray-900`, `font-medium`, `font-semibold`, etc.
- Cards use: `<Card className="shadow-sm border-gray-200/80 bg-white">`
- Card headers use: `<CardHeader className="border-b border-gray-100 p-5">`
- Card body uses: `<CardBody className="p-5">`
- Form grids use: `<div className="grid gap-4 sm:grid-cols-2">` or `sm:grid-cols-3`
- Save buttons are right-aligned: `<div className="flex justify-end pt-4 border-t border-gray-100">`
- Badge colors follow the pattern already in settings: `border-{color}-200 bg-{color}-50 text-{color}-700`
- Section descriptions use: `<p className="text-xs text-gray-400">description text</p>`

---

## TESTING CHECKLIST

After implementation, verify:
1. All existing functionality still works (login, leads CRUD, invoices, follow-ups, dashboard, file upload, audit logs)
2. Existing API routes return same response shapes
3. New tabs appear only for correct roles
4. Integration configs save and load correctly
5. Mock message sends create entries in message_logs table
6. Per-user permissions can be toggled by admin
7. Permission checks work — user without `can_send_email` gets 403 when trying to send email
8. Seed data runs without errors
9. No TypeScript errors (`npx tsc --noEmit`)
10. No new ESLint errors
11. The app builds successfully (`npm run build`)

---

## DATABASE MIGRATION

After adding the new tables, generate and run the Drizzle migration:
```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

Then re-run the seed if needed:
```bash
npx tsx src/server/db/seed.ts
```

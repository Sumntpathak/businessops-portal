# Folder Structure Refactoring - Visual Guide

## Side-by-Side Comparison

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT (Score: 5/10 - Incomplete)           RECOMMENDED (Score: 9/10 - Professional)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

src/                                         src/
├── app/                                     ├── app/
│   ├── (auth)/          ✅                  │   ├── (auth)/
│   │   └── login/                           │   │   ├── login/
│   │   └── register/                        │   │   ├── register/
│   │                                        │   │   └── layout.tsx        [NEW]
│   ├── (app)/           ⚠️ CONFUSING        │   ├── (workspace)/         [RENAMED]
│   │   ├── dashboard/                       │   │   ├── dashboard/
│   │   └── layout.tsx                       │   │   ├── leads/
│   ├── api/             ⚠️ MESSY            │   │   ├── invoices/
│   │   ├── auth/                            │   │   ├── users/
│   │   ├── login/                           │   │   └── layout.tsx
│   │   ├── logout/                          │   ├── api/                 [ORGANIZED]
│   │   ├── me/                              │   │   ├── v1/              [NEW: Versioning]
│   │   └── register/                        │   │   │   ├── auth/
│   └── page.tsx                             │   │   │   ├── leads/
│                                            │   │   │   ├── invoices/
├── components/          ⚠️ SPARSE           │   │   │   └── health/
│   └── layout/                              │   │   └── webhooks/        [NEW]
│       └── Sidebar.tsx                      │   │       └── payment/
│                                            │   ├── not-found.tsx        [NEW]
├── db/                  ✅                  │   ├── error.tsx            [NEW]
│   ├── client.ts                            │   └── page.tsx
│   ├── seed.ts          ⚠️ UNSTRUCTURED    │
│   └── schema/                              ├── components/              [EXPANDED]
│       ├── index.ts                         │   ├── ui/                  [NEW]
│       ├── users.ts                         │   │   ├── Button.tsx
│       ├── leads.ts                         │   │   ├── Input.tsx
│       └── ...                              │   │   ├── Card.tsx
│                                            │   │   ├── Badge.tsx
├── lib/                 ⚠️ INCOMPLETE       │   │   ├── Table.tsx
│   ├── auth/            ✅ GOOD             │   │   ├── Modal.tsx
│   ├── api/             ✅ GOOD             │   │   └── index.ts
│   └── ... [Missing services, hooks,       │   ├── layout/
│       types, utils, constants]             │   │   ├── Sidebar.tsx
│                                            │   │   ├── Header.tsx
├── middleware.ts        ✅                  │   │   ├── MainLayout.tsx
└── ...                                      │   │   └── AuthLayout.tsx
                                             │   ├── features/            [NEW]
                                             │   │   ├── leads/
                                             │   │   │   ├── LeadCard.tsx
                                             │   │   │   ├── LeadForm.tsx
                                             │   │   │   └── index.ts
                                             │   │   ├── invoices/
                                             │   │   └── users/
                                             │   └── common/             [NEW]
                                             │       ├── ProtectedRoute.tsx
                                             │       ├── ErrorBoundary.tsx
                                             │       └── LoadingSpinner.tsx
                                             │
                                             ├── db/                     [EXPANDED]
                                             │   ├── client.ts
                                             │   ├── seeds/             [NEW]
                                             │   │   ├── initial.ts
                                             │   │   └── dev.ts
                                             │   ├── scripts/           [NEW]
                                             │   │   └── migrate.ts
                                             │   └── schema/
                                             │       ├── index.ts
                                             │       ├── user.ts
                                             │       ├── lead.ts
                                             │       └── ...
                                             │
                                             ├── lib/                    [REORGANIZED]
                                             │   ├── auth/
                                             │   │   ├── index.ts
                                             │   │   ├── jwt.ts
                                             │   │   ├── session.ts
                                             │   │   ├── rbac.ts
                                             │   │   └── cookies.ts
                                             │   ├── api/
                                             │   │   ├── index.ts
                                             │   │   ├── response.ts
                                             │   │   ├── errors.ts       [NEW]
                                             │   │   ├── validators.ts   [NEW]
                                             │   │   └── context.ts
                                             │   ├── db/                 [NEW]
                                             │   │   ├── queries.ts
                                             │   │   └── transactions.ts
                                             │   ├── services/           [NEW]
                                             │   │   ├── LeadService.ts
                                             │   │   ├── InvoiceService.ts
                                             │   │   └── AuditService.ts
                                             │   ├── hooks/              [NEW]
                                             │   │   ├── useAuth.ts
                                             │   │   ├── useFetch.ts
                                             │   │   └── useForm.ts
                                             │   ├── utils/              [NEW]
                                             │   │   ├── formatters.ts
                                             │   │   ├── validators.ts
                                             │   │   └── date.ts
                                             │   ├── types/              [NEW]
                                             │   │   ├── entities.ts
                                             │   │   ├── api.ts
                                             │   │   ├── auth.ts
                                             │   │   ├── forms.ts
                                             │   │   └── index.ts
                                             │   ├── constants.ts        [NEW]
                                             │   └── index.ts
                                             │
                                             ├── middleware.ts
                                             ├── config.ts              [NEW]
                                             └── ...
```

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PRESENTATION LAYER                          │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Pages (src/app/(workspace)/*)                                    ││
│ │ - Handle routing, authentication redirect                        ││
│ │ - Call services and pass data to components                      ││
│ └──────────────────────────────────────────────────────────────────┘│
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Components (src/components/*/*)                                  ││
│ │ - UI Primitives (Button, Input, Card)                            ││
│ │ - Feature Components (LeadForm, InvoiceList)                     ││
│ │ - Layout Components (Sidebar, Header)                            ││
│ └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         APPLICATION LAYER                           │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Services (src/lib/services/*)                                    ││
│ │ - LeadService: create, update, list, delete leads                ││
│ │ - InvoiceService: calculate totals, generate PDFs                ││
│ │ - AuditService: log actions                                      ││
│ │                                                                  ││
│ │ Hooks (src/lib/hooks/*)                                          ││
│ │ - useAuth: Get current session                                   ││
│ │ - useFetch: Wrapped fetch with error handling                    ││
│ │ - useForm: Form state management                                 ││
│ │                                                                  ││
│ │ API Client Layer (src/lib/api/*)                                 ││
│ │ - response.ts: Standardize all API responses                     ││
│ │ - errors.ts: Custom error classes                                ││
│ │ - validators.ts: Zod schemas for inputs                          ││
│ └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      API/BACKEND LAYER                              │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ API Routes (src/app/api/v1/*/route.ts)                           ││
│ │ - Authentication endpoints                                       ││
│ │ - CRUD endpoints for entities                                    ││
│ │ - Webhook handlers                                               ││
│ │                                                                  ││
│ │ RBAC Middleware                                                  ││
│ │ - Enforce role-based access control                              ││
│ └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       DATA ACCESS LAYER                             │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ Database Queries (src/lib/db/queries.ts)                         ││
│ │ - Helper functions for common queries                            ││
│ │ - Transaction management                                         ││
│ │                                                                  ││
│ │ Drizzle ORM Client (src/db/client.ts)                            ││
│ │ - Database connection                                            ││
│ │                                                                  ││
│ │ Schema Definitions (src/db/schema/*)                             ││
│ │ - Table definitions using Drizzle                                ││
│ └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     DATABASE LAYER                                  │
│               PostgreSQL (Neon Serverless)                          │
└─────────────────────────────────────────────────────────────────────┘
```

## File Organization Examples

### BEFORE: Scattered API Routes
```
src/app/api/
├── auth/
│   ├── login/route.ts          ← No version
│   ├── logout/route.ts
│   ├── me/route.ts
│   └── register/route.ts
└── (other routes scattered?)
```

### AFTER: Organized by Version & Domain
```
src/app/api/
├── v1/
│   ├── auth/
│   │   ├── route.ts            ← POST /api/v1/auth (register or general)
│   │   ├── login/route.ts      ← POST /api/v1/auth/login
│   │   ├── logout/route.ts     ← POST /api/v1/auth/logout
│   │   └── me/route.ts         ← GET /api/v1/auth/me
│   ├── leads/
│   │   ├── route.ts            ← GET /api/v1/leads, POST create
│   │   ├── [id]/route.ts       ← GET/PUT/DELETE individual lead
│   │   └── [id]/followups/route.ts
│   ├── invoices/
│   │   ├── route.ts
│   │   └── [id]/route.ts
│   ├── users/
│   │   ├── route.ts
│   │   └── [id]/route.ts
│   ├── audit/route.ts
│   └── health/route.ts         ← Status check endpoint
├── v2/ (future)
│   └── ...
└── webhooks/
    ├── payment/route.ts        ← External webhook handlers
    └── email/route.ts
```

## Type Definitions Organization

### BEFORE: Types Scattered
```typescript
// In seed.ts
type UserRole = "admin" | "manager" | ...;

// In jwt.ts
interface JWTPayload { ... }

// In response.ts
type ApiResponse<T> = { ... }

// Various other files...
```

### AFTER: Centralized Types
```
src/lib/types/
├── index.ts                    ← Re-export all
├── entities.ts                 ← Domain models (User, Lead, Invoice)
├── api.ts                      ← API request/response types
├── auth.ts                     ← Auth-specific types
├── forms.ts                    ← Form state types
└── errors.ts                   ← Custom error types

// Usage
import type { User, Lead } from "@/lib/types";
import type { ApiResponse, PaginatedResponse } from "@/lib/types/api";
```

## Constants Organization

### BEFORE: Constants Scattered
```typescript
// In middleware.ts
const PUBLIC_PATHS = [...];
const ROLE_ALLOWED_PREFIXES = {...};

// In jwt.ts
const ALGORITHM = "HS256";
const EXPIRES_IN = "8h";

// In seed.ts
const today = new Date();
```

### AFTER: Centralized Constants
```
src/lib/constants.ts

export const ROLES = ["admin", "manager", "agent", "finance"] as const;
export type Role = typeof ROLES[number];

export const LEAD_STATUSES = ["New", "Contacted", "Converted", ...] as const;
export const INVOICE_STATUSES = ["Draft", "Sent", "Paid", ...] as const;

export const ROUTES = {
  PUBLIC: ["/login", "/register"],
  ROLE_ACCESS: {
    admin: ["/dashboard", "/users", "/audit-logs"],
    manager: ["/dashboard", "/leads", "/invoices"],
    // ...
  },
} as const;

export const AUTH = {
  COOKIE_NAME: "bops_token",
  JWT_EXPIRES_IN: "8h",
  JWT_ALGORITHM: "HS256",
} as const;

// Usage
import { ROLES, AUTH, LEAD_STATUSES } from "@/lib/constants";
```

## Migration Checklist

- [ ] Create `src/lib/types/` directory
- [ ] Create `src/lib/constants.ts`
- [ ] Create `src/lib/services/` directory
- [ ] Create `src/lib/hooks/` directory
- [ ] Create `src/lib/utils/` directory
- [ ] Create `src/components/ui/` directory
- [ ] Create `src/components/features/` directory
- [ ] Create `src/components/common/` directory
- [ ] Rename `src/app/(app)/` to `src/app/(workspace)/`
- [ ] Create `src/app/api/v1/` directory structure
- [ ] Move API routes to v1 structure
- [ ] Create error classes in `src/lib/api/errors.ts`
- [ ] Create Zod validation schemas
- [ ] Update all imports in existing files
- [ ] Update `tsconfig.json` path aliases if needed
- [ ] Test the application thoroughly
- [ ] Update documentation

## Path Aliases (Update tsconfig.json)

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@/app/*": ["./src/app/*"],
      "@/components/*": ["./src/components/*"],
      "@/lib/*": ["./src/lib/*"],
      "@/db/*": ["./src/db/*"],
      "@/types/*": ["./src/lib/types/*"],
      "@/services/*": ["./src/lib/services/*"],
      "@/hooks/*": ["./src/lib/hooks/*"],
      "@/utils/*": ["./src/lib/utils/*"],
      "@/constants": ["./src/lib/constants"]
    }
  }
}
```

---

## Implementation Order

1. **Step 1:** Create all new directories (lib/types, lib/services, etc.)
2. **Step 2:** Create type definitions and constants
3. **Step 3:** Move existing code to new locations
4. **Step 4:** Create component library (UI components)
5. **Step 5:** Create services layer
6. **Step 6:** Organize API routes with versioning
7. **Step 7:** Update imports across the codebase
8. **Step 8:** Test and validate

---


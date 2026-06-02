# Production Issues

## Critical

1. JWT claims are trusted for the full 8h token window without server-side session or user-status revalidation.
   - File: `src/middleware.ts`
   - Fix: Store a session id/user version in the JWT and validate it against durable server state on every protected request.

2. Demo credentials are rendered in the production login UI.
   - File: `src/app/(auth)/login/page.tsx`
   - Fix: Hide demo credentials unless an explicit demo-mode environment flag is enabled.

## High

1. Login has no rate limiting, lockout, or abuse protection.
   - File: `src/app/api/auth/login/route.ts`
   - Fix: Add IP and email-based throttling with exponential backoff.

2. Lead writes split authorization reads from mutations.
   - File: `src/features/leads/server/lead.repository.ts`
   - Fix: Put ownership predicates in the update/delete `WHERE` clause or wrap the read/write in a transaction.

3. Follow-up writes split authorization reads from mutations.
   - File: `src/features/follow-ups/server/follow-up.repository.ts`
   - Fix: Update follow-ups through a lead ownership predicate or transaction.

4. API auth context trusts middleware-injected headers without local schema validation.
   - File: `src/server/http/request-context.ts`
   - Fix: Validate internal headers or derive context from the signed auth cookie inside route handlers.

5. Payment webhook support is missing even though payment tables and secrets are documented.
   - File: `src/server/db/schema/billing.ts`
   - Fix: Add a webhook route with HMAC/timestamp verification, replay protection, and transaction idempotency.

6. Security headers are missing.
   - File: `next.config.ts`
   - Fix: Add CSP, HSTS, frame, referrer, and MIME-sniffing protections.

## Medium

1. Auth cookies use `SameSite=Lax`.
   - File: `src/server/auth/cookies.ts`
   - Fix: Use `SameSite=Strict` unless a documented cross-site flow requires Lax.

2. Follow-up ownership is enforced by controllers instead of the follow-up service.
   - File: `src/features/follow-ups/server/follow-up.service.ts`
   - Fix: Move lead ownership checks into the service.

3. Agent follow-up listing loads all assigned lead ids into memory.
   - File: `src/features/follow-ups/server/follow-up.repository.ts`
   - Fix: Replace the `inArray` pattern with a join against `leads`.

4. Lead search uses leading-wildcard `ILIKE` without search indexes.
   - File: `src/features/leads/server/lead.repository.ts`
   - Fix: Add trigram or full-text indexes.

5. Lead assignment accepts any user UUID.
   - File: `src/features/leads/server/lead.service.ts`
   - Fix: Validate `assignedTo` is an active agent.

6. Deprecated schema files drift from the live schema barrel.
   - File: `src/server/db/schema/users.ts`
   - Fix: Delete deprecated schema files or make them re-export from the live schema modules.

7. Audit writes are fire-and-forget.
   - File: `src/server/audit/audit-log.ts`
   - Fix: Persist security audit events synchronously or use a durable outbox.

8. Client fetch hooks have stale-response race conditions and lint failures.
   - File: `src/features/leads/useLeads.ts`
   - Fix: Use `AbortController` or request ids and satisfy React hook lint rules.

9. Lead detail handles `404` but not `403`.
   - File: `src/app/(app)/leads/[id]/page.tsx`
   - Fix: Render an explicit forbidden/access-denied state.

10. Sidebar links point to missing product areas.
    - File: `src/shared/layout/AppSidebar.tsx`
    - Fix: Build invoices, users, audit logs, and settings or hide the links.

## Low

1. Confirm dialog lacks dialog ARIA and focus management.
   - File: `src/shared/ui/ConfirmDialog.tsx`
   - Fix: Use an accessible dialog primitive or add role, labels, focus trap, and Escape handling.

2. Toast close button has no accessible label.
   - File: `src/shared/ui/Toast.tsx`
   - Fix: Add `aria-label="Dismiss notification"`.

3. Agents see delete actions they cannot use.
   - File: `src/features/leads/components/LeadTable.tsx`
   - Fix: Hide destructive actions by role.

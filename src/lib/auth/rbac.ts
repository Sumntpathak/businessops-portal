import { JWTPayload } from "./jwt";
import { AuthError } from "./session";

type Role = JWTPayload["role"];

/**
 * RBAC guard — call inside API route handlers.
 * Throws 403 if role not in allowed list.
 *
 * Usage:
 *   const session = await requireSession();
 *   requireRole(session, ["admin", "manager"]);
 */
export function requireRole(session: JWTPayload, allowed: Role[]) {
  if (!allowed.includes(session.role)) {
    throw new AuthError(403, "Forbidden: insufficient role");
  }
}

/**
 * Role capability matrix — single source of truth.
 */
export const CAN = {
  manageUsers: (role: Role) => role === "admin",
  viewAllLeads: (role: Role) => role === "admin" || role === "manager" || role === "finance",
  assignLeads: (role: Role) => role === "admin" || role === "manager",
  deleteLead: (role: Role) => role === "admin",
  createInvoice: (role: Role) => role === "admin" || role === "manager" || role === "finance",
  markInvoicePaid: (_role: Role) => false, // only mock webhook can do this
  viewAuditLogs: (role: Role) => role === "admin" || role === "manager",
  elevateRole: (_role: Role) => false, // nobody can elevate via API
} as const;

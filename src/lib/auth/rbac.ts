import { AuthError } from "./session";
import { JWTPayload } from "./jwt";

type Role = JWTPayload["role"];

export function requireRole(session: JWTPayload, allowed: Role[]) {
  if (!allowed.includes(session.role)) {
    throw new AuthError(403, "Forbidden: insufficient role");
  }
}

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

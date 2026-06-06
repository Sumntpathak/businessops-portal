export const APP_NAME = "BusinessOps";

export const ROLES = ["admin", "manager", "agent", "finance"] as const;

// COOKIE_NAME lives in src/server/auth/cookies.ts because it switches between
// "bops_token" (dev) and "__Host-bops_token" (prod). Do not duplicate it here.
export const AUTH = {
  JWT_EXPIRES_IN: "8h",
} as const;

export const LEAD_STATUSES = ["New", "Contacted", "Follow-Up", "Converted", "Lost"] as const;

export const INVOICE_STATUSES = ["Draft", "Sent", "Paid", "Cancelled"] as const;

export type Role = (typeof ROLES)[number];

export const USER_PERMISSIONS = [
  { key: "can_send_email", label: "Send Emails", description: "Allow sending emails from leads and invoices", category: "messaging" },
  { key: "can_send_whatsapp", label: "Send WhatsApp", description: "Allow sending WhatsApp messages", category: "messaging" },
  { key: "can_view_payments", label: "View Payment Logs", description: "Access payment transaction history", category: "billing" },
  { key: "can_export_data", label: "Export Data", description: "Export leads, invoices as CSV/PDF", category: "data" },
  { key: "can_bulk_operations", label: "Bulk Operations", description: "Perform bulk updates and deletes", category: "operations" },
  { key: "can_manage_integrations", label: "Manage Integrations", description: "Configure email, WhatsApp, and payment settings", category: "admin" },
  { key: "can_view_audit_logs", label: "View Audit Logs", description: "Access workspace audit trail", category: "admin" },
] as const;

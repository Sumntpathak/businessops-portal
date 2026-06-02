export const APP_NAME = "BusinessOps";

export const ROLES = ["admin", "manager", "agent", "finance"] as const;

export const AUTH = {
  COOKIE_NAME: "bops_token",
  JWT_EXPIRES_IN: "8h",
} as const;

export const LEAD_STATUSES = ["New", "Contacted", "Follow-Up", "Converted", "Lost"] as const;

export const INVOICE_STATUSES = ["Draft", "Sent", "Paid", "Cancelled"] as const;

export type Role = (typeof ROLES)[number];

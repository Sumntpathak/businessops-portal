import { index, integer, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./core";
import { leads } from "./leads-schema";

export const invoiceStatusEnum  = pgEnum("invoice_status",  ["Draft", "Sent", "Paid", "Cancelled"]);
export const paymentStatusEnum  = pgEnum("payment_status",  ["Pending", "Success", "Failed"]);
export const attachmentEntityEnum = pgEnum("attachment_entity", ["lead", "invoice"]);

/** All monetary values: numeric(12,2) — no float precision issues. */
export const invoices = pgTable("invoices", {
  id:            uuid("id").defaultRandom().primaryKey(),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull().unique(),
  leadId:        uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  clientName:    varchar("client_name", { length: 255 }).notNull(),
  subtotal:      numeric("subtotal",      { precision: 12, scale: 2 }).notNull().default("0"),
  taxPercentage: numeric("tax_percentage",{ precision: 5,  scale: 2 }).notNull().default("0"),
  taxAmount:     numeric("tax_amount",    { precision: 12, scale: 2 }).notNull().default("0"),
  discount:      numeric("discount",      { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount:   numeric("total_amount",  { precision: 12, scale: 2 }).notNull().default("0"),
  status:        invoiceStatusEnum("status").notNull().default("Draft"),
  createdBy:     uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("invoices_status_idx").on(t.status),
  index("invoices_lead_id_idx").on(t.leadId),
]);

export const invoiceItems = pgTable("invoice_items", {
  id:          uuid("id").defaultRandom().primaryKey(),
  invoiceId:   uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  quantity:    integer("quantity").notNull(),
  unitPrice:   numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  lineTotal:   numeric("line_total",  { precision: 12, scale: 2 }).notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Immutable payment event log. transactionId has unique constraint for idempotency. */
export const paymentLogs = pgTable("payment_logs", {
  id:             uuid("id").defaultRandom().primaryKey(),
  invoiceId:      uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  provider:       varchar("provider", { length: 100 }).notNull().default("mock"),
  transactionId:  varchar("transaction_id", { length: 255 }).unique(), // unique for idempotency
  amount:         numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status:         paymentStatusEnum("status").notNull(),
  webhookPayload: text("webhook_payload"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("payment_logs_invoice_idx").on(t.invoiceId),
]);

export const fileAttachments = pgTable("file_attachments", {
  id:            uuid("id").defaultRandom().primaryKey(),
  entityType:    attachmentEntityEnum("entity_type").notNull(),
  entityId:      uuid("entity_id").notNull(),
  fileName:      varchar("file_name", { length: 500 }).notNull(),
  fileUrl:       varchar("file_url", { length: 1000 }).notNull(),
  fileType:      varchar("file_type", { length: 50 }).notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  uploadedBy:    uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("attachments_entity_idx").on(t.entityType, t.entityId),
]);

export type Invoice     = typeof invoices.$inferSelect;
export type NewInvoice  = typeof invoices.$inferInsert;
export type InvoiceItem    = typeof invoiceItems.$inferSelect;
export type NewInvoiceItem = typeof invoiceItems.$inferInsert;
export type PaymentLog    = typeof paymentLogs.$inferSelect;
export type NewPaymentLog = typeof paymentLogs.$inferInsert;
export type FileAttachment    = typeof fileAttachments.$inferSelect;
export type NewFileAttachment = typeof fileAttachments.$inferInsert;

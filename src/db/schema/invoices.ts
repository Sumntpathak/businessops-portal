import {
  pgTable,
  uuid,
  varchar,
  numeric,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { leads } from "./leads";
import { users } from "./users";

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "Draft",
  "Sent",
  "Paid",
  "Cancelled",
]);

export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull().unique(),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  // All monetary values stored as numeric(12,2) — no float precision issues
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxPercentage: numeric("tax_percentage", { precision: 5, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  status: invoiceStatusEnum("status").notNull().default("Draft"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id")
    .references(() => invoices.id, { onDelete: "cascade" })
    .notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type NewInvoiceItem = typeof invoiceItems.$inferInsert;

import { pgTable, uuid, varchar, text, numeric, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { invoices } from "./invoices";

export const paymentStatusEnum = pgEnum("payment_status", [
  "Pending",
  "Success",
  "Failed",
]);

export const paymentLogs = pgTable("payment_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id")
    .references(() => invoices.id, { onDelete: "cascade" })
    .notNull(),
  provider: varchar("provider", { length: 100 }).notNull().default("mock"),
  transactionId: varchar("transaction_id", { length: 255 }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: paymentStatusEnum("status").notNull(),
  webhookPayload: text("webhook_payload"), // raw JSON string
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PaymentLog = typeof paymentLogs.$inferSelect;
export type NewPaymentLog = typeof paymentLogs.$inferInsert;

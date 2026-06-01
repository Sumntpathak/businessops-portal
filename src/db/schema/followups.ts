import { pgTable, uuid, text, date, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { leads } from "./leads";
import { users } from "./users";

export const followUpStatusEnum = pgEnum("followup_status", [
  "Pending",
  "Completed",
  "Cancelled",
]);

export const followups = pgTable("followups", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id")
    .references(() => leads.id, { onDelete: "cascade" })
    .notNull(),
  followUpDate: date("follow_up_date").notNull(), // stored as UTC date string YYYY-MM-DD
  message: text("message").notNull(),
  status: followUpStatusEnum("status").notNull().default("Pending"),
  createdBy: uuid("created_by")
    .references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FollowUp = typeof followups.$inferSelect;
export type NewFollowUp = typeof followups.$inferInsert;

import { date, index, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./core";

export const leadStatusEnum  = pgEnum("lead_status",  ["New", "Contacted", "Follow-Up", "Converted", "Lost"]);
export const leadSourceEnum  = pgEnum("lead_source",  ["Website", "Referral", "Cold Call", "Social Media", "Email Campaign", "Walk-In", "Other"]);
export const followUpStatusEnum = pgEnum("followup_status", ["Pending", "Completed", "Cancelled"]);

export const leads = pgTable("leads", {
  id:         uuid("id").defaultRandom().primaryKey(),
  name:       varchar("name", { length: 255 }).notNull(),
  email:      varchar("email", { length: 255 }).notNull(),
  phone:      varchar("phone", { length: 50 }),
  company:    varchar("company", { length: 255 }),
  source:     leadSourceEnum("source").notNull().default("Other"),
  status:     leadStatusEnum("status").notNull().default("New"),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  notes:      text("notes"),
  createdBy:  uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("leads_assigned_to_idx").on(t.assignedTo),
  index("leads_status_idx").on(t.status),
  index("leads_created_at_idx").on(t.createdAt),
]);

/** Timezone: followUpDate stored as UTC YYYY-MM-DD string. */
export const followups = pgTable("followups", {
  id:           uuid("id").defaultRandom().primaryKey(),
  leadId:       uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
  followUpDate: date("follow_up_date").notNull(),
  message:      text("message").notNull(),
  status:       followUpStatusEnum("status").notNull().default("Pending"),
  createdBy:    uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("followups_lead_id_idx").on(t.leadId),
  index("followups_date_idx").on(t.followUpDate),
  index("followups_status_idx").on(t.status),
]);

export type Lead      = typeof leads.$inferSelect;
export type NewLead   = typeof leads.$inferInsert;
export type FollowUp    = typeof followups.$inferSelect;
export type NewFollowUp = typeof followups.$inferInsert;

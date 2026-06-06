import { boolean, index, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "manager", "agent", "finance"]);

export const users = pgTable("users", {
  id:           uuid("id").defaultRandom().primaryKey(),
  name:         varchar("name", { length: 255 }).notNull(),
  email:        varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role:         roleEnum("role").notNull().default("agent"),
  isActive:     boolean("is_active").notNull().default(false),
  phone:        varchar("phone", { length: 30 }),
  profileData:  text("profile_data"), // JSON: custom field values keyed by field_key
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Admin-defined custom profile fields shown on every user profile.
 * field_type: text | email | phone | number | select
 * options: JSON string array (only for select type)
 */
export const userFieldDefinitions = pgTable("user_field_definitions", {
  id:        uuid("id").defaultRandom().primaryKey(),
  fieldKey:  varchar("field_key", { length: 50 }).notNull().unique(),
  label:     varchar("label", { length: 100 }).notNull(),
  fieldType: varchar("field_type", { length: 20 }).notNull().default("text"),
  isRequired: boolean("is_required").notNull().default(false),
  options:   text("options"), // JSON string[] — only for select type
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Append-only — never updated or deleted. actorUserId nullable for system events. */
export const auditLogs = pgTable("audit_logs", {
  id:          uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action:      varchar("action", { length: 100 }).notNull(),
  entityType:  varchar("entity_type", { length: 50 }).notNull(),
  entityId:    uuid("entity_id"),
  metadata:    text("metadata"),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("audit_actor_idx").on(t.actorUserId),
  index("audit_entity_idx").on(t.entityType, t.entityId),
]);

export type User    = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserFieldDefinition = typeof userFieldDefinitions.$inferSelect;
export type AuditLog    = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

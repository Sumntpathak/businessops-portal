import { boolean, index, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "manager", "agent", "finance"]);

export const users = pgTable("users", {
  id:           uuid("id").defaultRandom().primaryKey(),
  name:         varchar("name", { length: 255 }).notNull(),
  email:        varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role:         roleEnum("role").notNull().default("agent"),
  isActive:     boolean("is_active").notNull().default(false), // false until admin activates
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
export type AuditLog    = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

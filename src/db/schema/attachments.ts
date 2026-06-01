import { pgTable, uuid, varchar, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";

export const attachmentEntityEnum = pgEnum("attachment_entity", [
  "lead",
  "invoice",
]);

export const fileAttachments = pgTable("file_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: attachmentEntityEnum("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(), // leadId or invoiceId
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileUrl: varchar("file_url", { length: 1000 }).notNull(), // Cloudinary URL
  fileType: varchar("file_type", { length: 50 }).notNull(), // pdf, png, jpg, jpeg
  fileSizeBytes: integer("file_size_bytes").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FileAttachment = typeof fileAttachments.$inferSelect;
export type NewFileAttachment = typeof fileAttachments.$inferInsert;

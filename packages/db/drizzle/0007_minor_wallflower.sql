ALTER TYPE "public"."call_status" ADD VALUE 'transferred';--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "transferred_to_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "transfer_recording_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_transferred_to_staff_id_staff_id_fk" FOREIGN KEY ("transferred_to_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_transferred_to_staff_id_idx" ON "calls" USING btree ("transferred_to_staff_id");
CREATE TYPE "public"."caller_stage" AS ENUM('new', 'interested', 'booked', 'client');--> statement-breakpoint
CREATE TYPE "public"."intake_field_priority" AS ENUM('key', 'optional');--> statement-breakpoint
CREATE TYPE "public"."intake_field_type" AS ENUM('text', 'select', 'boolean', 'number');--> statement-breakpoint
CREATE TABLE "intake_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "intake_field_type" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priority" "intake_field_priority" DEFAULT 'optional' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_fields_sort_check" CHECK ("intake_fields"."sort" >= 0)
);
--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "callers" ADD COLUMN "stage" "caller_stage" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_fields" ADD CONSTRAINT "intake_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_fields_tenant_key_uidx" ON "intake_fields" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "intake_fields_tenant_id_idx" ON "intake_fields" USING btree ("tenant_id");
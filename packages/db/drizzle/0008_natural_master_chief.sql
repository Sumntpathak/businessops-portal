CREATE TYPE "public"."availability_override_kind" AS ENUM('day_hours', 'block', 'add');--> statement-breakpoint
CREATE TABLE "availability_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "availability_override_kind" NOT NULL,
	"date" date NOT NULL,
	"opens" time,
	"closes" time,
	"closed" boolean,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_overrides_day_hours_check" CHECK ("availability_overrides"."kind" <> 'day_hours' OR ("availability_overrides"."closed" IS NOT NULL AND ("availability_overrides"."closed" OR ("availability_overrides"."opens" IS NOT NULL AND "availability_overrides"."closes" IS NOT NULL)))),
	CONSTRAINT "availability_overrides_window_check" CHECK ("availability_overrides"."kind" = 'day_hours' OR ("availability_overrides"."starts_at" IS NOT NULL AND "availability_overrides"."ends_at" IS NOT NULL AND "availability_overrides"."starts_at" < "availability_overrides"."ends_at"))
);
--> statement-breakpoint
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_overrides_tenant_date_idx" ON "availability_overrides" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "availability_overrides_tenant_id_idx" ON "availability_overrides" USING btree ("tenant_id");
CREATE TYPE "public"."callback_request_status" AS ENUM('pending', 'done');--> statement-breakpoint
CREATE TABLE "callback_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"source_call_id" uuid,
	"reason" text DEFAULT '' NOT NULL,
	"preferred_time" text DEFAULT '' NOT NULL,
	"status" "callback_request_status" DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_caller_id_callers_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."callers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_requests" ADD CONSTRAINT "callback_requests_source_call_id_calls_id_fk" FOREIGN KEY ("source_call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "callback_requests_tenant_status_idx" ON "callback_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "callback_requests_tenant_id_idx" ON "callback_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "callback_requests_caller_id_idx" ON "callback_requests" USING btree ("caller_id");
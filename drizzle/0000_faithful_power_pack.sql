CREATE TABLE IF NOT EXISTS "integration_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"provider" varchar(100) NOT NULL,
	"config" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_configs_type_provider_idx" ON "integration_configs" USING btree ("type","provider");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" varchar(20) NOT NULL,
	"recipient" varchar(255) NOT NULL,
	"subject" varchar(500),
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'sent' NOT NULL,
	"related_entity" varchar(50),
	"related_id" uuid,
	"sent_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_logs_channel_idx" ON "message_logs" USING btree ("channel");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_logs_entity_idx" ON "message_logs" USING btree ("related_entity","related_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"permission" varchar(100) NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"granted_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_perms_user_idx" ON "user_permissions" USING btree ("user_id");

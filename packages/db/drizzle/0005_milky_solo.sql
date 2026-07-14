CREATE TABLE "tenant_twilio_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_sid" text NOT NULL,
	"auth_token_ciphertext" text NOT NULL,
	"phone_number_sid" text NOT NULL,
	"webhook_configured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_twilio_credentials" ADD CONSTRAINT "tenant_twilio_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_twilio_credentials_tenant_id_uidx" ON "tenant_twilio_credentials" USING btree ("tenant_id");
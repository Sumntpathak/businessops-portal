import { asc } from "drizzle-orm";
import { schema, withTenant } from "@recepto/db";
import { PageBody, PageHeader, PageShell } from "@/components/dashboard/page-shell";
import { GoogleCalendarIntegration } from "@/components/settings/google-calendar-integration";
import { IntakeFieldsSettings } from "@/components/settings/intake-fields-settings";
import { TwilioIntegration } from "@/components/settings/twilio-integration";
import { requireTenant } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { canManageIntakeFields } from "@/lib/intake-fields";

export default async function SettingsPage() {
  const context = await requireTenant();
  const scoped = withTenant(db, context.tenantId);
  const fields = await db
    .select({
      id: schema.intakeFields.id,
      key: schema.intakeFields.key,
      label: schema.intakeFields.label,
      type: schema.intakeFields.type,
      options: schema.intakeFields.options,
      priority: schema.intakeFields.priority,
      active: schema.intakeFields.active
    })
    .from(schema.intakeFields)
    .where(scoped.where(schema.intakeFields))
    .orderBy(asc(schema.intakeFields.sort));

  return (
    <PageShell>
      <PageHeader eyebrow="Settings" title="Business settings">
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Configure caller intake and the services Recepto uses for availability and bookings.
        </p>
      </PageHeader>
      <PageBody className="space-y-8">
        <TwilioIntegration />
        <IntakeFieldsSettings
          fields={fields}
          canEdit={canManageIntakeFields(context.tenant.role)}
        />
        <GoogleCalendarIntegration />
      </PageBody>
    </PageShell>
  );
}

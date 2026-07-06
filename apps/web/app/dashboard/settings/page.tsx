import { asc } from "drizzle-orm";
import { schema, withTenant } from "@recepto/db";
import { GoogleCalendarIntegration } from "@/components/settings/google-calendar-integration";
import { IntakeFieldsSettings } from "@/components/settings/intake-fields-settings";
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
    <section>
      <p className="text-sm text-muted-foreground">Settings</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Business settings</h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Configure caller intake and the services Recepto uses for availability and bookings.
      </p>
      <div className="mt-8 space-y-8">
        <IntakeFieldsSettings
          fields={fields}
          canEdit={canManageIntakeFields(context.tenant.role)}
        />
        <GoogleCalendarIntegration />
      </div>
    </section>
  );
}
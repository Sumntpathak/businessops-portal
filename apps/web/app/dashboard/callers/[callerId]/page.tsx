import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { schema, withTenant } from "@recepto/db";
import { requireTenant } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { resolveDisplayedCountry } from "@/lib/intake-fields";

export default async function CallerDetailPage({ params }: { params: { callerId: string } }) {
  const parsed = z.string().uuid().safeParse(params.callerId);
  if (!parsed.success) notFound();

  const context = await requireTenant();
  const scoped = withTenant(db, context.tenantId);
  const [[caller], fields] = await Promise.all([
    db
      .select({
        id: schema.callers.id,
        displayName: schema.callers.displayName,
        phoneE164: schema.callers.phoneE164,
        country: schema.callers.country,
        timezone: schema.callers.timezone,
        profile: schema.callers.profile,
        stage: schema.callers.stage
      })
      .from(schema.callers)
      .where(scoped.where(schema.callers, eq(schema.callers.id, parsed.data)))
      .limit(1),
    db
      .select({
        key: schema.intakeFields.key,
        label: schema.intakeFields.label,
        type: schema.intakeFields.type
      })
      .from(schema.intakeFields)
      .where(scoped.where(schema.intakeFields, eq(schema.intakeFields.active, true)))
      .orderBy(asc(schema.intakeFields.sort))
  ]);
  if (!caller) notFound();

  const displayedCountry = resolveDisplayedCountry(
    caller.profile,
    fields.map((field) => field.key),
    caller.country
  );

  return (
    <section className="mx-auto max-w-4xl">
      <Link href="/dashboard/callers" className="text-sm text-muted-foreground hover:text-foreground">? Back to callers</Link>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Caller profile</p>
          <h1 className="mt-2 text-3xl font-semibold">{caller.displayName ?? "Unknown caller"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{caller.phoneE164}</p>
        </div>
        <span className="rounded-full border px-3 py-1.5 text-sm capitalize">{caller.stage}</span>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border p-5">
          <h2 className="font-semibold">System geography</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div><dt className="text-muted-foreground">Display country</dt><dd className="mt-1">{displayedCountry ?? "Not known"}</dd></div>
            <div><dt className="text-muted-foreground">Phone-derived country</dt><dd className="mt-1">{caller.country ?? "Not known"}</dd></div>
            <div><dt className="text-muted-foreground">Booking timezone</dt><dd className="mt-1">{caller.timezone ?? "Uses business timezone"}</dd></div>
          </dl>
        </section>
        <section className="rounded-xl border p-5">
          <h2 className="font-semibold">Intake details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            {fields.map((field) => {
              const value = caller.profile[field.key];
              return (
                <div key={field.key}>
                  <dt className="text-muted-foreground">{field.label}</dt>
                  <dd className={"mt-1 " + (value === undefined || value === "" ? "italic text-muted-foreground" : "")}>
                    {value === undefined || value === "" ? "Not yet known" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
                  </dd>
                </div>
              );
            })}
            {fields.length === 0 && <p className="text-muted-foreground">No active intake fields.</p>}
          </dl>
        </section>
      </div>
    </section>
  );
}

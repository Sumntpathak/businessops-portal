import { addDays, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { and, asc, count, eq, gte, isNull, lt } from "drizzle-orm";
import { schema, withTenant } from "@recepto/db";
import { requireTenant } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

export default async function DashboardPage() {
  const context = await requireTenant();
  const [tenant] = await db
    .select({
      status: schema.tenants.status,
      timezone: schema.tenants.timezone
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, context.tenantId))
    .limit(1);

  const timezone = tenant?.timezone ?? "Asia/Kolkata";
  const now = new Date();
  const localStart = startOfDay(toZonedTime(now, timezone));
  const dayStart = fromZonedTime(localStart, timezone);
  const dayEnd = fromZonedTime(addDays(localStart, 1), timezone);
  const scoped = withTenant(db, context.tenantId);

  const [callCountRows, bookingCountRows, upcoming] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.calls)
      .where(
        scoped.where(
          schema.calls,
          and(
            gte(schema.calls.startedAt, dayStart),
            lt(schema.calls.startedAt, dayEnd)
          )
        )
      ),
    db
      .select({ value: count() })
      .from(schema.bookings)
      .where(
        scoped.where(
          schema.bookings,
          and(
            gte(schema.bookings.startsAt, dayStart),
            lt(schema.bookings.startsAt, dayEnd),
            isNull(schema.bookings.deletedAt)
          )
        )
      ),
    db
      .select({
        id: schema.bookings.id,
        startsAt: schema.bookings.startsAt,
        serviceName: schema.services.name,
        callerName: schema.callers.displayName,
        callerPhone: schema.callers.phoneE164
      })
      .from(schema.bookings)
      .innerJoin(
        schema.services,
        and(
          eq(schema.bookings.serviceId, schema.services.id),
          eq(schema.services.tenantId, context.tenantId)
        )
      )
      .innerJoin(
        schema.callers,
        and(
          eq(schema.bookings.callerId, schema.callers.id),
          eq(schema.callers.tenantId, context.tenantId)
        )
      )
      .where(
        scoped.where(
          schema.bookings,
          and(
            eq(schema.bookings.status, "confirmed"),
            gte(schema.bookings.startsAt, now),
            isNull(schema.bookings.deletedAt)
          )
        )
      )
      .orderBy(asc(schema.bookings.startsAt))
      .limit(5)
  ]);

  const cards = [
    { label: "Tenant status", value: tenant?.status ?? "onboarding" },
    { label: "Calls today", value: String(callCountRows[0]?.value ?? 0) },
    { label: "Bookings today", value: String(bookingCountRows[0]?.value ?? 0) }
  ];

  return (
    <section>
      <p className="text-sm text-muted-foreground">Dashboard</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Good to see you, {context.user.name}.
      </h1>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <article key={card.label} className="rounded-xl border bg-muted/10 p-5">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="mt-3 text-2xl font-semibold capitalize">{card.value}</p>
          </article>
        ))}
      </div>

      <section className="mt-8 rounded-xl border">
        <div className="border-b p-5">
          <h2 className="text-lg font-semibold">Upcoming bookings</h2>
          <p className="mt-1 text-sm text-muted-foreground">Next five confirmed appointments.</p>
        </div>
        {upcoming.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No upcoming bookings yet.
          </p>
        ) : (
          <div className="divide-y">
            {upcoming.map((booking) => (
              <div key={booking.id} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-medium">{booking.serviceName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {booking.callerName ?? booking.callerPhone}
                  </p>
                </div>
                <time className="text-right text-sm">
                  {new Intl.DateTimeFormat("en-IN", {
                    timeZone: timezone,
                    dateStyle: "medium",
                    timeStyle: "short"
                  }).format(booking.startsAt)}
                </time>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

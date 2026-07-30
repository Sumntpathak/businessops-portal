import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { createBookingSchema, weekQuerySchema } from "@/lib/booking-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { availabilityService, calendarService } from "@/lib/calendar";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = weekQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "weekStart must use YYYY-MM-DD.", 400);
  }

  const tenantId = auth.context.tenantId;
  const scoped = withTenant(db, tenantId);
  const [tenant] = await db
    .select({ timezone: schema.tenants.timezone })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  if (!tenant) return apiError("TENANT_NOT_FOUND", "Business not found.", 404);
  const timezone = tenant.timezone;
  const weekStart = fromZonedTime(`${parsed.data.weekStart}T00:00:00`, timezone);
  const weekEnd = addDays(weekStart, 7);

  try {
    const [bookings, services] = await Promise.all([
      db
        .select({
          id: schema.bookings.id,
          startsAt: schema.bookings.startsAt,
          endsAt: schema.bookings.endsAt,
          status: schema.bookings.status,
          notes: schema.bookings.notes,
          serviceName: schema.services.name,
          callerName: schema.callers.displayName,
          callerPhone: schema.callers.phoneE164,
          staffName: schema.staff.name
        })
        .from(schema.bookings)
        .innerJoin(
          schema.services,
          and(
            eq(schema.services.id, schema.bookings.serviceId),
            eq(schema.services.tenantId, tenantId)
          )
        )
        .innerJoin(
          schema.callers,
          and(
            eq(schema.callers.id, schema.bookings.callerId),
            eq(schema.callers.tenantId, tenantId)
          )
        )
        // A booking may have no staff assigned (auto-assign mode) — left join
        // so those bookings still appear, just with staffName null.
        .leftJoin(
          schema.staff,
          and(
            eq(schema.staff.id, schema.bookings.staffId),
            eq(schema.staff.tenantId, tenantId)
          )
        )
        .where(
          scoped.where(
            schema.bookings,
            and(
              isNull(schema.bookings.deletedAt),
              gte(schema.bookings.startsAt, weekStart),
              lt(schema.bookings.startsAt, weekEnd)
            )
          )
        )
        .orderBy(asc(schema.bookings.startsAt)),
      db
        .select({
          id: schema.services.id,
          name: schema.services.name,
          durationMinutes: schema.services.durationMinutes
        })
        .from(schema.services)
        .where(
          scoped.where(schema.services, eq(schema.services.active, true))
        )
        .orderBy(asc(schema.services.name))
    ]);

    return NextResponse.json({
      data: { bookings, services, timezone, weekStart: parsed.data.weekStart }
    });
  } catch (error) {
    console.error("Booking list failed", error);
    return apiError("BOOKINGS_FAILED", "Could not load bookings.", 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = createBookingSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Check the service, time, and caller details.", 400);
  }

  const tenantId = auth.context.tenantId;
  const scoped = withTenant(db, tenantId);
  const [service] = await db
    .select({
      id: schema.services.id,
      name: schema.services.name,
      durationMinutes: schema.services.durationMinutes
    })
    .from(schema.services)
    .where(
      scoped.where(
        schema.services,
        and(
          eq(schema.services.id, parsed.data.serviceId),
          eq(schema.services.active, true)
        )
      )
    )
    .limit(1);

  if (!service) return apiError("SERVICE_NOT_FOUND", "Service not found.", 404);

  const [tenant] = await db
    .select({ timezone: schema.tenants.timezone })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  if (!tenant) return apiError("TENANT_NOT_FOUND", "Business not found.", 404);

  const startsAt = new Date(parsed.data.startsAt);
  const date = formatInTimeZone(
    startsAt,
    tenant.timezone,
    "yyyy-MM-dd"
  );

  try {
    const slots = await availabilityService.getSlots(tenantId, service.id, date);
    const selected = slots.find(
      (slot) => slot.startsAt.getTime() === startsAt.getTime()
    );
    if (!selected) {
      return apiError("SLOT_UNAVAILABLE", "That time is no longer available.", 409);
    }

    const [caller] = await db
      .insert(schema.callers)
      .values(
        scoped.values({
          phoneE164: parsed.data.callerPhone,
          displayName: parsed.data.callerName
        })
      )
      .onConflictDoUpdate({
        target: [schema.callers.tenantId, schema.callers.phoneE164],
        set: { displayName: parsed.data.callerName, updatedAt: new Date() }
      })
      .returning({ id: schema.callers.id });

    if (!caller) throw new Error("Caller upsert returned no row");

    const eventId = await calendarService.createEvent(tenantId, {
      title: `${service.name} — ${parsed.data.callerName}`,
      startsAt: selected.startsAt,
      endsAt: selected.endsAt,
      description: parsed.data.notes || `Booked through Recepto for ${parsed.data.callerPhone}`
    });

    try {
      const [booking] = await db
        .insert(schema.bookings)
        .values(
          scoped.values({
            callerId: caller.id,
            serviceId: service.id,
            startsAt: selected.startsAt,
            endsAt: selected.endsAt,
            status: "confirmed" as const,
            gcalEventId: eventId,
            notes: parsed.data.notes
          })
        )
        .returning();
      return NextResponse.json({ data: { booking } }, { status: 201 });
    } catch (error) {
      await calendarService.deleteEvent(tenantId, eventId).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error("Booking creation failed", error);
    return apiError(
      "BOOKING_CREATE_FAILED",
      "Could not create the booking or Google Calendar event.",
      503
    );
  }
}





import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema, withTenant } from "@recepto/db";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { calendarService } from "@/lib/calendar";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { bookingId: string } }
) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = z.string().uuid().safeParse(params.bookingId);
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid booking ID.", 400);

  const tenantId = auth.context.tenantId;
  const scoped = withTenant(db, tenantId);
  const [booking] = await db
    .select({ id: schema.bookings.id, gcalEventId: schema.bookings.gcalEventId })
    .from(schema.bookings)
    .where(
      scoped.where(
        schema.bookings,
        and(
          eq(schema.bookings.id, parsed.data),
          eq(schema.bookings.status, "confirmed"),
          isNull(schema.bookings.deletedAt)
        )
      )
    )
    .limit(1);

  if (!booking) return apiError("BOOKING_NOT_FOUND", "Booking not found.", 404);

  try {
    if (booking.gcalEventId) {
      await calendarService.deleteEvent(tenantId, booking.gcalEventId);
    }
    await db
      .update(schema.bookings)
      .set({ status: "cancelled", deletedAt: new Date(), updatedAt: new Date() })
      .where(
        scoped.where(schema.bookings, eq(schema.bookings.id, booking.id))
      );
    return NextResponse.json({ data: { cancelled: true } });
  } catch (error) {
    console.error("Booking cancellation failed", error);
    return apiError(
      "BOOKING_CANCEL_FAILED",
      "Could not cancel the booking in Google Calendar.",
      503
    );
  }
}

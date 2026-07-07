import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema, withTenant } from "@recepto/db";
import { CalendarConnectionRevokedError } from "@recepto/calendar";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { calendarService } from "@/lib/calendar";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const calendarSelectionSchema = z.object({
  calendarId: z.string().trim().min(1).max(1_024)
});

async function getIntegration() {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const scoped = withTenant(db, auth.context.tenantId);
  const [connection] = await db
    .select({
      status: schema.googleConnections.status,
      calendarId: schema.googleConnections.calendarId
    })
    .from(schema.googleConnections)
    .where(scoped.where(schema.googleConnections))
    .limit(1);

  if (!connection) {
    return NextResponse.json({
      data: { status: "disconnected", calendarId: null, calendars: [] }
    });
  }

  if (connection.status !== "active") {
    return NextResponse.json({
      data: { status: "revoked", calendarId: connection.calendarId, calendars: [] }
    });
  }

  try {
    const calendars = await calendarService.listCalendars(auth.context.tenantId);
    return NextResponse.json({
      data: { status: "active", calendarId: connection.calendarId, calendars }
    });
  } catch (error) {
    if (error instanceof CalendarConnectionRevokedError) {
      return NextResponse.json({
        data: { status: "revoked", calendarId: connection.calendarId, calendars: [] }
      });
    }
    throw error;
  }
}

export async function GET() {
  try {
    return await getIntegration();
  } catch (error) {
    console.error("Google Calendar integration load failed", error);
    return apiError("GOOGLE_LOAD_FAILED", "Could not load Google calendars.", 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await getApiTenantContext();
    if (!auth.context) return auth.response;

    const parsed = calendarSelectionSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return apiError("INVALID_INPUT", "Select a valid calendar.", 400);
    }

    const calendars = await calendarService.listCalendars(auth.context.tenantId);
    if (!calendars.some((calendar) => calendar.id === parsed.data.calendarId)) {
      return apiError("CALENDAR_FORBIDDEN", "That calendar is not writable.", 403);
    }

    const scoped = withTenant(db, auth.context.tenantId);
    await db
      .update(schema.googleConnections)
      .set({ calendarId: parsed.data.calendarId, updatedAt: new Date() })
      .where(
        scoped.where(
          schema.googleConnections,
          eq(schema.googleConnections.status, "active")
        )
      );

    return NextResponse.json({ data: { calendarId: parsed.data.calendarId } });
  } catch (error) {
    console.error("Google calendar selection failed", error);
    return apiError("CALENDAR_SAVE_FAILED", "Could not save that calendar.", 500);
  }
}

export async function DELETE() {
  try {
    const auth = await getApiTenantContext();
    if (!auth.context) return auth.response;

    await calendarService.revokeConnection(auth.context.tenantId);
    return NextResponse.json({ data: { status: "revoked" } });
  } catch (error) {
    console.error("Google Calendar disconnect failed", error);
    return apiError(
      "GOOGLE_DISCONNECT_FAILED",
      "Google could not confirm revocation; the local connection was disabled.",
      502
    );
  }
}



import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { availabilityService } from "@/lib/calendar";
import { availabilityQuerySchema } from "@/lib/booking-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = availabilityQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Choose a service and a valid date.", 400);
  }

  try {
    const slots = await availabilityService.getSlots(
      auth.context.tenantId,
      parsed.data.serviceId,
      parsed.data.date
    );
    return NextResponse.json({
      data: {
        slots: slots.map((slot) => ({
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString()
        }))
      }
    });
  } catch (error) {
    console.error("Availability lookup failed", error);
    return apiError(
      "AVAILABILITY_FAILED",
      "Could not load availability. Check the Google Calendar connection.",
      503
    );
  }
}

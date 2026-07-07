import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { saveBusinessHoursSchema } from "@/lib/agent-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

async function saveHours(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = saveBusinessHoursSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Provide valid hours for all seven weekdays.", 400);
  }

  await db.transaction(async (tx) => {
    const scoped = withTenant(tx, auth.context!.tenantId);
    for (const hours of parsed.data.hours) {
      await tx
        .insert(schema.businessHours)
        .values(scoped.values(hours))
        .onConflictDoUpdate({
          target: [schema.businessHours.tenantId, schema.businessHours.weekday],
          set: {
            opens: hours.opens,
            closes: hours.closes,
            closed: hours.closed,
            updatedAt: new Date()
          }
        });
    }
  });

  return NextResponse.json({ data: { saved: true } });
}

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    return await saveHours(request);
  } catch (error) {
    console.error("Business-hours save failed", error);
    return apiError("HOURS_SAVE_FAILED", "Could not save business hours.", 500);
  }
}
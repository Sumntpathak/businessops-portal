import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema } from "@recepto/db";
import { saveTelephonySettingsSchema } from "@/lib/agent-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

async function getSettings() {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const [tenant] = await db
    .select({ transferRecordingEnabled: schema.tenants.transferRecordingEnabled })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, auth.context.tenantId))
    .limit(1);

  return NextResponse.json({
    data: { transferRecordingEnabled: tenant?.transferRecordingEnabled ?? false }
  });
}

async function saveSettings(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = saveTelephonySettingsSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Invalid telephony settings.", 400);
  }

  await db
    .update(schema.tenants)
    .set({
      transferRecordingEnabled: parsed.data.transferRecordingEnabled,
      updatedAt: new Date()
    })
    .where(eq(schema.tenants.id, auth.context.tenantId));

  return NextResponse.json({ data: { transferRecordingEnabled: parsed.data.transferRecordingEnabled } });
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await getSettings();
  } catch (error) {
    console.error("Telephony settings load failed", error);
    return apiError("TELEPHONY_SETTINGS_FAILED", "Could not load telephony settings.", 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    return await saveSettings(request);
  } catch (error) {
    console.error("Telephony settings save failed", error);
    return apiError("TELEPHONY_SETTINGS_SAVE_FAILED", "Could not save telephony settings.", 500);
  }
}

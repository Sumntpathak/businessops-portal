import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { businessInfoSchema } from "@recepto/shared";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

async function saveBusinessInfo(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = businessInfoSchema.safeParse(
    (await request.json().catch(() => null))?.businessInfo
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Check the business details: every office needs a name and every FAQ a question and answer.", 400);
  }

  const scoped = withTenant(db, auth.context.tenantId);
  const result = await db
    .update(schema.agentProfiles)
    .set({ businessInfo: parsed.data, updatedAt: new Date() })
    .where(scoped.where(schema.agentProfiles))
    .returning({ id: schema.agentProfiles.id });

  if (result.length === 0) {
    return apiError("PROFILE_NOT_READY", "The onboarding draft is not ready yet.", 409);
  }

  return NextResponse.json({ data: { businessInfo: parsed.data } });
}

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    return await saveBusinessInfo(request);
  } catch (error) {
    console.error("Business info save failed", error);
    return apiError("BUSINESS_INFO_SAVE_FAILED", "Could not save business details.", 500);
  }
}

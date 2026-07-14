import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { saveLanguagesSchema } from "@/lib/agent-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

async function saveLanguages(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = saveLanguagesSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Provide one to twelve unique languages.", 400);
  }

  const { tenantId } = auth.context;
  const scoped = withTenant(db, tenantId);
  const result = await db
    .update(schema.agentProfiles)
    .set({ languages: parsed.data.languages, updatedAt: new Date() })
    .where(scoped.where(schema.agentProfiles))
    .returning({ id: schema.agentProfiles.id });

  if (result.length === 0) {
    return apiError("PROFILE_NOT_READY", "The onboarding draft is not ready yet.", 409);
  }

  return NextResponse.json({ data: { languages: parsed.data.languages } });
}

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    return await saveLanguages(request);
  } catch (error) {
    console.error("Languages save failed", error);
    return apiError("LANGUAGES_SAVE_FAILED", "Could not save languages.", 500);
  }
}

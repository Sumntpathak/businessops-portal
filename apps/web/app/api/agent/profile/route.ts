import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { saveAgentProfileSchema } from "@/lib/agent-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

async function updateProfile(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = saveAgentProfileSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Agent markdown must contain at least 50 characters.", 400);
  }

  const { tenantId, user } = auth.context;
  const result = await db.transaction(async (tx) => {
    const scoped = withTenant(tx, tenantId);
    const [profile] = await tx
      .select({ id: schema.agentProfiles.id, version: schema.agentProfiles.version })
      .from(schema.agentProfiles)
      .where(scoped.where(schema.agentProfiles))
      .limit(1);

    if (!profile) return null;

    const version = profile.version + 1;
    await tx
      .update(schema.agentProfiles)
      .set({
        agentMd: parsed.data.agentMd,
        version,
        source: "manual",
        updatedBy: user.id,
        updatedAt: new Date()
      })
      .where(scoped.where(schema.agentProfiles, eq(schema.agentProfiles.id, profile.id)));

    const [revision] = await tx
      .insert(schema.agentProfileRevisions)
      .values(scoped.values({ agentMd: parsed.data.agentMd, version }))
      .returning({
        id: schema.agentProfileRevisions.id,
        version: schema.agentProfileRevisions.version,
        createdAt: schema.agentProfileRevisions.createdAt
      });

    return revision;
  });

  if (!result) {
    return apiError("PROFILE_NOT_READY", "The onboarding draft is not ready yet.", 409);
  }

  return NextResponse.json({ data: { revision: result } });
}

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    return await updateProfile(request);
  } catch (error) {
    console.error("Agent profile save failed", error);
    return apiError("PROFILE_SAVE_FAILED", "Could not save agent.md.", 500);
  }
}
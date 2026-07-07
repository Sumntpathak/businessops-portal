import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { restoreRevisionSchema } from "@/lib/agent-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

async function restoreRevision(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = restoreRevisionSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "A valid revision is required.", 400);
  }

  const { tenantId, user } = auth.context;
  const restored = await db.transaction(async (tx) => {
    const scoped = withTenant(tx, tenantId);
    const [revision] = await tx
      .select({ agentMd: schema.agentProfileRevisions.agentMd })
      .from(schema.agentProfileRevisions)
      .where(
        scoped.where(
          schema.agentProfileRevisions,
          eq(schema.agentProfileRevisions.id, parsed.data.revisionId)
        )
      )
      .limit(1);
    const [profile] = await tx
      .select({ id: schema.agentProfiles.id, version: schema.agentProfiles.version })
      .from(schema.agentProfiles)
      .where(scoped.where(schema.agentProfiles))
      .limit(1);

    if (!revision || !profile) return null;

    const version = profile.version + 1;
    await tx
      .update(schema.agentProfiles)
      .set({
        agentMd: revision.agentMd,
        version,
        source: "manual",
        updatedBy: user.id,
        updatedAt: new Date()
      })
      .where(scoped.where(schema.agentProfiles, eq(schema.agentProfiles.id, profile.id)));

    await tx.insert(schema.agentProfileRevisions).values(
      scoped.values({ agentMd: revision.agentMd, version })
    );

    return { agentMd: revision.agentMd, version };
  });

  if (!restored) {
    return apiError("REVISION_NOT_FOUND", "That revision is unavailable.", 404);
  }

  return NextResponse.json({ data: restored });
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    return await restoreRevision(request);
  } catch (error) {
    console.error("Agent revision restore failed", error);
    return apiError("REVISION_RESTORE_FAILED", "Could not restore that revision.", 500);
  }
}
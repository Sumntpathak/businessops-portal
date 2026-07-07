import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

async function goLive() {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const { tenantId } = auth.context;
  const scoped = withTenant(db, tenantId);
  const [profiles, serviceCounts, connections] = await Promise.all([
    db
      .select({ agentMd: schema.agentProfiles.agentMd })
      .from(schema.agentProfiles)
      .where(scoped.where(schema.agentProfiles))
      .limit(1),
    db
      .select({ value: count() })
      .from(schema.services)
      .where(
        scoped.where(schema.services, eq(schema.services.active, true))
      ),
    db
      .select({ status: schema.googleConnections.status })
      .from(schema.googleConnections)
      .where(scoped.where(schema.googleConnections))
      .limit(1)
  ]);

  const missing: string[] = [];
  if (!profiles[0]?.agentMd || /\[REVIEW:/i.test(profiles[0].agentMd)) {
    missing.push("complete agent.md");
  }
  if ((serviceCounts[0]?.value ?? 0) < 1) {
    missing.push("add at least one active service");
  }
  if (connections[0]?.status !== "active") {
    missing.push("connect Google Calendar");
  }

  if (missing.length > 0) {
    return apiError(
      "GO_LIVE_BLOCKED",
      `Before going live: ${missing.join(", ")}.`,
      409
    );
  }

  await db
    .update(schema.tenants)
    .set({ status: "live", updatedAt: new Date() })
    .where(eq(schema.tenants.id, tenantId));

  return NextResponse.json({ data: { status: "live" } });
}

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return await goLive();
  } catch (error) {
    console.error("Go-live check failed", error);
    return apiError("GO_LIVE_FAILED", "Could not update tenant status.", 500);
  }
}
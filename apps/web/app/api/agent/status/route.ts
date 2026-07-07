import { asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getStatus() {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const { tenantId } = auth.context;
  const scoped = withTenant(db, tenantId);

  const [tenantRows, jobs, profiles, serviceRows, hours, revisions, connections] =
    await Promise.all([
      db
        .select({ status: schema.tenants.status })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1),
      db
        .select({
          id: schema.onboardingJobs.id,
          status: schema.onboardingJobs.status,
          error: schema.onboardingJobs.error,
          crawlResult: schema.onboardingJobs.crawlResult,
          updatedAt: schema.onboardingJobs.updatedAt
        })
        .from(schema.onboardingJobs)
        .where(scoped.where(schema.onboardingJobs))
        .orderBy(desc(schema.onboardingJobs.createdAt))
        .limit(1),
      db
        .select({
          id: schema.agentProfiles.id,
          agentMd: schema.agentProfiles.agentMd,
          version: schema.agentProfiles.version,
          source: schema.agentProfiles.source,
          updatedAt: schema.agentProfiles.updatedAt
        })
        .from(schema.agentProfiles)
        .where(scoped.where(schema.agentProfiles))
        .limit(1),
      db
        .select({
          id: schema.services.id,
          name: schema.services.name,
          durationMinutes: schema.services.durationMinutes,
          price: schema.services.price,
          description: schema.services.description,
          active: schema.services.active
        })
        .from(schema.services)
        .where(scoped.where(schema.services))
        .orderBy(asc(schema.services.name)),
      db
        .select({
          weekday: schema.businessHours.weekday,
          opens: schema.businessHours.opens,
          closes: schema.businessHours.closes,
          closed: schema.businessHours.closed
        })
        .from(schema.businessHours)
        .where(scoped.where(schema.businessHours))
        .orderBy(asc(schema.businessHours.weekday)),
      db
        .select({
          id: schema.agentProfileRevisions.id,
          version: schema.agentProfileRevisions.version,
          createdAt: schema.agentProfileRevisions.createdAt
        })
        .from(schema.agentProfileRevisions)
        .where(scoped.where(schema.agentProfileRevisions))
        .orderBy(desc(schema.agentProfileRevisions.version))
        .limit(20),
      db
        .select({ status: schema.googleConnections.status })
        .from(schema.googleConnections)
        .where(scoped.where(schema.googleConnections))
        .limit(1)
    ]);

  return NextResponse.json({
    data: {
      tenantStatus: tenantRows[0]?.status ?? "onboarding",
      job: jobs[0] ?? null,
      profile: profiles[0] ?? null,
      services: serviceRows,
      businessHours: hours,
      revisions,
      googleCalendarConnected: connections[0]?.status === "active"
    }
  });
}

export async function GET() {
  try {
    return await getStatus();
  } catch (error) {
    console.error("Agent status failed", error);
    return apiError("AGENT_STATUS_FAILED", "Could not load agent status.", 500);
  }
}
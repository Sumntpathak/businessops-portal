import { and, desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { callbackRequestStatusQuerySchema } from "@/lib/booking-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function listCallbackRequests(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = callbackRequestStatusQuerySchema.safeParse({
    status: request.nextUrl.searchParams.get("status") ?? undefined
  });
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "status must be pending, done, or all.", 400);
  }

  const scoped = withTenant(db, auth.context.tenantId);
  const rows = await db
    .select({
      id: schema.callbackRequests.id,
      reason: schema.callbackRequests.reason,
      preferredTime: schema.callbackRequests.preferredTime,
      status: schema.callbackRequests.status,
      createdAt: schema.callbackRequests.createdAt,
      resolvedAt: schema.callbackRequests.resolvedAt,
      callerName: schema.callers.displayName,
      callerPhone: schema.callers.phoneE164
    })
    .from(schema.callbackRequests)
    .innerJoin(
      schema.callers,
      and(
        eq(schema.callers.id, schema.callbackRequests.callerId),
        eq(schema.callers.tenantId, auth.context.tenantId)
      )
    )
    .where(
      scoped.where(
        schema.callbackRequests,
        parsed.data.status === "all"
          ? undefined
          : eq(schema.callbackRequests.status, parsed.data.status)
      )
    )
    .orderBy(desc(schema.callbackRequests.createdAt))
    .limit(200);

  return NextResponse.json({ data: { callbackRequests: rows } });
}

export async function GET(request: NextRequest) {
  try {
    return await listCallbackRequests(request);
  } catch (error) {
    console.error("Callback request list failed", error);
    return apiError("CALLBACK_REQUESTS_LIST_FAILED", "Could not load callback requests.", 500);
  }
}

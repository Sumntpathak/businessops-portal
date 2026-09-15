import { eq } from "drizzle-orm";
import { z } from "zod";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idParamSchema = z.string().uuid();
const patchSchema = z.object({ status: z.enum(["pending", "done"]) });

async function updateCallbackRequest(id: string, request: Request) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsedId = idParamSchema.safeParse(id);
  if (!parsedId.success) {
    return apiError("INVALID_INPUT", "Invalid callback request id.", 400);
  }

  const parsedBody = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return apiError("INVALID_INPUT", "status must be pending or done.", 400);
  }

  const scoped = withTenant(db, auth.context.tenantId);
  const [updated] = await db
    .update(schema.callbackRequests)
    .set({
      status: parsedBody.data.status,
      resolvedAt: parsedBody.data.status === "done" ? new Date() : null,
      updatedAt: new Date()
    })
    .where(
      scoped.where(
        schema.callbackRequests,
        eq(schema.callbackRequests.id, parsedId.data)
      )
    )
    .returning({ id: schema.callbackRequests.id });

  if (!updated) {
    return apiError("NOT_FOUND", "Callback request not found.", 404);
  }

  return NextResponse.json({ data: { updated: true } });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    return await updateCallbackRequest(id, request);
  } catch (error) {
    console.error("Callback request update failed", error);
    return apiError("CALLBACK_REQUEST_UPDATE_FAILED", "Could not update callback request.", 500);
  }
}

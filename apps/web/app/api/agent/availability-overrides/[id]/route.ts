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

async function deleteOverride(id: string) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsedId = idParamSchema.safeParse(id);
  if (!parsedId.success) {
    return apiError("INVALID_INPUT", "Invalid override id.", 400);
  }

  const scoped = withTenant(db, auth.context.tenantId);
  const [deleted] = await db
    .delete(schema.availabilityOverrides)
    .where(
      scoped.where(
        schema.availabilityOverrides,
        eq(schema.availabilityOverrides.id, parsedId.data)
      )
    )
    .returning({ id: schema.availabilityOverrides.id });

  if (!deleted) {
    return apiError("NOT_FOUND", "Override not found.", 404);
  }

  return NextResponse.json({ data: { deleted: true } });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    return await deleteOverride(id);
  } catch (error) {
    console.error("Availability override delete failed", error);
    return apiError("AVAILABILITY_OVERRIDE_DELETE_FAILED", "Could not delete override.", 500);
  }
}

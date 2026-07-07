import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { saveServicesSchema } from "@/lib/agent-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

async function saveServices(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = saveServicesSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Check the service names, durations, and prices.", 400);
  }

  const scoped = withTenant(db, auth.context.tenantId);
  await db.transaction(async (tx) => {
    const transactionScope = withTenant(tx, auth.context!.tenantId);

    for (const service of parsed.data.services) {
      const values = {
        name: service.name,
        durationMinutes: service.durationMinutes,
        price: service.price,
        description: service.description,
        active: service.active,
        updatedAt: new Date()
      };

      if (service.id) {
        await tx
          .update(schema.services)
          .set(values)
          .where(
            transactionScope.where(
              schema.services,
              eq(schema.services.id, service.id)
            )
          );
      } else {
        await tx.insert(schema.services).values(transactionScope.values(values));
      }
    }
  });

  const services = await db
    .select()
    .from(schema.services)
    .where(scoped.where(schema.services));

  return NextResponse.json({ data: { services } });
}

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    return await saveServices(request);
  } catch (error) {
    console.error("Service save failed", error);
    return apiError("SERVICE_SAVE_FAILED", "Could not save services.", 500);
  }
}
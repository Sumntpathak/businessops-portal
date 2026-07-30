import { asc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import { saveStaffSchema } from "@/lib/agent-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

async function listStaff() {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const scoped = withTenant(db, auth.context.tenantId);
  const staff = await db
    .select()
    .from(schema.staff)
    .where(scoped.where(schema.staff))
    .orderBy(asc(schema.staff.name));

  return NextResponse.json({ data: { staff } });
}

async function saveStaff(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = saveStaffSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Check the staff names and phone numbers.", 400);
  }

  const scoped = withTenant(db, auth.context.tenantId);
  await db.transaction(async (tx) => {
    const transactionScope = withTenant(tx, auth.context!.tenantId);

    for (const member of parsed.data.staff) {
      const values = {
        name: member.name,
        phoneE164: member.phoneE164,
        isRegisteredAgent: member.isRegisteredAgent,
        credentialLabel: member.credentialLabel,
        active: member.active,
        updatedAt: new Date()
      };

      if (member.id) {
        await tx
          .update(schema.staff)
          .set(values)
          .where(
            transactionScope.where(
              schema.staff,
              eq(schema.staff.id, member.id)
            )
          );
      } else {
        await tx.insert(schema.staff).values(transactionScope.values(values));
      }
    }
  });

  const staff = await db
    .select()
    .from(schema.staff)
    .where(scoped.where(schema.staff));

  return NextResponse.json({ data: { staff } });
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await listStaff();
  } catch (error) {
    console.error("Staff list failed", error);
    return apiError("STAFF_LIST_FAILED", "Could not load staff.", 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    return await saveStaff(request);
  } catch (error) {
    console.error("Staff save failed", error);
    return apiError("STAFF_SAVE_FAILED", "Could not save staff.", 500);
  }
}

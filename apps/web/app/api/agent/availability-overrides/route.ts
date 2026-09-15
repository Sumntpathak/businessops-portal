import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema, withTenant } from "@recepto/db";
import {
  createAvailabilityOverrideSchema,
  listAvailabilityOverridesSchema
} from "@/lib/agent-schemas";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function listOverrides(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = listAvailabilityOverridesSchema.safeParse({
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to")
  });
  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Provide from and to as YYYY-MM-DD.", 400);
  }
  if (parsed.data.from > parsed.data.to) {
    return apiError("INVALID_INPUT", "from must not be after to.", 400);
  }

  const scoped = withTenant(db, auth.context.tenantId);
  const rows = await db
    .select({
      id: schema.availabilityOverrides.id,
      kind: schema.availabilityOverrides.kind,
      date: schema.availabilityOverrides.date,
      opens: schema.availabilityOverrides.opens,
      closes: schema.availabilityOverrides.closes,
      closed: schema.availabilityOverrides.closed,
      startsAt: schema.availabilityOverrides.startsAt,
      endsAt: schema.availabilityOverrides.endsAt,
      note: schema.availabilityOverrides.note
    })
    .from(schema.availabilityOverrides)
    .where(
      scoped.where(
        schema.availabilityOverrides,
        and(
          gte(schema.availabilityOverrides.date, parsed.data.from),
          lte(schema.availabilityOverrides.date, parsed.data.to)
        )
      )
    )
    .orderBy(asc(schema.availabilityOverrides.date));

  return NextResponse.json({ data: { overrides: rows } });
}

async function createOverride(request: NextRequest) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = createAvailabilityOverrideSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return apiError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid override.", 400);
  }

  const input = parsed.data;
  const scoped = withTenant(db, auth.context.tenantId);
  const [row] = await db
    .insert(schema.availabilityOverrides)
    .values(
      scoped.values({
        kind: input.kind,
        date: input.date,
        opens: input.kind === "day_hours" ? (input.opens ?? null) : null,
        closes: input.kind === "day_hours" ? (input.closes ?? null) : null,
        closed: input.kind === "day_hours" ? input.closed : null,
        startsAt: input.kind === "day_hours" ? null : new Date(input.startsAt),
        endsAt: input.kind === "day_hours" ? null : new Date(input.endsAt),
        note: input.note ?? "",
        createdBy: auth.context.user.id
      })
    )
    .returning({ id: schema.availabilityOverrides.id });

  return NextResponse.json({ data: { id: row?.id } }, { status: 201 });
}

export async function GET(request: NextRequest) {
  try {
    return await listOverrides(request);
  } catch (error) {
    console.error("Availability override list failed", error);
    return apiError("AVAILABILITY_OVERRIDES_LIST_FAILED", "Could not load overrides.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    return await createOverride(request);
  } catch (error) {
    console.error("Availability override create failed", error);
    return apiError("AVAILABILITY_OVERRIDE_CREATE_FAILED", "Could not save override.", 500);
  }
}

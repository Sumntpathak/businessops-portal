import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DEFAULT_INTAKE_FIELDS, schema, withTenant } from "@recepto/db";
import { apiError } from "@/lib/api";
import { createBusinessSchema } from "@/lib/auth-schemas";
import {
  getSessionUser,
  setActiveTenantCookie
} from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { getOnboardingQueue } from "@/lib/queue";

export const runtime = "nodejs";

function createSlug(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 120) || "business";

  return `${base}-${randomBytes(3).toString("hex")}`;
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();

  if (!user) {
    return apiError("UNAUTHORIZED", "Sign in to create a business.", 401);
  }

  const body = await request.json().catch(() => null);
  const parsed = createBusinessSchema.safeParse(body);

  if (!parsed.success) {
    return apiError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Check the business details.",
      400
    );
  }

  try {
    const tenant = await db.transaction(async (tx) => {
      const [createdTenant] = await tx
        .insert(schema.tenants)
        .values({
          name: parsed.data.name,
          slug: createSlug(parsed.data.name),
          status: "onboarding",
          businessPhone: parsed.data.phone,
          websiteUrl: parsed.data.websiteUrl,
          timezone: parsed.data.timezone
        })
        .returning({
          id: schema.tenants.id,
          slug: schema.tenants.slug
        });

      if (!createdTenant) {
        throw new Error("Tenant insert did not return a row");
      }

      const scoped = withTenant(tx, createdTenant.id);

      await tx.insert(schema.tenantMembers).values(
        scoped.values({
          userId: user.id,
          role: "owner"
        })
      );

      await tx.insert(schema.intakeFields).values(
        DEFAULT_INTAKE_FIELDS.map((field) =>
          scoped.values({ ...field, options: [...field.options] })
        )
      );

      await tx.insert(schema.onboardingJobs).values(
        scoped.values({
          status: "queued",
          inputUrl: parsed.data.websiteUrl,
          inputHint: parsed.data.hint
        })
      );

      await getOnboardingQueue().add(
        "onboard:crawl",
        {
          tenantId: createdTenant.id,
          url: parsed.data.websiteUrl,
          hint: parsed.data.hint
        },
        { jobId: `onboard-${createdTenant.id}` }
      );

      return createdTenant;
    });

    setActiveTenantCookie(tenant.id);

    return NextResponse.json(
      { data: { redirectTo: "/dashboard", tenantSlug: tenant.slug } },
      { status: 201 }
    );
  } catch (error) {
    console.error("Business creation failed", error);
    return apiError(
      "BUSINESS_CREATION_FAILED",
      "Could not create your business. Please try again.",
      500
    );
  }
}

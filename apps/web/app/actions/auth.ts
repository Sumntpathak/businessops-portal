"use server";

import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { schema } from "@recepto/db";
import { signOut } from "@/auth";
import { tenantSlugSchema } from "@/lib/auth-schemas";
import {
  ACTIVE_TENANT_COOKIE,
  requireUser,
  setActiveTenantCookie
} from "@/lib/auth-helpers";
import { db } from "@/lib/db";

export async function switchTenantAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsedSlug = tenantSlugSchema.safeParse(formData.get("tenantSlug"));

  if (!parsedSlug.success) {
    redirect("/dashboard");
  }

  const [membership] = await db
    .select({ tenantId: schema.tenantMembers.tenantId })
    .from(schema.tenantMembers)
    .innerJoin(
      schema.tenants,
      eq(schema.tenantMembers.tenantId, schema.tenants.id)
    )
    .where(
      and(
        eq(schema.tenantMembers.userId, user.id),
        eq(schema.tenants.slug, parsedSlug.data),
        isNull(schema.tenants.deletedAt)
      )
    )
    .limit(1);

  if (!membership) {
    redirect("/dashboard");
  }

  setActiveTenantCookie(membership.tenantId);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  cookies().delete(ACTIVE_TENANT_COOKIE);
  await signOut({ redirectTo: "/login" });
}

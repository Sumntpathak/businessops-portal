import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { schema } from "@recepto/db";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  selectAuthorizedMembership,
  type TenantMembership
} from "@/lib/tenant-access";

export const ACTIVE_TENANT_COOKIE = "recepto_active_tenant";

export async function getSessionUser() {
  const session = await auth();

  if (!session?.user?.id || !session.user.email) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? "Recepto user"
  };
}

export async function requireUser() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function getMembershipsForUser(
  userId: string
): Promise<TenantMembership[]> {
  return db
    .select({
      userId: schema.tenantMembers.userId,
      tenantId: schema.tenantMembers.tenantId,
      slug: schema.tenants.slug,
      name: schema.tenants.name,
      role: schema.tenantMembers.role
    })
    .from(schema.tenantMembers)
    .innerJoin(
      schema.tenants,
      eq(schema.tenantMembers.tenantId, schema.tenants.id)
    )
    .where(
      and(
        eq(schema.tenantMembers.userId, userId),
        isNull(schema.tenants.deletedAt)
      )
    );
}

export async function getTenantContext() {
  const user = await getSessionUser();

  if (!user) {
    return null;
  }

  const memberships = await getMembershipsForUser(user.id);
  const preferredTenantId = cookies().get(ACTIVE_TENANT_COOKIE)?.value;
  const membership = selectAuthorizedMembership(
    memberships,
    user.id,
    preferredTenantId
  );

  if (!membership) {
    return { user, tenantId: null, tenant: null, memberships };
  }

  return {
    user,
    tenantId: membership.tenantId,
    tenant: membership,
    memberships
  };
}

export async function requireTenant() {
  const context = await getTenantContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.tenantId || !context.tenant) {
    redirect("/onboarding/create-business");
  }

  return {
    ...context,
    tenantId: context.tenantId,
    tenant: context.tenant
  };
}

export function setActiveTenantCookie(tenantId: string): void {
  cookies().set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60
  });
}

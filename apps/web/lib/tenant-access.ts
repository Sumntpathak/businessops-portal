export interface TenantMembership {
  userId: string;
  tenantId: string;
  slug: string;
  name: string;
  role: "owner" | "staff";
}

/**
 * Selects only memberships owned by the authenticated user. A forged active-tenant
 * cookie can change the preferred ID, but can never grant membership.
 */
export function selectAuthorizedMembership(
  memberships: readonly TenantMembership[],
  authenticatedUserId: string,
  preferredTenantId?: string
): TenantMembership | null {
  const owned = memberships.filter(
    (membership) => membership.userId === authenticatedUserId
  );

  if (owned.length === 0) {
    return null;
  }

  return (
    owned.find((membership) => membership.tenantId === preferredTenantId) ??
    owned[0] ??
    null
  );
}

import { apiError } from "@/lib/api";
import { getTenantContext } from "@/lib/auth-helpers";

export async function getApiTenantContext() {
  const context = await getTenantContext();

  if (!context) {
    return {
      context: null,
      response: apiError("UNAUTHORIZED", "Authentication required.", 401)
    };
  }

  if (!context.tenantId || !context.tenant) {
    return {
      context: null,
      response: apiError("TENANT_REQUIRED", "Create or select a business.", 403)
    };
  }

  return {
    context: {
      ...context,
      tenantId: context.tenantId,
      tenant: context.tenant
    },
    response: null
  };
}

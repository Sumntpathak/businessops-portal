import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integrationConfigs } from "@/server/db/schema";
import { requireRole } from "@/server/auth/rbac";
import { withAuth } from "@/server/http/with-auth";
import { ok } from "@/server/http/response";

export const GET = withAuth(async (_req, ctx) => {
  requireRole(ctx, ["admin", "manager", "agent", "finance"]);

  const rows = await db.select({
    type: integrationConfigs.type,
    provider: integrationConfigs.provider,
  }).from(integrationConfigs).where(eq(integrationConfigs.isEnabled, true));

  return ok({
    email: rows.find((row) => row.type === "email") ?? null,
    whatsapp: rows.find((row) => row.type === "whatsapp") ?? null,
    payment: rows.find((row) => row.type === "payment") ?? null,
  });
});

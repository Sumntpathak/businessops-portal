import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { integrationConfigs } from "@/server/db/schema";
import { writeAuditLog } from "@/server/audit/audit-log";
import { requireRole } from "@/server/auth/rbac";
import { withAuth } from "@/server/http/with-auth";
import { err, ok } from "@/server/http/response";

const integrationSchema = z.object({
  type: z.enum(["email", "whatsapp", "payment"]),
  provider: z.string().trim().min(2).max(100),
  config: z.record(z.string(), z.unknown()),
  isEnabled: z.boolean(),
});

function parseConfig(config: string) {
  try {
    return JSON.parse(config) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const GET = withAuth(async (_req, ctx) => {
  requireRole(ctx, ["admin"]);

  const rows = await db.select().from(integrationConfigs).orderBy(desc(integrationConfigs.updatedAt));
  return ok(rows.map((row) => ({ ...row, config: parseConfig(row.config) })));
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  requireRole(ctx, ["admin"]);

  const body = await req.json();
  const parsed = integrationSchema.safeParse(body);
  if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

  const { type, provider, config, isEnabled } = parsed.data;
  const existing = await db.select({ id: integrationConfigs.id })
    .from(integrationConfigs)
    .where(and(eq(integrationConfigs.type, type), eq(integrationConfigs.provider, provider)))
    .limit(1);

  const values = {
    type,
    provider,
    config: JSON.stringify(config),
    isEnabled,
    createdBy: ctx.sub,
    updatedAt: new Date(),
  };

  const [saved] = existing[0]
    ? await db.update(integrationConfigs)
        .set(values)
        .where(eq(integrationConfigs.id, existing[0].id))
        .returning()
    : await db.insert(integrationConfigs).values(values).returning();

  void writeAuditLog({
    actorUserId: ctx.sub,
    action: "INTEGRATION_CONFIG_UPDATED",
    entityType: "integration",
    entityId: saved.id,
    metadata: { type, provider, isEnabled },
  });

  return ok({ ...saved, config: parseConfig(saved.config) });
});

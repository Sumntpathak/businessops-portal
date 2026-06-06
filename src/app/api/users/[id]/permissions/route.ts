import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { writeAuditLog } from "@/server/audit/audit-log";
import { requireRole } from "@/server/auth/rbac";
import { db } from "@/server/db/client";
import { userPermissions, users } from "@/server/db/schema";
import { err, ok } from "@/server/http/response";
import { withAuth } from "@/server/http/with-auth";
import { USER_PERMISSIONS } from "@/shared/constants";

const permissionKeys = USER_PERMISSIONS.map((permission) => permission.key);

const updatePermissionsSchema = z.object({
  permissions: z.array(z.object({
    permission: z.string().refine((value) => permissionKeys.includes(value as (typeof permissionKeys)[number]), "Unknown permission"),
    granted: z.boolean(),
  })),
});

async function getUserOrNull(id: string) {
  const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return user ?? null;
}

export const GET = withAuth(async (_req, ctx, params) => {
  requireRole(ctx, ["admin"]);

  const { id } = await params as { id: string };
  const user = await getUserOrNull(id);
  if (!user) return err("User not found", 404);

  const rows = await db.select().from(userPermissions).where(eq(userPermissions.userId, id));
  return ok({ user, permissions: rows });
});

export const PUT = withAuth(async (req: NextRequest, ctx, params) => {
  requireRole(ctx, ["admin"]);

  const { id } = await params as { id: string };
  const user = await getUserOrNull(id);
  if (!user) return err("User not found", 404);

  const body = await req.json();
  const parsed = updatePermissionsSchema.safeParse(body);
  if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

  for (const item of parsed.data.permissions) {
    const [updated] = await db.update(userPermissions)
      .set({ granted: item.granted, grantedBy: ctx.sub, updatedAt: new Date() })
      .where(and(eq(userPermissions.userId, id), eq(userPermissions.permission, item.permission)))
      .returning({ id: userPermissions.id });

    if (!updated) {
      await db.insert(userPermissions).values({
        userId: id,
        permission: item.permission,
        granted: item.granted,
        grantedBy: ctx.sub,
        updatedAt: new Date(),
      });
    }
  }

  void writeAuditLog({
    actorUserId: ctx.sub,
    action: "USER_PERMISSIONS_UPDATED",
    entityType: "user",
    entityId: id,
    metadata: { permissions: parsed.data.permissions },
  });

  const rows = await db.select().from(userPermissions).where(eq(userPermissions.userId, id));
  return ok({ user, permissions: rows });
});

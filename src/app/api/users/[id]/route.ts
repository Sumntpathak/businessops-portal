import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { withAuth } from "@/server/http/with-auth";
import { err, ok } from "@/server/http/response";
import { requireRole } from "@/server/auth/rbac";
import { AuthError } from "@/server/auth/session";
import { writeAuditLog } from "@/server/audit/audit-log";
import { z } from "zod";

const updateSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(["admin", "manager", "agent", "finance"]).optional(),
});

export const PUT = withAuth(async (req: NextRequest, ctx, params) => {
  requireRole(ctx, ["admin"]);
  const { id } = await params as { id: string };
  if (id === ctx.sub) throw new AuthError(400, "Cannot modify your own account via this endpoint");

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

  const [updated] = await db.update(users)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(users.id, id)).returning();

  if (!updated) throw new AuthError(404, "User not found");

  void writeAuditLog({ actorUserId: ctx.sub, action: "USER_UPDATED", entityType: "user", entityId: id, metadata: parsed.data });
  return ok(updated);
});

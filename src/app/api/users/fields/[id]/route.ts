import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { userFieldDefinitions } from "@/server/db/schema";
import { withAuth } from "@/server/http/with-auth";
import { requireRole } from "@/server/auth/rbac";
import { ok } from "@/server/http/response";
import { AuthError } from "@/server/auth/session";

export const DELETE = withAuth(async (_req, ctx, params) => {
  requireRole(ctx, ["admin"]);
  const { id } = await params as { id: string };
  const [deleted] = await db.delete(userFieldDefinitions)
    .where(eq(userFieldDefinitions.id, id)).returning();
  if (!deleted) throw new AuthError(404, "Field not found");
  return ok({ message: "Field deleted" });
});

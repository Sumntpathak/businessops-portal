import { NextRequest } from "next/server";
import { and, desc, eq, SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { withAuth } from "@/server/http/with-auth";
import { requireRole } from "@/server/auth/rbac";
import { paginated, err } from "@/server/http/response";
import { z } from "zod";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  entityType: z.string().optional(),
  action: z.string().optional(),
});

export const GET = withAuth(async (req: NextRequest, ctx) => {
  requireRole(ctx, ["admin", "manager"]);
  const qs = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = querySchema.safeParse(qs);
  if (!parsed.success) return err("Invalid query", 400, parsed.error.flatten().fieldErrors);

  const { page, limit, entityType, action } = parsed.data;
  const offset = (page - 1) * limit;
  const conditions: SQL[] = [];
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
  if (action) conditions.push(eq(auditLogs.action, action));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, total] = await Promise.all([
    db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset),
    db.$count(auditLogs, where),
  ]);

  return paginated(rows, total, page, limit);
});

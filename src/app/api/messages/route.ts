import { NextRequest } from "next/server";
import { and, desc, eq, SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { messageLogs } from "@/server/db/schema";
import { requireRole } from "@/server/auth/rbac";
import { withAuth } from "@/server/http/with-auth";
import { err, paginated } from "@/server/http/response";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  channel: z.enum(["email", "whatsapp"]).optional(),
});

export const GET = withAuth(async (req: NextRequest, ctx) => {
  requireRole(ctx, ["admin", "manager"]);

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return err("Invalid query", 400, parsed.error.flatten().fieldErrors);

  const { page, limit, channel } = parsed.data;
  const offset = (page - 1) * limit;
  const conditions: SQL[] = [];
  if (channel) conditions.push(eq(messageLogs.channel, channel));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, total] = await Promise.all([
    db.select().from(messageLogs).where(where).orderBy(desc(messageLogs.createdAt)).limit(limit).offset(offset),
    db.$count(messageLogs, where),
  ]);

  return paginated(rows, total, page, limit);
});

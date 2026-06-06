import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { withAuth } from "@/server/http/with-auth";
import { err, ok } from "@/server/http/response";
import { requireRole } from "@/server/auth/rbac";
import { z } from "zod";
import { buildEmailSchema } from "@/shared/validation/email";

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: buildEmailSchema(),
  password: z.string().min(8),
  role: z.enum(["admin", "manager", "agent", "finance"]),
});

export const GET = withAuth(async (_req, ctx) => {
  requireRole(ctx, ["admin", "manager"]);
  const rows = await db.select({
    id: users.id, name: users.name, email: users.email,
    role: users.role, isActive: users.isActive, createdAt: users.createdAt,
  }).from(users).orderBy(users.createdAt);
  return ok(rows);
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  requireRole(ctx, ["admin"]);
  const body = await req.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

  const { name, email, password, role } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const [user] = await db.insert(users)
      .values({ name, email, passwordHash, role, isActive: true })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    return ok(user, 201);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "23505") return err("Email already registered", 409);
    throw e;
  }
});

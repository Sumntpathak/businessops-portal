import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, users } from "@/db/schema";
import { err, ok } from "@/lib/api/response";
import { setAuthCookie } from "@/lib/auth/cookies";
import { signToken } from "@/lib/auth/jwt";
import { loginSchema } from "@/lib/schemas/auth";

const DUMMY_PASSWORD_HASH =
  "$2b$12$invalidhashfortimingnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    }

    const { email, password } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    const isValid = user
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt.compare(password, DUMMY_PASSWORD_HASH);

    if (!user || !isValid || !user.isActive) {
      if (user) {
        await db.insert(auditLogs).values({
          actorUserId: user.id,
          action: "LOGIN_FAILED",
          entityType: "auth",
          metadata: JSON.stringify({ email, reason: "invalid_password" }),
        });
      }

      return err("Invalid email or password", 401);
    }

    const token = await signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    await setAuthCookie(token);

    await db.insert(auditLogs).values({
      actorUserId: user.id,
      action: "LOGIN_SUCCESS",
      entityType: "auth",
    });

    return ok({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (e) {
    console.error("[login]", e);
    return err("Internal server error", 500);
  }
}

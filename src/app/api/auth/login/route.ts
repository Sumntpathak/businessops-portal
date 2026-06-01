import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { users, auditLogs } from "@/db/schema";
import { signToken } from "@/lib/auth/jwt";
import { setAuthCookie } from "@/lib/auth/cookies";
import { ok, err } from "@/lib/api/response";
import { eq } from "drizzle-orm";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = LoginSchema.safeParse(body);

    if (!parsed.success) {
      return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    }

    const { email, password } = parsed.data;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Constant-time comparison to prevent timing attacks
    const dummyHash = "$2b$12$invalidhashfortimingnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn";
    const isValid = user
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt.compare(password, dummyHash); // always run bcrypt

    if (!user || !isValid || !user.isActive) {
      // Audit failed login attempt
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

    // Audit successful login
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

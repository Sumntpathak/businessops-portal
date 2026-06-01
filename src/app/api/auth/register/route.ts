import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { signToken } from "@/lib/auth/jwt";
import { setAuthCookie } from "@/lib/auth/cookies";
import { ok, err } from "@/lib/api/response";
import { eq } from "drizzle-orm";

const RegisterSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  // Role is NOT accepted from frontend — defaults to 'agent'
  // Only admins can change roles via /api/users/:id
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RegisterSchema.safeParse(body);

    if (!parsed.success) {
      return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    }

    const { name, email, password } = parsed.data;

    // Check duplicate
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return err("Email already registered", 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash, role: "agent" })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });

    const token = await signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    await setAuthCookie(token);

    return ok({ id: user.id, email: user.email, name: user.name, role: user.role }, 201);
  } catch (e) {
    console.error("[register]", e);
    return err("Internal server error", 500);
  }
}

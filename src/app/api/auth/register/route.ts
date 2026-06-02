import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { err, ok } from "@/server/http/response";
import { registerSchema } from "@/features/auth/auth.schema";

/**
 * Open self-registration is intentionally disabled for security.
 * New users are created by admins via /api/users (invite flow).
 * isActive defaults to false — an admin must activate the account.
 *
 * To enable self-registration in dev: set ALLOW_SELF_REGISTER=true.
 */
export async function POST(req: NextRequest) {
  if (process.env.ALLOW_SELF_REGISTER !== "true") {
    return err("Self-registration is disabled. Contact your administrator.", 403);
  }

  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

    const { name, email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);

    // Rely on the DB unique constraint — eliminates TOCTOU race vs SELECT-then-INSERT
    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash, role: "agent", isActive: false })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });

    // Account is inactive — do NOT issue a session cookie
    return ok({ id: user.id, email: user.email, message: "Account created. Awaiting admin activation." }, 201);
  } catch (e: unknown) {
    const pg = e as { code?: string };
    if (pg.code === "23505") return err("Email already registered", 409);
    console.error("[register]", e);
    return err("Internal server error", 500);
  }
}

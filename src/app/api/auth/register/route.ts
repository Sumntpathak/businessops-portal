import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { err, ok } from "@/server/http/response";
import { registerSchema } from "@/features/auth/auth.schema";
import { setAuthCookie } from "@/server/auth/cookies";
import { signToken } from "@/server/auth/jwt";
import { writeAuditLog } from "@/server/audit/audit-log";
import { consumeRateLimit, getClientIp } from "@/server/http/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

    const { name, email, password } = parsed.data;
    const ip = getClientIp(req);
    const rate = consumeRateLimit({
      key: `register:${ip}`,
      limit: 3,
      windowMs: 60 * 60 * 1000,
    });
    if (!rate.allowed) return err(`Too many registration attempts. Try again in ${rate.retryAfter}s.`, 429);

    const passwordHash = await bcrypt.hash(password, 12);
    const requiresActivation = process.env.REQUIRE_ADMIN_ACTIVATION === "true";

    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash, role: "agent", isActive: !requiresActivation })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });

    await writeAuditLog({
      actorUserId: user.id,
      action: "USER_REGISTERED",
      entityType: "user",
      entityId: user.id,
      metadata: { email: user.email, requiresActivation },
    });

    if (requiresActivation) {
      return ok({ id: user.id, email: user.email, message: "Account created. Awaiting admin activation." }, 201);
    }

    const token = await signToken({ sub: user.id, email: user.email, role: user.role, name: user.name });
    await setAuthCookie(token);
    return ok({ id: user.id, email: user.email, name: user.name, role: user.role }, 201);
  } catch (e: unknown) {
    const pg = e as { code?: string };
    if (pg.code === "23505") return err("Email already registered", 409);
    console.error("[register]", e);
    return err("Internal server error", 500);
  }
}

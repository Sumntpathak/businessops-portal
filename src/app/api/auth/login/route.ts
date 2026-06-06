import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { err, ok } from "@/server/http/response";
import { setAuthCookie } from "@/server/auth/cookies";
import { signToken } from "@/server/auth/jwt";
import { loginSchema } from "@/features/auth/auth.schema";
import { writeAuditLog } from "@/server/audit/audit-log";
import { consumeRateLimit, getClientIp } from "@/server/http/rate-limit";

// Real bcrypt hash computed once per cold start — ensures the "user not found"
// branch runs the full bcrypt work factor, closing the timing oracle.
let DUMMY_HASH: string | undefined;
async function getDummyHash() {
  if (!DUMMY_HASH) DUMMY_HASH = await bcrypt.hash(crypto.randomUUID(), 12);
  return DUMMY_HASH;
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const ip = getClientIp(req);
    const rate = consumeRateLimit({
      key: `login:${ip}:${normalizedEmail}`,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    if (!rate.allowed) return err(`Too many login attempts. Try again in ${rate.retryAfter}s.`, 429);

    const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

    const hash = user ? user.passwordHash : await getDummyHash();
    const isValid = await bcrypt.compare(password, hash);

    if (!user || !isValid || !user.isActive) {
      // Audit both known-user failures and unknown-email attempts
      await writeAuditLog({
        actorUserId: user?.id ?? null,
        action: user ? "LOGIN_FAILED" : "LOGIN_FAILED_UNKNOWN",
        entityType: "auth",
        metadata: { email, reason: user ? "invalid_password" : "unknown_email" },
      });
      return err("Invalid email or password", 401);
    }

    const token = await signToken({ sub: user.id, email: user.email, role: user.role, name: user.name });
    await setAuthCookie(token);

    // Audit AFTER cookie is set — failure here must not affect the session
    await writeAuditLog({ actorUserId: user.id, action: "LOGIN_SUCCESS", entityType: "auth" });

    return ok({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (e) {
    console.error("[login]", e);
    return err("Internal server error", 500);
  }
}

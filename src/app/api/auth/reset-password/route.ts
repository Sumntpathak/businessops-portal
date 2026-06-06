import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { err, ok } from "@/server/http/response";
import { writeAuditLog } from "@/server/audit/audit-log";
import { consumeRateLimit, getClientIp } from "@/server/http/rate-limit";

const schema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const ResetClaims = z.object({
  sub: z.string().uuid(),
  type: z.literal("pwd_reset"),
  fp: z.string().length(8),
});

function loadSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(s);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

    const ip = getClientIp(req);
    const rate = consumeRateLimit({ key: `reset:${ip}`, limit: 10, windowMs: 15 * 60 * 1000 });
    if (!rate.allowed) return err(`Too many attempts. Try again in ${rate.retryAfter}s.`, 429);

    // Verify and parse the reset token
    let claims: z.infer<typeof ResetClaims>;
    try {
      const { payload } = await jwtVerify(parsed.data.token, loadSecret());
      claims = ResetClaims.parse(payload);
    } catch {
      return err("Reset link is invalid or has expired.", 400);
    }

    const [user] = await db.select({
      id: users.id, passwordHash: users.passwordHash, isActive: users.isActive,
    }).from(users).where(eq(users.id, claims.sub)).limit(1);

    if (!user || !user.isActive) return err("Reset link is invalid or has expired.", 400);

    // Fingerprint check: if password was already changed this token is stale
    if (user.passwordHash.slice(-8) !== claims.fp) {
      return err("Reset link has already been used or your password was changed.", 400);
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await db.update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    void writeAuditLog({
      actorUserId: user.id,
      action: "PASSWORD_RESET_SUCCESS",
      entityType: "auth",
    });

    return ok({ message: "Password updated. You can now log in." });
  } catch (e) {
    console.error("[reset-password]", e);
    return err("Internal server error", 500);
  }
}

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { z } from "zod";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { err, ok } from "@/server/http/response";
import { writeAuditLog } from "@/server/audit/audit-log";
import { consumeRateLimit, getClientIp } from "@/server/http/rate-limit";
import { sendEmail, passwordResetHtml } from "@/server/email/mailer";

const EXPIRY_MINUTES = 60;
const IS_DEV = process.env.NODE_ENV !== "production";

const schema = z.object({
  email: z.string().email().toLowerCase().trim(),
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
    if (!parsed.success) return err("Invalid email address", 400);

    const ip = getClientIp(req);
    const rate = consumeRateLimit({ key: `forgot:${ip}`, limit: 5, windowMs: 15 * 60 * 1000 });
    if (!rate.allowed) return err(`Too many requests. Try again in ${rate.retryAfter}s.`, 429);

    const [user] = await db.select({
      id: users.id, name: users.name, email: users.email,
      passwordHash: users.passwordHash, isActive: users.isActive,
    }).from(users).where(eq(users.email, parsed.data.email)).limit(1);

    // In dev, surface exactly why it failed instead of silent 200
    if (!user) {
      if (IS_DEV) return ok({ message: "[DEV] No user found with that email.", debug: { email: parsed.data.email } });
      return ok({ message: "If that email is registered and active, a reset link has been sent." });
    }
    if (!user.isActive) {
      if (IS_DEV) return ok({ message: "[DEV] User found but isActive=false. Admin needs to activate the account.", debug: { email: parsed.data.email, id: user.id } });
      return ok({ message: "If that email is registered and active, a reset link has been sent." });
    }

    const hashFingerprint = user.passwordHash.slice(-8);
    const secret = loadSecret();
    const token = await new SignJWT({ sub: user.id, type: "pwd_reset", fp: hashFingerprint })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${EXPIRY_MINUTES}m`)
      .sign(secret);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const { sent, reason } = await sendEmail({
      to: user.email,
      subject: "Reset your BusinessOps password",
      html: passwordResetHtml({ name: user.name, resetUrl, expiryMinutes: EXPIRY_MINUTES }),
    });

    void writeAuditLog({
      actorUserId: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      entityType: "auth",
      metadata: { emailSent: sent, reason: sent ? undefined : reason },
    });

    // In dev: always return the reset URL so you can test without email delivery
    if (IS_DEV) {
      return ok({
        message: sent
          ? `Reset email sent to ${user.email}`
          : `[DEV] SMTP not configured or failed — use the resetUrl below to test.`,
        resetUrl,
        emailSent: sent,
        smtpFailReason: sent ? undefined : reason,
      });
    }

    return ok({ message: "If that email is registered and active, a reset link has been sent." });
  } catch (e) {
    console.error("[forgot-password]", e);
    return err("Internal server error", 500);
  }
}

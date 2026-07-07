import { hash, argon2id } from "argon2";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema } from "@recepto/db";
import { apiError } from "@/lib/api";
import { signupSchema } from "@/lib/auth-schemas";
import { db } from "@/lib/db";
import { checkAuthRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const limit = await checkAuthRateLimit(getClientIp(request));

    if (!limit.allowed) {
      return apiError(
        "AUTH_RATE_LIMITED",
        "Too many signup attempts. Please try again later.",
        429
      );
    }
  } catch (error) {
    console.error("Signup rate limiter unavailable", error);
    return apiError("AUTH_UNAVAILABLE", "Signup is temporarily unavailable.", 503);
  }

  const body = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);

  if (!parsed.success) {
    return apiError("INVALID_INPUT", "Check your name, email, and password.", 400);
  }

  const [existingUser] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, parsed.data.email))
    .limit(1);

  if (existingUser) {
    return apiError(
      "ACCOUNT_EXISTS",
      "An account with this email already exists.",
      409
    );
  }

  const passwordHash = await hash(parsed.data.password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });

  try {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: parsed.data.email,
        name: parsed.data.name,
        passwordHash
      })
      .returning({ id: schema.users.id, email: schema.users.email });

    return NextResponse.json({ data: { user } }, { status: 201 });
  } catch (error) {
    const postgresError = error as { code?: string };

    if (postgresError.code === "23505") {
      return apiError(
        "ACCOUNT_EXISTS",
        "An account with this email already exists.",
        409
      );
    }

    console.error("Signup failed", error);
    return apiError("SIGNUP_FAILED", "Could not create your account.", 500);
  }
}

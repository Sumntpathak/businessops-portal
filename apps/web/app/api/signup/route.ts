import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { schema } from "@recepto/db";
import { apiError } from "@/lib/api";
import { signupSchema } from "@/lib/auth-schemas";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// Redis-backed rate limiting was removed here for the same reason it was
// removed from the login route: a Redis outage made every signup fail with
// a 503 instead of just skipping the rate-limit check. Signup must not
// depend on Redis being up.
export async function POST(request: NextRequest) {
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

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

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

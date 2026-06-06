import { getAuthToken } from "./cookies";
import { verifyToken, JWTPayload } from "./jwt";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export async function getSession(): Promise<JWTPayload | null> {
  try {
    const token = await getAuthToken();
    if (!token) return null;
    const payload = await verifyToken(token);
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user?.isActive) return null;

    return {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<JWTPayload> {
  const session = await getSession();
  if (!session) {
    throw new AuthError(401, "Unauthenticated");
  }
  return session;
}

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

import { getAuthCookie } from "./cookies";
import { verifyToken, JWTPayload } from "./jwt";

/**
 * Server-side session helper.
 * Call from Server Components or Route Handlers.
 * Returns null if unauthenticated — never throws.
 */
export async function getSession(): Promise<JWTPayload | null> {
  try {
    const token = await getAuthCookie();
    if (!token) return null;
    return await verifyToken(token);
  } catch {
    return null;
  }
}

/**
 * Require session or throw structured error.
 * Use in API route handlers after verifying.
 */
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

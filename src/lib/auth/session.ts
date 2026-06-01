import { getAuthToken } from "./cookies";
import { verifyToken, JWTPayload } from "./jwt";

export async function getSession(): Promise<JWTPayload | null> {
  try {
    const token = await getAuthToken();
    if (!token) return null;
    return await verifyToken(token);
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

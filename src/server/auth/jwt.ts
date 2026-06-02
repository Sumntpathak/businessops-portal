import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { AUTH, ROLES, type Role } from "@/shared/constants";

export interface JWTPayload {
  sub: string;
  email: string;
  role: Role;
  name: string;
}

// Fail hard at startup — never ship with a missing or weak secret
function loadSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET is missing or under 32 chars");
  return new TextEncoder().encode(s);
}
const secret = loadSecret();

const ClaimsSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(ROLES),
  name: z.string().min(1),
});

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(AUTH.JWT_EXPIRES_IN)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret);
  // Runtime validation — never trust raw JWT payload shape
  return ClaimsSchema.parse(payload) as JWTPayload;
}

import { SignJWT, jwtVerify } from "jose";
import { AUTH, type Role } from "@/lib/constants";

export interface JWTPayload {
  sub: string;
  email: string;
  role: Role;
  name: string;
}

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
const ALGORITHM = "HS256";

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(AUTH.JWT_EXPIRES_IN)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as JWTPayload;
}

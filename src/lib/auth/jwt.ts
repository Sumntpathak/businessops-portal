import { SignJWT, jwtVerify } from "jose";

export interface JWTPayload {
  sub: string;       // userId
  email: string;
  role: "admin" | "manager" | "agent" | "finance";
  name: string;
}

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
const ALGORITHM = "HS256";
const EXPIRES_IN = "8h";

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as JWTPayload;
}

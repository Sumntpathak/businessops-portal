import { cookies } from "next/headers";

const IS_PROD = process.env.NODE_ENV === "production";
const MAX_AGE = 60 * 60 * 8; // 8h — matches JWT expiry

// __Host- prefix binds cookie to host, blocks subdomain-takeover replay
// Requires Secure + Path=/ + no Domain — only valid in production (HTTPS)
export const COOKIE_NAME = IS_PROD ? "__Host-bops_token" : "bops_token";

export async function setAuthCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearAuthCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getAuthToken() {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value;
}

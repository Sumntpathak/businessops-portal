import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { z } from "zod";
import { ROLES, type Role } from "@/shared/constants";
import { COOKIE_NAME } from "@/server/auth/cookies";

function loadSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET missing or too short");
  return new TextEncoder().encode(s);
}
const secret = loadSecret();

const PUBLIC_EXACT = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/api/payments/mock-webhook",
]);
const PUBLIC_PREFIX = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
];

const ROLE_PREFIXES: Record<Role, string[]> = {
  admin:   ["/dashboard", "/leads", "/invoices", "/users", "/followups", "/settings", "/audit-logs", "/api"],
  manager: ["/dashboard", "/leads", "/invoices", "/followups", "/users", "/settings", "/api/leads", "/api/followups", "/api/invoices", "/api/dashboard", "/api/users", "/api/auth", "/api/messages", "/api/integrations/status", "/api/uploads"],
  agent:   ["/dashboard", "/leads", "/invoices", "/followups", "/settings", "/api/leads", "/api/followups", "/api/invoices", "/api/dashboard", "/api/auth", "/api/messages", "/api/integrations/status", "/api/uploads", "/api/users"],
  finance: ["/dashboard", "/leads", "/invoices", "/followups", "/settings", "/api/leads", "/api/invoices", "/api/payments", "/api/dashboard", "/api/auth", "/api/messages", "/api/integrations/status", "/api/uploads", "/api/users"],
};

const ClaimsSchema = z.object({
  sub: z.string(),
  role: z.enum(ROLES),
  email: z.string(),
  name: z.string(),
});

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return NextResponse.next();
  if (PUBLIC_EXACT.has(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIX.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const isApi = pathname.startsWith("/api");

  if (!token) {
    return isApi
      ? NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    const claims = ClaimsSchema.parse(payload);
    const { sub: userId, role, email, name } = claims;

    const allowed = ROLE_PREFIXES[role] ?? [];
    if (!allowed.some((p) => pathname.startsWith(p))) {
      return isApi
        ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
        : NextResponse.redirect(new URL("/dashboard", request.url));
    }

    const headers = new Headers(request.headers);
    headers.set("x-user-id", userId);
    headers.set("x-user-role", role);
    headers.set("x-user-email", email);
    headers.set("x-user-name", name);
    return NextResponse.next({ request: { headers } });
  } catch {
    const res = isApi
      ? NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
    res.cookies.delete(COOKIE_NAME);
    return res;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

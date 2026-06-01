import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { AUTH, type Role } from "@/lib/constants";

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

const PUBLIC_PATHS = ["/login", "/register", "/api/auth/login", "/api/auth/register"];

const ROLE_ALLOWED_PREFIXES: Record<Role, string[]> = {
  admin: ["/dashboard", "/leads", "/invoices", "/users", "/followups", "/settings", "/audit-logs", "/api"],
  manager: ["/dashboard", "/leads", "/invoices", "/followups", "/users", "/api"],
  agent: ["/dashboard", "/leads", "/followups", "/api/leads", "/api/followups", "/api/dashboard", "/api/auth"],
  finance: ["/dashboard", "/leads", "/invoices", "/followups", "/api/leads", "/api/invoices", "/api/payments", "/api/dashboard", "/api/auth"],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH.COOKIE_NAME)?.value;

  if (!token) {
    return isApiRoute(pathname)
      ? NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as Role;
    const userId = payload.sub as string;

    const headers = new Headers(request.headers);
    headers.set("x-user-id", userId);
    headers.set("x-user-role", role);
    headers.set("x-user-email", payload.email as string);
    headers.set("x-user-name", payload.name as string);

    const allowed = ROLE_ALLOWED_PREFIXES[role] ?? [];
    const hasAccess = allowed.some((prefix) => pathname.startsWith(prefix));

    if (!hasAccess) {
      return isApiRoute(pathname)
        ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
        : NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return NextResponse.next({ request: { headers } });
  } catch {
    const response = isApiRoute(pathname)
      ? NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));

    response.cookies.delete(AUTH.COOKIE_NAME);
    return response;
  }
}

function isApiRoute(pathname: string) {
  return pathname.startsWith("/api");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import NextAuth from "next-auth";
import { NextResponse } from "next/server";

const secureCookies = process.env.NODE_ENV === "production";
const { auth: authenticateRequest } = NextAuth({
  secret: process.env.SESSION_SECRET,
  trustHost: true,
  providers: [],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60
  },
  cookies: {
    sessionToken: {
      name: secureCookies
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: secureCookies,
        maxAge: 30 * 24 * 60 * 60
      }
    }
  }
});

export default authenticateRequest((request) => {
  if (!request.auth) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/create-business"]
};

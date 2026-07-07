import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { apiError } from "@/lib/api";
import { checkAuthRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export function GET(request: NextRequest): Promise<Response> {
  return handlers.GET(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  const isLoginAttempt =
    request.nextUrl.pathname.endsWith("/callback/credentials") ||
    request.nextUrl.pathname.endsWith("/signin/google");

  if (isLoginAttempt) {
    try {
      const limit = await checkAuthRateLimit(getClientIp(request));

      if (!limit.allowed) {
        return apiError(
          "AUTH_RATE_LIMITED",
          "Too many authentication attempts. Please try again later.",
          429
        );
      }
    } catch (error) {
      console.error("Authentication rate limiter unavailable", error);
      return apiError(
        "AUTH_UNAVAILABLE",
        "Authentication is temporarily unavailable.",
        503
      );
    }
  }

  return handlers.POST(request);
}

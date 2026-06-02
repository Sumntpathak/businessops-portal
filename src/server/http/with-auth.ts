import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "./request-context";
import { AuthError } from "@/server/auth/session";
import { err } from "./response";
import type { JWTPayload } from "@/server/auth/jwt";

type RouteParams = { params: Promise<Record<string, string>> };
type AuthHandler = (req: NextRequest, ctx: JWTPayload, params: RouteParams["params"]) => Promise<NextResponse>;

/**
 * Wraps any route handler with:
 *  - Auth context extraction from middleware-injected headers
 *  - AuthError → correct HTTP status (401/403)
 *  - Uncaught errors → 500 with console.error
 *
 * Before:
 *   export async function GET(req) {
 *     try { const ctx = getRequestContext(req); ... }
 *     catch (e) { if (e instanceof AuthError) ... console.error ... }
 *   }
 *
 * After:
 *   export const GET = withAuth(async (req, ctx) => { ... });
 */
export function withAuth(handler: AuthHandler, routeName?: string) {
  return async (req: NextRequest, routeCtx: RouteParams) => {
    try {
      const ctx = getRequestContext(req);
      return await handler(req, ctx, routeCtx.params);
    } catch (e) {
      if (e instanceof AuthError) return err(e.message, e.status);
      console.error(`[${routeName ?? req.nextUrl.pathname}]`, e);
      return err("Internal server error", 500);
    }
  };
}

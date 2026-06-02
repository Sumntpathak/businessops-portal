import { NextRequest } from "next/server";
import { JWTPayload } from "@/server/auth/jwt";

/**
 * Extract user context injected by middleware.
 * API routes must NEVER read userId/role from request body or query params.
 */
export function getRequestContext(req: NextRequest): JWTPayload {
  const userId = req.headers.get("x-user-id");
  const role = req.headers.get("x-user-role");
  const email = req.headers.get("x-user-email");
  const name = req.headers.get("x-user-name");

  if (!userId || !role) {
    throw new Error("Missing auth context — middleware misconfigured");
  }

  return {
    sub: userId,
    role: role as JWTPayload["role"],
    email: email ?? "",
    name: name ?? "",
  };
}

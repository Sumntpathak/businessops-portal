import { NextRequest } from "next/server";
import { getRequestContext } from "@/server/http/request-context";
import { ok, err } from "@/server/http/response";

// Returns current session user — used by frontend to hydrate user context
export async function GET(req: NextRequest) {
  try {
    const ctx = getRequestContext(req);
    return ok({ id: ctx.sub, email: ctx.email, name: ctx.name, role: ctx.role });
  } catch {
    return err("Unauthenticated", 401);
  }
}

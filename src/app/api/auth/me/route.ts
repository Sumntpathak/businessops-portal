import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/api/context";
import { ok, err } from "@/lib/api/response";

// Returns current session user — used by frontend to hydrate user context
export async function GET(req: NextRequest) {
  try {
    const ctx = getRequestContext(req);
    return ok({ id: ctx.sub, email: ctx.email, name: ctx.name, role: ctx.role });
  } catch {
    return err("Unauthenticated", 401);
  }
}

import type { NextRequest } from "next/server";
import { handlers } from "@/auth";

export const runtime = "nodejs";

export function GET(request: NextRequest): Promise<Response> {
  return handlers.GET(request);
}

// Redis-backed rate limiting on login was removed: a Redis outage (hitting
// the free-tier request cap, same failure mode already seen on the voice
// call path) made every login attempt fail with a 503 instead of just
// skipping the rate-limit check. Login must not depend on Redis being up.
export async function POST(request: NextRequest): Promise<Response> {
  return handlers.POST(request);
}

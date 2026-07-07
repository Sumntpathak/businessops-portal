import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { redis } from "./redis";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 10;

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return { count, ttl }
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export async function checkAuthRateLimit(ip: string): Promise<RateLimitResult> {
  const digest = createHash("sha256").update(ip).digest("hex");
  const key = `rate:auth:${digest}`;
  const result = (await redis.eval(
    RATE_LIMIT_SCRIPT,
    1,
    key,
    WINDOW_SECONDS
  )) as [number, number];

  const [count, ttl] = result;

  return {
    allowed: count <= MAX_ATTEMPTS,
    remaining: Math.max(0, MAX_ATTEMPTS - count),
    retryAfterSeconds: Math.max(1, ttl)
  };
}

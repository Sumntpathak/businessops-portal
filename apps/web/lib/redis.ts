import IORedis from "ioredis";
import { validateEnv } from "@recepto/shared/env";

const env = validateEnv(process.env);
const globalRedis = globalThis as unknown as { receptoRedis?: IORedis };

export const redis =
  globalRedis.receptoRedis ??
  new IORedis(env.REDIS_URL, {
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });

redis.on("error", () => {
  // Individual Redis operations reject and are handled by their route.
});

if (process.env.NODE_ENV !== "production") {
  globalRedis.receptoRedis = redis;
}

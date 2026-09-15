import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000
  });
  // Idle connections get dropped by the server routinely on managed/serverless
  // Postgres (e.g. Neon) — without this handler, that error is unhandled and
  // can crash the process or the current request instead of just discarding
  // the dead client from the pool.
  pool.on("error", () => {});
  return drizzle(pool, { schema });
}

export * from "./crypto.js";
export * from "./intake.js";
export * from "./tenant.js";
export { schema };

import { createDatabase } from "@recepto/db";
import { validateEnv } from "@recepto/shared/env";

const env = validateEnv(process.env);
type Database = ReturnType<typeof createDatabase>;
const globalDatabase = globalThis as unknown as { receptoDb?: Database };

// Cached on globalThis in all environments: in dev this survives Next.js's
// hot-module-reload; in production it lets a warm serverless instance reuse
// the same pool across requests instead of opening a new one each time,
// which otherwise risks exhausting the managed Postgres connection limit.
export const db = globalDatabase.receptoDb ?? createDatabase(env.DATABASE_URL);
globalDatabase.receptoDb = db;

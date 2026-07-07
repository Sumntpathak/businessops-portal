import { createDatabase } from "@recepto/db";
import { validateEnv } from "@recepto/shared/env";

const env = validateEnv(process.env);
type Database = ReturnType<typeof createDatabase>;
const globalDatabase = globalThis as unknown as { receptoDb?: Database };

export const db = globalDatabase.receptoDb ?? createDatabase(env.DATABASE_URL);

if (process.env.NODE_ENV !== "production") {
  globalDatabase.receptoDb = db;
}

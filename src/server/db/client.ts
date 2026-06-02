import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon serverless HTTP driver — zero cold-start overhead on Vercel Edge.
 * Each request gets a fresh HTTP connection; no connection pool needed.
 */
const sql = neon(process.env.DATABASE_URL!);

export const db = drizzle(sql, { schema });
export type DB = typeof db;

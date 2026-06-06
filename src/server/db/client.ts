import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import dns from "dns";

// Prevent connect timeout errors on local systems with unresolved IPv6 routing
if (typeof window === "undefined") {
  dns.setDefaultResultOrder("ipv4first");
}

const sql = neon(process.env.DATABASE_URL!);

export const db = drizzle(sql, { schema });
export type DB = typeof db;

/**
 * One-time/idempotent script: align demo user emails with the Yopmail demo
 * accounts shown on the login page.
 *
 * Run with:
 *   npx tsx src/server/db/fix-demo-emails.ts
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const updates = [
  { role: "admin", from: "admin@businessops.dev", to: "businessops.admin@yopmail.com" },
  { role: "manager", from: "manager@businessops.dev", to: "businessops.manager@yopmail.com" },
  { role: "agent", from: "agent1@businessops.dev", to: "businessops.agent1@yopmail.com" },
  { role: "agent", from: "agent2@businessops.dev", to: "businessops.agent2@yopmail.com" },
  { role: "finance", from: "finance@businessops.dev", to: "businessops.finance@yopmail.com" },
] as const;

async function run() {
  const finalRows: Array<{ role: string; email: string; status: string }> = [];

  for (const { from, to } of updates) {
    const [oldUser] = await db.select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, from))
      .limit(1);
    const [newUser] = await db.select({ id: schema.users.id, role: schema.users.role, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.email, to))
      .limit(1);

    if (!oldUser && newUser) {
      finalRows.push({ role: newUser.role, email: newUser.email, status: "already updated" });
      console.log(`OK  ${to} already present`);
      continue;
    }

    if (!oldUser) {
      console.log(`SKIP  ${from} not found`);
      continue;
    }

    if (newUser && newUser.id !== oldUser.id) {
      throw new Error(`Cannot update ${from}: ${to} already belongs to another user.`);
    }

    await db.update(schema.users)
      .set({ email: to, updatedAt: new Date() })
      .where(eq(schema.users.id, oldUser.id));

    const [updated] = await db.select({ role: schema.users.role, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, oldUser.id))
      .limit(1);

    if (updated) finalRows.push({ role: updated.role, email: updated.email, status: "updated" });
    console.log(`OK  ${from} -> ${to}`);
  }

  console.log("\nFinal demo email state:");
  for (const row of finalRows) {
    console.log(`${row.role.padEnd(7)} ${row.email} (${row.status})`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

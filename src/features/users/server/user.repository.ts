import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import type { NewUser } from "@/server/db/schema";

export const userRepository = {
  findByEmail: (email: string) =>
    db.select().from(users).where(eq(users.email, email)).limit(1).then((r) => r[0] ?? null),

  findById: (id: string) =>
    db.select().from(users).where(eq(users.id, id)).limit(1).then((r) => r[0] ?? null),

  findAll: () =>
    db.select({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive, createdAt: users.createdAt })
      .from(users)
      .orderBy(users.createdAt),

  create: (data: NewUser) =>
    db.insert(users).values(data)
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role })
      .then((r) => r[0]),

  update: (id: string, data: Partial<NewUser>) =>
    db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id)).returning().then((r) => r[0] ?? null),

  deactivate: (id: string) =>
    db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, id)),
};

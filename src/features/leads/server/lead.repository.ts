import { and, asc, count, desc, eq, ilike, or, SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { leads, users } from "@/server/db/schema";
import type { NewLead } from "@/server/db/schema";
import type { LeadQuery } from "@/features/leads/lead.schema";

const leadWithAssignee = {
  id: leads.id, name: leads.name, email: leads.email, phone: leads.phone,
  company: leads.company, source: leads.source, status: leads.status,
  assignedTo: leads.assignedTo, notes: leads.notes, createdBy: leads.createdBy,
  createdAt: leads.createdAt, updatedAt: leads.updatedAt,
  assigneeName: users.name,
};

export const leadRepository = {
  findMany: async (query: LeadQuery, agentId?: string) => {
    const { page, limit, search, status, assignedTo, sort } = query;
    const offset = (page - 1) * limit;
    const conditions: SQL[] = [];

    if (agentId) conditions.push(eq(leads.assignedTo, agentId));
    else if (assignedTo) conditions.push(eq(leads.assignedTo, assignedTo));

    if (status) conditions.push(eq(leads.status, status));

    if (search) {
      const q = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(or(ilike(leads.name, q), ilike(leads.email, q), ilike(leads.phone, q), ilike(leads.company, q))!);
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const order = sort === "asc" ? asc(leads.createdAt) : desc(leads.createdAt);

    const [rows, [{ value: total }]] = await Promise.all([
      db.select(leadWithAssignee).from(leads).leftJoin(users, eq(leads.assignedTo, users.id)).where(where).orderBy(order).limit(limit).offset(offset),
      db.select({ value: count() }).from(leads).where(where),
    ]);

    return { rows, total };
  },

  findById: (id: string) =>
    db.select(leadWithAssignee).from(leads)
      .leftJoin(users, eq(leads.assignedTo, users.id))
      .where(eq(leads.id, id)).limit(1).then((r) => r[0] ?? null),

  create: (data: NewLead) =>
    db.insert(leads).values(data).returning().then((r) => r[0]),

  update: (id: string, data: Partial<NewLead>) =>
    db.update(leads).set({ ...data, updatedAt: new Date() }).where(eq(leads.id, id)).returning().then((r) => r[0] ?? null),

  delete: (id: string) =>
    db.delete(leads).where(eq(leads.id, id)),
};

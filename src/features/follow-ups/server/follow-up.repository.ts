import { and, count, eq, gt, ilike, inArray, lt, or, SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { followups, leads } from "@/server/db/schema";
import type { NewFollowUp } from "@/server/db/schema";
import type { FollowUpQuery } from "@/features/follow-ups/follow-up.schema";

const todayUTC = () => new Date().toISOString().split("T")[0];

export const followUpRepository = {
  findForLead: (leadId: string) =>
    db.select().from(followups).where(eq(followups.leadId, leadId)).orderBy(followups.followUpDate),

  findById: (id: string) =>
    db.select().from(followups).where(eq(followups.id, id)).limit(1).then((r) => r[0] ?? null),

  findMany: async (query: FollowUpQuery, agentId?: string) => {
    const { status, due, search, page, limit } = query;
    const today = todayUTC();
    const offset = (page - 1) * limit;
    const conditions: SQL[] = [];

    if (status) conditions.push(eq(followups.status, status));
    if (due === "today")    conditions.push(eq(followups.followUpDate, today));
    if (due === "overdue")  { conditions.push(lt(followups.followUpDate, today)); conditions.push(eq(followups.status, "Pending")); }
    if (due === "upcoming") conditions.push(gt(followups.followUpDate, today));

    if (search) {
      const q = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(
        or(
          ilike(followups.message, q),
          ilike(leads.name, q),
          ilike(leads.email, q)
        )!
      );
    }

    if (agentId) {
      const agentLeads = await db.select({ id: leads.id }).from(leads).where(eq(leads.assignedTo, agentId));
      const ids = agentLeads.map((l) => l.id);
      if (ids.length === 0) return { rows: [], total: 0 };
      conditions.push(inArray(followups.leadId, ids));
    }

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ value: total }]] = await Promise.all([
      db.select({
        id: followups.id,
        leadId: followups.leadId,
        followUpDate: followups.followUpDate,
        message: followups.message,
        status: followups.status,
        createdBy: followups.createdBy,
        createdAt: followups.createdAt,
        updatedAt: followups.updatedAt,
        leadName: leads.name,
        leadEmail: leads.email,
        leadStatus: leads.status,
      })
      .from(followups)
      .innerJoin(leads, eq(followups.leadId, leads.id))
      .where(where)
      .orderBy(followups.followUpDate)
      .limit(limit)
      .offset(offset),
      db.select({ value: count() })
        .from(followups)
        .innerJoin(leads, eq(followups.leadId, leads.id))
        .where(where),
    ]);

    return { rows, total };
  },

  create: (data: NewFollowUp) =>
    db.insert(followups).values(data).returning().then((r) => r[0]),

  update: (id: string, data: Partial<typeof followups.$inferInsert>) =>
    db.update(followups)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(followups.id, id))
      .returning()
      .then((r) => r[0] ?? null),

  updateForAgent: (id: string, agentId: string, data: Partial<typeof followups.$inferInsert>) =>
    db.update(followups)
      .set({ ...data, updatedAt: new Date() })
      .where(and(
        eq(followups.id, id),
        inArray(
          followups.leadId,
          db.select({ id: leads.id }).from(leads).where(eq(leads.assignedTo, agentId))
        )
      ))
      .returning()
      .then((r) => r[0] ?? null),

  getLeadForFollowup: async (followupId: string) => {
    const fu = await followUpRepository.findById(followupId);
    if (!fu) return null;
    const [lead] = await db.select().from(leads).where(eq(leads.id, fu.leadId)).limit(1);
    return lead ?? null;
  },
};

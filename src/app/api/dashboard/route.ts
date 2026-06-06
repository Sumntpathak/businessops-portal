import { NextRequest } from "next/server";
import { and, count, desc, eq, inArray, notInArray, sql, sum } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, followups, invoices, leads } from "@/server/db/schema";
import { withAuth } from "@/server/http/with-auth";
import { ok } from "@/server/http/response";

const todayUTC = () => new Date().toISOString().split("T")[0];

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const today = todayUTC();
  const isAgent = ctx.role === "agent";
  const agentLeadIds = isAgent
    ? (await db.select({ id: leads.id }).from(leads).where(eq(leads.assignedTo, ctx.sub))).map((lead) => lead.id)
    : [];

  const leadScope = isAgent ? eq(leads.assignedTo, ctx.sub) : undefined;
  const followupScope = isAgent
    ? agentLeadIds.length > 0
      ? inArray(followups.leadId, agentLeadIds)
      : sql`false`
    : undefined;
  const invoiceScope = isAgent
    ? agentLeadIds.length > 0
      ? inArray(invoices.leadId, agentLeadIds)
      : sql`false`
    : undefined;
  const canViewAudit = ctx.role === "admin" || ctx.role === "manager";

  const [
    [{ total: totalLeads }],
    [{ total: openLeads }],
    [{ total: convertedLeads }],
    [{ total: lostLeads }],
    [{ total: totalInvoices }],
    [{ total: paidInvoices }],
    [{ revenue }],
    [{ total: followupsDueToday }],
    recentLogs,
  ] = await Promise.all([
    db.select({ total: count() }).from(leads).where(leadScope),
    // Open = anything not in a terminal state (Converted/Lost). Per spec,
    // New, Contacted, and Follow-Up all count as open pipeline.
    db.select({ total: count() }).from(leads).where(and(notInArray(leads.status, ["Converted", "Lost"]), leadScope)),
    db.select({ total: count() }).from(leads).where(and(eq(leads.status, "Converted"), leadScope)),
    db.select({ total: count() }).from(leads).where(and(eq(leads.status, "Lost"), leadScope)),
    db.select({ total: count() }).from(invoices).where(invoiceScope),
    db.select({ total: count() }).from(invoices).where(and(eq(invoices.status, "Paid"), invoiceScope)),
    db.select({ revenue: sum(invoices.totalAmount) }).from(invoices).where(and(eq(invoices.status, "Paid"), invoiceScope)),
    db.select({ total: count() }).from(followups).where(
      and(eq(followups.followUpDate, today), eq(followups.status, "Pending"), followupScope)
    ),
    canViewAudit ? db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(10) : Promise.resolve([]),
  ]);

  return ok({
    leads: {
      total: totalLeads,
      open: openLeads,
      converted: convertedLeads,
      lost: lostLeads,
    },
    invoices: {
      total: totalInvoices,
      paid: paidInvoices,
      unpaid: totalInvoices - paidInvoices,
      revenue: revenue ?? "0",
    },
    followupsDueToday,
    recentAuditLogs: recentLogs,
  });
});

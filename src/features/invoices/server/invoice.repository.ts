import { and, count, desc, eq, ilike, or, SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { invoiceItems, invoices, users } from "@/server/db/schema";
import type { InvoiceQuery } from "@/features/invoices/invoice.schema";

export const invoiceRepository = {
  findMany: async (query: InvoiceQuery) => {
    const { page, limit, status, search } = query;
    const offset = (page - 1) * limit;
    const conditions: SQL[] = [];

    if (status) conditions.push(eq(invoices.status, status));
    if (search) {
      const q = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(or(ilike(invoices.clientName, q), ilike(invoices.invoiceNumber, q))!);
    }

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ value: total }]] = await Promise.all([
      db.select({
        id: invoices.id, invoiceNumber: invoices.invoiceNumber, clientName: invoices.clientName,
        status: invoices.status, subtotal: invoices.subtotal, totalAmount: invoices.totalAmount,
        taxPercentage: invoices.taxPercentage, discount: invoices.discount,
        leadId: invoices.leadId, createdAt: invoices.createdAt, updatedAt: invoices.updatedAt,
        createdByName: users.name,
      })
        .from(invoices).leftJoin(users, eq(invoices.createdBy, users.id))
        .where(where).orderBy(desc(invoices.createdAt)).limit(limit).offset(offset),
      db.select({ value: count() }).from(invoices).where(where),
    ]);

    return { rows, total };
  },

  findById: async (id: string) => {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!invoice) return null;
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    return { ...invoice, items };
  },

  // Atomic: both statements ship in one Neon HTTP transaction.
  // The Neon HTTP driver does not support `db.transaction(callback)`, but
  // `db.batch([...])` runs as a single all-or-nothing round-trip. We pre-
  // generate the invoice UUID so the items can reference it without needing
  // the first INSERT's returned id.
  create: async (data: {
    invoiceNumber: string; leadId?: string | null; clientName: string;
    subtotal: string; taxPercentage: string; taxAmount: string;
    discount: string; totalAmount: string; createdBy: string;
  }, itemsData: { description: string; quantity: number; unitPrice: string; lineTotal: string }[]) => {
    const invoiceId = crypto.randomUUID();
    const withId = itemsData.map((i) => ({ ...i, invoiceId }));

    const [invResult] = await db.batch([
      db.insert(invoices).values({ id: invoiceId, ...data }).returning(),
      db.insert(invoiceItems).values(withId),
    ]);

    return invResult[0];
  },

  updateStatus: (id: string, status: "Draft" | "Sent" | "Cancelled" | "Paid") =>
    db.update(invoices).set({ status, updatedAt: new Date() }).where(eq(invoices.id, id)).returning().then((r) => r[0]),

  findForLead: (leadId: string) =>
    db.select().from(invoices).where(eq(invoices.leadId, leadId)).orderBy(desc(invoices.createdAt)),
};

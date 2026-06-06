import { db } from "@/server/db/client";
import { invoices, leads, paymentLogs } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { invoiceRepository } from "./invoice.repository";
import { writeAuditLog } from "@/server/audit/audit-log";
import { AuthError } from "@/server/auth/session";
import { requireRole } from "@/server/auth/rbac";
import type { JWTPayload } from "@/server/auth/jwt";
import type { CreateInvoiceInput, InvoiceQuery, UpdateInvoiceStatusInput } from "@/features/invoices/invoice.schema";

/** Generates a unique invoice number without a count-based race. */
function generateInvoiceNumber(): string {
  const year = new Date().getFullYear();
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
  return `INV-${year}-${stamp}-${suffix}`;
}

/**
 * ALL monetary calculations happen here on the server.
 * Frontend sends raw items — we never trust totalAmount/lineTotal from client.
 */
function calcTotals(items: CreateInvoiceInput["items"], taxPct: number, discount: number) {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const taxAmount = (subtotal * taxPct) / 100;
  const totalAmount = subtotal + taxAmount - discount;
  return {
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    lineItems: items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice.toFixed(2),
      lineTotal: (i.quantity * i.unitPrice).toFixed(2),
    })),
  };
}

function toDisplayCase(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

export const invoiceService = {
  list: (query: InvoiceQuery, ctx: JWTPayload) => {
    requireRole(ctx, ["admin", "manager", "finance"]);
    return invoiceRepository.findMany(query);
  },

  getById: async (id: string, ctx: JWTPayload) => {
    requireRole(ctx, ["admin", "manager", "finance", "agent"]);
    const invoice = await invoiceRepository.findById(id);
    if (!invoice) throw new AuthError(404, "Invoice not found");

    // Spec: agents can only view invoices linked to their assigned leads.
    // This is enforced here on the server — the UI cannot bypass it.
    if (ctx.role === "agent") {
      if (!invoice.leadId) throw new AuthError(403, "Forbidden");
      const [lead] = await db.select({ assignedTo: leads.assignedTo })
        .from(leads).where(eq(leads.id, invoice.leadId)).limit(1);
      if (!lead || lead.assignedTo !== ctx.sub) throw new AuthError(403, "Forbidden");
    }

    return invoice;
  },

  create: async (data: CreateInvoiceInput, ctx: JWTPayload) => {
    requireRole(ctx, ["admin", "manager", "finance"]);
    const invoiceNumber = generateInvoiceNumber();
    const normalizedItems = data.items.map((item) => ({
      ...item,
      description: toDisplayCase(item.description),
    }));
    const { subtotal, taxAmount, totalAmount, lineItems } = calcTotals(
      normalizedItems, data.taxPercentage, data.discount
    );

    const invoice = await invoiceRepository.create(
      {
        invoiceNumber,
        leadId: data.leadId ?? null,
        clientName: toDisplayCase(data.clientName),
        subtotal,
        taxPercentage: data.taxPercentage.toFixed(2),
        taxAmount,
        discount: data.discount.toFixed(2),
        totalAmount,
        createdBy: ctx.sub,
      },
      lineItems, // invoiceId is generated and stitched in the repo's atomic batch
    );

    await writeAuditLog({ actorUserId: ctx.sub, action: "INVOICE_CREATED", entityType: "invoice", entityId: invoice.id, metadata: { invoiceNumber, totalAmount } });
    return invoice;
  },

  updateStatus: async (id: string, data: UpdateInvoiceStatusInput, ctx: JWTPayload) => {
    requireRole(ctx, ["admin", "manager", "finance"]);
    const existing = await invoiceRepository.findById(id);
    if (!existing) throw new AuthError(404, "Invoice not found");
    if (existing.status === "Paid") throw new AuthError(400, "Paid invoices cannot be changed");

    const updated = await invoiceRepository.updateStatus(id, data.status);
    await writeAuditLog({ actorUserId: ctx.sub, action: "INVOICE_STATUS_CHANGED", entityType: "invoice", entityId: id, metadata: { from: existing.status, to: data.status } });
    return updated;
  },

  send: async (id: string, ctx: JWTPayload) => {
    requireRole(ctx, ["admin", "manager", "finance"]);
    const existing = await invoiceRepository.findById(id);
    if (!existing) throw new AuthError(404, "Invoice not found");
    if (existing.status !== "Draft") throw new AuthError(400, "Only Draft invoices can be sent");
    const updated = await invoiceRepository.updateStatus(id, "Sent");
    await writeAuditLog({ actorUserId: ctx.sub, action: "INVOICE_SENT", entityType: "invoice", entityId: id });
    return updated;
  },

  /**
   * Mock payment: creates a payment initiation record.
   * Actual Paid status is ONLY set by the webhook — never here.
   */
  mockCreatePayment: async (invoiceId: string, ctx: JWTPayload) => {
    requireRole(ctx, ["admin", "finance"]);
    const invoice = await invoiceRepository.findById(invoiceId);
    if (!invoice) throw new AuthError(404, "Invoice not found");
    if (invoice.status !== "Sent") throw new AuthError(400, "Invoice must be in Sent status to process payment");

    const txnId = `MOCK-TXN-${Date.now()}`;
    await db.insert(paymentLogs).values({
      invoiceId,
      provider: "mock",
      transactionId: txnId,
      amount: invoice.totalAmount,
      status: "Pending",
      webhookPayload: JSON.stringify({ event: "payment.initiated", invoiceId, txnId }),
    });

    await writeAuditLog({ actorUserId: ctx.sub, action: "PAYMENT_INITIATED", entityType: "invoice", entityId: invoiceId, metadata: { txnId } });
    return { transactionId: txnId, message: "Payment initiated. Awaiting webhook confirmation." };
  },

  /**
   * Mock webhook: ONLY this path can mark an invoice as Paid.
   * Validates MOCK_WEBHOOK_SECRET header with constant-time comparison.
   * Idempotent via unique transactionId constraint.
   */
  mockWebhook: async (payload: { invoiceId: string; transactionId: string; status: "Success" | "Failed" }, secret: string | null) => {
    const expected = process.env.MOCK_WEBHOOK_SECRET ?? "";
    if (!expected) throw new AuthError(500, "Webhook secret not configured");

    // Hash first to normalize lengths, then compare in constant time to prevent length/timing leaks
    const aHash = crypto.createHash("sha256").update(secret ?? "").digest();
    const bHash = crypto.createHash("sha256").update(expected).digest();
    if (!crypto.timingSafeEqual(aHash, bHash)) {
      throw new AuthError(401, "Invalid webhook secret");
    }

    const invoice = await invoiceRepository.findById(payload.invoiceId);
    if (!invoice) throw new AuthError(404, "Invoice not found");

    const logStatus = payload.status === "Success" ? "Success" : "Failed";
    try {
      await db.insert(paymentLogs).values({
        invoiceId: payload.invoiceId,
        provider: "mock",
        transactionId: payload.transactionId,
        amount: invoice.totalAmount,
        status: logStatus,
        webhookPayload: JSON.stringify(payload),
      });

      if (payload.status === "Success") {
        await db.update(invoices)
          .set({ status: "Paid", updatedAt: new Date() })
          .where(eq(invoices.id, payload.invoiceId));
      }
    } catch (e: unknown) {
      const pg = e as { code?: string };
      if (pg.code === "23505") return { message: "Duplicate webhook — already processed" };
      throw e;
    }

    if (payload.status === "Success") {
      await writeAuditLog({ actorUserId: null, action: "PAYMENT_WEBHOOK_SUCCESS", entityType: "invoice", entityId: payload.invoiceId, metadata: { txnId: payload.transactionId } });
    } else {
      await writeAuditLog({ actorUserId: null, action: "PAYMENT_WEBHOOK_FAILED", entityType: "invoice", entityId: payload.invoiceId, metadata: { txnId: payload.transactionId } });
    }

    return { message: `Webhook processed: ${payload.status}` };
  },
};

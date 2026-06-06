import { withAuth } from "@/server/http/with-auth";
import { ok, paginated, err } from "@/server/http/response";
import { invoiceService } from "./invoice.service";
import { createInvoiceSchema, invoiceQuerySchema, updateInvoiceStatusSchema } from "@/features/invoices/invoice.schema";
import { z } from "zod";

const mockPaymentCreateSchema = z.object({ invoiceId: z.string().uuid() });
const mockWebhookSchema = z.object({
  invoiceId: z.string().uuid(),
  transactionId: z.string().min(1),
  status: z.enum(["Success", "Failed"]),
});

export const invoiceHandlers = {
  list: withAuth(async (req, ctx) => {
    const qs = Object.fromEntries(req.nextUrl.searchParams);
    const parsed = invoiceQuerySchema.safeParse(qs);
    if (!parsed.success) return err("Invalid query", 400, parsed.error.flatten().fieldErrors);
    const { rows, total } = await invoiceService.list(parsed.data, ctx);
    return paginated(rows, total, parsed.data.page, parsed.data.limit);
  }),

  getById: withAuth(async (req, ctx, params) => {
    const { id } = await params as { id: string };
    return ok(await invoiceService.getById(id, ctx));
  }),

  create: withAuth(async (req, ctx) => {
    const body = await req.json();
    const parsed = createInvoiceSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    return ok(await invoiceService.create(parsed.data, ctx), 201);
  }),

  updateStatus: withAuth(async (req, ctx, params) => {
    const { id } = await params as { id: string };
    const body = await req.json();
    const parsed = updateInvoiceStatusSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    return ok(await invoiceService.updateStatus(id, parsed.data, ctx));
  }),

  send: withAuth(async (req, ctx, params) => {
    const { id } = await params as { id: string };
    return ok(await invoiceService.send(id, ctx));
  }),

  mockCreate: withAuth(async (req, ctx) => {
    const body = await req.json();
    const parsed = mockPaymentCreateSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    return ok(await invoiceService.mockCreatePayment(parsed.data.invoiceId, ctx));
  }),

  // Webhook — NOT wrapped in withAuth (no JWT required; uses secret header)
  mockWebhook: async (req: Request) => {
    try {
      const secret = (req.headers as Headers).get("x-webhook-secret");
      const body = await (req as Request).json();
      const parsed = mockWebhookSchema.safeParse(body);
      if (!parsed.success) return err("Invalid payload", 400, parsed.error.flatten().fieldErrors);
      return ok(await invoiceService.mockWebhook(parsed.data, secret));
    } catch (e: unknown) {
      const ae = e as { status?: number; message?: string };
      if (ae.status) return err(ae.message ?? "Error", ae.status);
      console.error("[webhook]", e);
      return err("Internal server error", 500);
    }
  },
};

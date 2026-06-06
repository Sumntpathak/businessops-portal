import { NextRequest } from "next/server";
import { withAuth } from "@/server/http/with-auth";
import { requireRole } from "@/server/auth/rbac";
import { err, ok } from "@/server/http/response";
import { invoiceService } from "@/features/invoices/server/invoice.service";
import { z } from "zod";

const schema = z.object({
  invoiceId: z.string().uuid(),
  status: z.enum(["Success", "Failed"]),
});


/**
 * Server-side proxy for the mock webhook tester UI.
 * The client sends {invoiceId, status} — this route injects the real
 * MOCK_WEBHOOK_SECRET server-side before forwarding to mockWebhook().
 * The secret is NEVER sent to or readable by the browser.
 */


export const POST = withAuth(async (req: NextRequest, ctx) => {
  requireRole(ctx, ["admin", "finance"]);

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

  const { invoiceId, status } = parsed.data;
  const txnId = `MOCK-WH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Pass the real server-side secret — never exposes it to the client
  const result = await invoiceService.mockWebhook(
    { invoiceId, transactionId: txnId, status },
    process.env.MOCK_WEBHOOK_SECRET ?? ""
  );

  return ok(result);
});

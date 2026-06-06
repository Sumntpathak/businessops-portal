import { invoiceHandlers } from "@/features/invoices/server/invoice.handlers";
import { NextRequest } from "next/server";

// Webhook endpoint — no JWT auth, validated by x-webhook-secret header only
export async function POST(req: NextRequest) {
  return invoiceHandlers.mockWebhook(req);
}

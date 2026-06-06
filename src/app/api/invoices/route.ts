import { invoiceHandlers } from "@/features/invoices/server/invoice.handlers";

export const GET = invoiceHandlers.list;
export const POST = invoiceHandlers.create;

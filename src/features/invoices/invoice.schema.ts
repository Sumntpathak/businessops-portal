import { z } from "zod";
import { INVOICE_STATUSES } from "@/shared/constants";

export const invoiceStatusEnum = z.enum(INVOICE_STATUSES);

const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Description required").max(500),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  unitPrice: z.coerce.number().min(0, "Unit price must be non-negative"),
});

export const createInvoiceSchema = z.object({
  leadId: z.string().uuid().nullable().optional(),
  clientName: z.string().trim().min(1, "Client name required").max(255),
  taxPercentage: z.coerce.number().min(0).max(100).default(0),
  discount: z.coerce.number().min(0).default(0),
  items: z.array(lineItemSchema).min(1, "At least one line item required"),
});

export const updateInvoiceStatusSchema = z.object({
  status: z.enum(["Draft", "Sent", "Cancelled"]), // Paid is only via webhook
});

export const invoiceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: invoiceStatusEnum.optional(),
  search: z.string().trim().max(200).optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceStatusInput = z.infer<typeof updateInvoiceStatusSchema>;
export type InvoiceQuery = z.infer<typeof invoiceQuerySchema>;

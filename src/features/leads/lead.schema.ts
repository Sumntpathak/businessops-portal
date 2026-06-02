import { z } from "zod";
import { LEAD_STATUSES } from "@/shared/constants";

export const leadStatusEnum = z.enum(LEAD_STATUSES);

export const leadSourceEnum = z.enum([
  "Website",
  "Referral",
  "Cold Call",
  "Social Media",
  "Email Campaign",
  "Walk-In",
  "Other",
]);

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  email: z.string().trim().email("Invalid email address"),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(255).optional(),
  source: leadSourceEnum.default("Other"),
  status: leadStatusEnum.default("New"),
  assignedTo: z.string().uuid("Invalid user ID").nullable().optional(),
  notes: z.string().trim().max(5000).optional(),
});

export const updateLeadSchema = createLeadSchema.partial();

export const leadQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(200).optional(),
  status: leadStatusEnum.optional(),
  assignedTo: z.string().uuid().optional(),
  sort: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type LeadQuery = z.infer<typeof leadQuerySchema>;

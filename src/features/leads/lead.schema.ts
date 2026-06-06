import { z } from "zod";
import { LEAD_STATUSES } from "@/shared/constants";
import { buildEmailSchema } from "@/shared/validation/email";
import { lettersOnlySchema, optionalDigitsOnlySchema, optionalLettersOnlySchema } from "@/shared/validation/text";

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
  name: lettersOnlySchema("Name"),
  email: buildEmailSchema(),
  phone: optionalDigitsOnlySchema("Phone"),
  company: optionalLettersOnlySchema("Company"),
  source: leadSourceEnum.default("Other"),
  status: leadStatusEnum.default("New"),
  assignedTo: z.string().uuid("Invalid user ID").nullable().optional(),
  notes: z.string().trim().max(5000).optional(),
});

export const updateLeadSchema = createLeadSchema.partial();

export const bulkLeadUpdateSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1, "Select at least one lead").max(100, "Select 100 leads or fewer"),
    status: leadStatusEnum.optional(),
    assignedTo: z.string().uuid("Invalid user ID").nullable().optional(),
  })
  .refine((data) => data.status !== undefined || data.assignedTo !== undefined, {
    message: "Choose an action",
  });

export const bulkLeadDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least one lead").max(100, "Select 100 leads or fewer"),
});

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
export type BulkLeadUpdateInput = z.infer<typeof bulkLeadUpdateSchema>;
export type BulkLeadDeleteInput = z.infer<typeof bulkLeadDeleteSchema>;
export type LeadQuery = z.infer<typeof leadQuerySchema>;

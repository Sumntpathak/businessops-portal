import { z } from "zod";

export const followUpStatusEnum = z.enum(["Pending", "Completed", "Cancelled"]);

export const createFollowUpSchema = z.object({
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .refine((d) => !isNaN(Date.parse(d)), "Invalid date"),
  message: z.string().trim().min(1, "Message is required").max(2000),
});

export const updateFollowUpSchema = z.object({
  status: followUpStatusEnum.optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .refine((d) => !isNaN(Date.parse(d)), "Invalid date")
    .optional(),
  message: z.string().trim().min(1, "Message is required").max(2000).optional(),
});

export const followUpQuerySchema = z.object({
  status: followUpStatusEnum.optional(),
  due: z.enum(["today", "overdue", "upcoming"]).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;
export type UpdateFollowUpInput = z.infer<typeof updateFollowUpSchema>;
export type FollowUpQuery = z.infer<typeof followUpQuerySchema>;

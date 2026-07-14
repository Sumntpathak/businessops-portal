import { z } from "zod";

export const saveAgentProfileSchema = z.object({
  agentMd: z.string().trim().min(50).max(100_000)
});

export const restoreRevisionSchema = z.object({
  revisionId: z.string().uuid()
});

export const serviceInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  durationMinutes: z.number().int().min(5).max(480),
  price: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/)
    .nullable(),
  description: z.string().trim().max(2_000),
  active: z.boolean()
});

export const saveServicesSchema = z.object({
  services: z.array(serviceInputSchema).min(1).max(50)
});

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);

export const saveLanguagesSchema = z.object({
  languages: z
    .array(z.string().trim().min(1).max(40))
    .min(1)
    .max(12)
    .refine(
      (languages) => new Set(languages.map((l) => l.toLowerCase())).size === languages.length,
      "Each language may only appear once"
    )
});

export const saveBusinessHoursSchema = z.object({
  hours: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        opens: timeSchema,
        closes: timeSchema,
        closed: z.boolean()
      })
    )
    .length(7)
    .refine(
      (hours) => new Set(hours.map((entry) => entry.weekday)).size === 7,
      "Each weekday must appear exactly once"
    )
});

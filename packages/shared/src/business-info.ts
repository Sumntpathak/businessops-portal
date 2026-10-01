import { z } from "zod";

/**
 * Structured facts about the business that the voice receptionist may say on a
 * call. Edited in the dashboard, stored on the agent profile, and rendered into
 * the realtime prompt as the ONLY source of business facts.
 */
export const businessInfoSchema = z.object({
  receptionistName: z.string().trim().max(40).default(""),
  receptionistGender: z.enum(["female", "male"]).default("female"),
  about: z.string().trim().max(600).default(""),
  email: z.string().trim().max(120).default(""),
  website: z.string().trim().max(200).default(""),
  offices: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        address: z.string().trim().max(200).default(""),
        phone: z.string().trim().max(40).default(""),
        notes: z.string().trim().max(200).default("")
      })
    )
    .max(10)
    .default([]),
  faqs: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(200),
        answer: z.string().trim().min(1).max(500)
      })
    )
    .max(40)
    .default([]),
  /** Topics the receptionist must not discuss, e.g. "visa eligibility, timelines, legal advice". */
  outOfScope: z.string().trim().max(400).default("")
});

export type BusinessInfo = z.infer<typeof businessInfoSchema>;

export const emptyBusinessInfo = (): BusinessInfo => businessInfoSchema.parse({});

/** Reads a stored jsonb value; anything malformed falls back to empty rather than breaking a call. */
export function parseBusinessInfo(value: unknown): BusinessInfo {
  const parsed = businessInfoSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : emptyBusinessInfo();
}

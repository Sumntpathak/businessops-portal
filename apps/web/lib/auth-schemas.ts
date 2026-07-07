import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128)
});

export const signupSchema = loginSchema.extend({
  name: z.string().trim().min(2).max(100)
});

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(120),
  websiteUrl: z.string().trim().url().max(2048),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, for example +919876543210"),
  timezone: z.string().trim().min(1).max(100).default("Asia/Kolkata"),
  hint: z.string().trim().min(3).max(240)
});

export const tenantSlugSchema = z.string().trim().min(1).max(160);

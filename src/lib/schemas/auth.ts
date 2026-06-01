import { z } from "zod";
import { buildEmailSchema } from "@/lib/validation/email";

export const loginSchema = z.object({
  email: buildEmailSchema(),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(255),
  email: buildEmailSchema({ blockDisposable: true, blockRoleBased: true }),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

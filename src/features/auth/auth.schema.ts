import { z } from "zod";
import { buildEmailSchema } from "@/shared/validation/email";
import { lettersOnlySchema } from "@/shared/validation/text";

export const loginSchema = z.object({
  email: buildEmailSchema(),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  name: lettersOnlySchema("Name"),
  email: buildEmailSchema({ blockDisposable: true, blockRoleBased: true }),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

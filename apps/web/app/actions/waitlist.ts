"use server";

import { z } from "zod";
import { schema } from "@recepto/db";
import { db } from "@/lib/db";

const emailSchema = z.string().trim().toLowerCase().email().max(320);

export interface WaitlistResult {
  ok: boolean;
  message: string;
}

export async function joinWaitlist(
  _previous: WaitlistResult | null,
  formData: FormData
): Promise<WaitlistResult> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { ok: false, message: "Please enter a valid email address." };
  }

  try {
    // Duplicate signups resolve as success so the form never leaks who is registered.
    await db
      .insert(schema.waitlistSignups)
      .values({ email: parsed.data, source: "landing" })
      .onConflictDoNothing();
    return { ok: true, message: "You're on the list — we'll email you at launch." };
  } catch (error) {
    console.error("Waitlist signup failed", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

import { clearAuthCookie } from "@/lib/auth/cookies";
import { ok } from "@/lib/api/response";

export async function POST() {
  await clearAuthCookie();
  return ok({ message: "Logged out" });
}

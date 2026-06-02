import { clearAuthCookie } from "@/server/auth/cookies";
import { ok } from "@/server/http/response";

export async function POST() {
  await clearAuthCookie();
  return ok({ message: "Logged out" });
}

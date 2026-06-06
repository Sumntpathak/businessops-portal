import { NextRequest } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/server/audit/audit-log";
import { requireRole } from "@/server/auth/rbac";
import { withAuth } from "@/server/http/with-auth";
import { err, ok } from "@/server/http/response";

const testSchema = z.object({
  type: z.enum(["email", "whatsapp", "payment"]),
  provider: z.string().trim().min(2).max(100),
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  requireRole(ctx, ["admin"]);

  const body = await req.json();
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

  void writeAuditLog({
    actorUserId: ctx.sub,
    action: "INTEGRATION_TEST",
    entityType: "integration",
    metadata: parsed.data,
  });

  return ok({ success: true, message: "Connection test passed (mock)" });
});

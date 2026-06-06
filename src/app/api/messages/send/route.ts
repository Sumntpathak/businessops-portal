import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { integrationConfigs, messageLogs, userPermissions } from "@/server/db/schema";
import { writeAuditLog } from "@/server/audit/audit-log";
import { requireRole } from "@/server/auth/rbac";
import { withAuth } from "@/server/http/with-auth";
import { err, ok } from "@/server/http/response";

const sendMessageSchema = z.object({
  channel: z.enum(["email", "whatsapp"]),
  recipient: z.string().trim().min(3).max(255),
  subject: z.string().trim().max(500).optional().nullable(),
  body: z.string().trim().min(1),
  relatedEntity: z.enum(["lead", "invoice"]).optional(),
  relatedId: z.string().uuid().optional(),
});

const permissionByChannel = {
  email: "can_send_email",
  whatsapp: "can_send_whatsapp",
} as const;

export const POST = withAuth(async (req: NextRequest, ctx) => {
  requireRole(ctx, ["admin", "manager", "agent", "finance"]);

  const body = await req.json();
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

  const message = parsed.data;
  const permission = permissionByChannel[message.channel];

  if (ctx.role !== "admin") {
    const [userPermission] = await db.select({ granted: userPermissions.granted })
      .from(userPermissions)
      .where(and(
        eq(userPermissions.userId, ctx.sub),
        eq(userPermissions.permission, permission),
        eq(userPermissions.granted, true)
      ))
      .limit(1);

    if (!userPermission) return err(`Missing permission: ${permission}`, 403);
  }

  const [enabledConfig] = await db.select({ id: integrationConfigs.id, provider: integrationConfigs.provider })
    .from(integrationConfigs)
    .where(and(
      eq(integrationConfigs.type, message.channel),
      eq(integrationConfigs.isEnabled, true)
    ))
    .limit(1);

  if (!enabledConfig) return err(`${message.channel} integration is not enabled`, 409);

  const [log] = await db.insert(messageLogs).values({
    channel: message.channel,
    recipient: message.recipient,
    subject: message.subject ?? null,
    body: message.body,
    status: "sent",
    relatedEntity: message.relatedEntity,
    relatedId: message.relatedId,
    sentBy: ctx.sub,
  }).returning({ id: messageLogs.id, status: messageLogs.status });

  void writeAuditLog({
    actorUserId: ctx.sub,
    action: "MESSAGE_SENT",
    entityType: message.relatedEntity ?? "message",
    entityId: message.relatedId ?? log.id,
    metadata: { channel: message.channel, recipient: message.recipient, messageId: log.id },
  });

  return ok({ messageId: log.id, status: log.status });
});

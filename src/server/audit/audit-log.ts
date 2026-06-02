import { db } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";

interface AuditParams {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget audit logger.
 * Never throws — audit failures must not break the main flow.
 */
export async function writeAuditLog(params: AuditParams) {
  try {
    await db.insert(auditLogs).values({
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    });
  } catch (err) {
    console.error("[audit] Failed to write audit log:", err);
  }
}

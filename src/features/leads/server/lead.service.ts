import { leadRepository } from "@/features/leads/server/lead.repository";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { writeAuditLog } from "@/server/audit/audit-log";
import { AuthError } from "@/server/auth/session";
import { requireRole } from "@/server/auth/rbac";
import { eq } from "drizzle-orm";
import type { JWTPayload } from "@/server/auth/jwt";
import type { BulkLeadDeleteInput, BulkLeadUpdateInput, CreateLeadInput, LeadQuery, UpdateLeadInput } from "@/features/leads/lead.schema";

async function assertAssignableAgent(userId: string | null | undefined) {
  if (!userId) return;
  const [user] = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.role !== "agent" || !user.isActive) {
    throw new AuthError(400, "assignedTo must be an active agent");
  }
}

function toDisplayCase(value: string | null | undefined) {
  if (!value) return value;
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function normalizeLeadInput<T extends CreateLeadInput | UpdateLeadInput>(data: T): T {
  return {
    ...data,
    name: data.name === undefined ? data.name : toDisplayCase(data.name),
    company: data.company === undefined ? data.company : toDisplayCase(data.company),
    notes: data.notes === undefined ? data.notes : data.notes.trim(),
    email: data.email === undefined ? data.email : data.email.trim().toLowerCase(),
  };
}

export const leadService = {
  list: (query: LeadQuery, ctx: JWTPayload) =>
    leadRepository.findMany(query, ctx.role === "agent" ? ctx.sub : undefined),

  getById: async (id: string, ctx: JWTPayload) => {
    const lead = await leadRepository.findById(id);
    if (!lead) throw new AuthError(404, "Lead not found");
    if (ctx.role === "agent" && lead.assignedTo !== ctx.sub) throw new AuthError(403, "Forbidden");
    return lead;
  },

  create: async (data: CreateLeadInput, ctx: JWTPayload) => {
    requireRole(ctx, ["admin", "manager"]);
    const normalized = normalizeLeadInput(data);
    await assertAssignableAgent(normalized.assignedTo);
    const lead = await leadRepository.create({ ...normalized, createdBy: ctx.sub });
    await writeAuditLog({ actorUserId: ctx.sub, action: "LEAD_CREATED", entityType: "lead", entityId: lead.id, metadata: { name: lead.name } });
    if (normalized.assignedTo) await writeAuditLog({ actorUserId: ctx.sub, action: "LEAD_ASSIGNED", entityType: "lead", entityId: lead.id, metadata: { from: null, to: normalized.assignedTo } });
    return lead;
  },

  update: async (id: string, data: UpdateLeadInput, ctx: JWTPayload) => {
    const normalized = normalizeLeadInput(data);
    const existing = await leadRepository.findById(id);
    if (!existing) throw new AuthError(404, "Lead not found");
    if (ctx.role === "agent" && existing.assignedTo !== ctx.sub) throw new AuthError(403, "Forbidden");
    if (ctx.role === "agent" && normalized.assignedTo !== undefined) throw new AuthError(403, "Agents cannot reassign leads");
    await assertAssignableAgent(normalized.assignedTo);

    const updated = ctx.role === "agent"
      ? await leadRepository.updateForAgent(id, ctx.sub, normalized)
      : await leadRepository.update(id, normalized);
    if (!updated) throw new AuthError(403, "Lead access changed before update");
    if (normalized.assignedTo && normalized.assignedTo !== existing.assignedTo) {
      await writeAuditLog({ actorUserId: ctx.sub, action: "LEAD_ASSIGNED", entityType: "lead", entityId: id, metadata: { from: existing.assignedTo, to: normalized.assignedTo } });
    }
    await writeAuditLog({ actorUserId: ctx.sub, action: "LEAD_UPDATED", entityType: "lead", entityId: id });
    return updated;
  },

  bulkUpdate: async (data: BulkLeadUpdateInput, ctx: JWTPayload) => {
    if (data.assignedTo !== undefined) {
      requireRole(ctx, ["admin", "manager"]);
      await assertAssignableAgent(data.assignedTo);
    }

    const patch: UpdateLeadInput = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.assignedTo !== undefined) patch.assignedTo = data.assignedTo;

    const updated = await leadRepository.bulkUpdate(
      data.ids,
      patch,
      ctx.role === "agent" ? ctx.sub : undefined,
    );

    if (updated.length === 0) throw new AuthError(403, "No selected leads could be updated");
    await writeAuditLog({
      actorUserId: ctx.sub,
      action: "LEADS_BULK_UPDATED",
      entityType: "lead",
      entityId: updated[0]?.id,
      metadata: { ids: updated.map((lead) => lead.id), status: data.status, assignedTo: data.assignedTo },
    });

    return { updated: updated.length };
  },

  delete: async (id: string, ctx: JWTPayload) => {
    requireRole(ctx, ["admin"]);
    const existing = await leadRepository.findById(id);
    if (!existing) throw new AuthError(404, "Lead not found");
    await leadRepository.delete(id);
    await writeAuditLog({ actorUserId: ctx.sub, action: "LEAD_DELETED", entityType: "lead", entityId: id, metadata: { name: existing.name } });
  },

  bulkDelete: async (data: BulkLeadDeleteInput, ctx: JWTPayload) => {
    requireRole(ctx, ["admin"]);
    const deleted = await leadRepository.bulkDelete(data.ids);
    if (deleted.length === 0) throw new AuthError(404, "No selected leads found");
    await writeAuditLog({
      actorUserId: ctx.sub,
      action: "LEADS_BULK_DELETED",
      entityType: "lead",
      entityId: deleted[0]?.id,
      metadata: { ids: deleted.map((lead) => lead.id) },
    });
    return { deleted: deleted.length };
  },
};

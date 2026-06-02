import { leadRepository } from "@/features/leads/server/lead.repository";
import { writeAuditLog } from "@/server/audit/audit-log";
import { AuthError } from "@/server/auth/session";
import { requireRole } from "@/server/auth/rbac";
import type { JWTPayload } from "@/server/auth/jwt";
import type { CreateLeadInput, LeadQuery, UpdateLeadInput } from "@/features/leads/lead.schema";

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
    const lead = await leadRepository.create({ ...data, createdBy: ctx.sub });
    void writeAuditLog({ actorUserId: ctx.sub, action: "LEAD_CREATED", entityType: "lead", entityId: lead.id, metadata: { name: lead.name } });
    if (data.assignedTo) void writeAuditLog({ actorUserId: ctx.sub, action: "LEAD_ASSIGNED", entityType: "lead", entityId: lead.id, metadata: { from: null, to: data.assignedTo } });
    return lead;
  },

  update: async (id: string, data: UpdateLeadInput, ctx: JWTPayload) => {
    const existing = await leadRepository.findById(id);
    if (!existing) throw new AuthError(404, "Lead not found");
    if (ctx.role === "agent" && existing.assignedTo !== ctx.sub) throw new AuthError(403, "Forbidden");
    if (ctx.role === "agent" && data.assignedTo !== undefined) throw new AuthError(403, "Agents cannot reassign leads");

    const updated = await leadRepository.update(id, data);
    if (data.assignedTo && data.assignedTo !== existing.assignedTo) {
      void writeAuditLog({ actorUserId: ctx.sub, action: "LEAD_ASSIGNED", entityType: "lead", entityId: id, metadata: { from: existing.assignedTo, to: data.assignedTo } });
    }
    void writeAuditLog({ actorUserId: ctx.sub, action: "LEAD_UPDATED", entityType: "lead", entityId: id });
    return updated;
  },

  delete: async (id: string, ctx: JWTPayload) => {
    requireRole(ctx, ["admin"]);
    const existing = await leadRepository.findById(id);
    if (!existing) throw new AuthError(404, "Lead not found");
    await leadRepository.delete(id);
    void writeAuditLog({ actorUserId: ctx.sub, action: "LEAD_DELETED", entityType: "lead", entityId: id, metadata: { name: existing.name } });
  },
};

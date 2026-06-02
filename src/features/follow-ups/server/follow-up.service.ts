import { followUpRepository } from "@/features/follow-ups/server/follow-up.repository";
import { leadService } from "@/features/leads/server/lead.service";
import { AuthError } from "@/server/auth/session";
import type { JWTPayload } from "@/server/auth/jwt";
import type { CreateFollowUpInput, FollowUpQuery, UpdateFollowUpInput } from "@/features/follow-ups/follow-up.schema";

export const followUpService = {
  listForLead: async (leadId: string, ctx: JWTPayload) => {
    await leadService.getById(leadId, ctx);
    return followUpRepository.findForLead(leadId);
  },

  listAll: (query: FollowUpQuery, ctx: JWTPayload) =>
    followUpRepository.findMany(query, ctx.role === "agent" ? ctx.sub : undefined),

  create: async (leadId: string, data: CreateFollowUpInput, ctx: JWTPayload) => {
    await leadService.getById(leadId, ctx);
    return followUpRepository.create({ ...data, leadId, createdBy: ctx.sub });
  },

  updateStatus: async (id: string, data: UpdateFollowUpInput, ctx: JWTPayload) => {
    const lead = await followUpRepository.getLeadForFollowup(id);
    if (!lead) throw new AuthError(404, "Follow-up not found");
    if (ctx.role === "agent" && lead.assignedTo !== ctx.sub) throw new AuthError(403, "Forbidden");
    return followUpRepository.updateStatus(id, data.status);
  },
};

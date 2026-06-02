import { leadHandlers } from "@/features/leads/server/lead.handlers";

export const GET = leadHandlers.getById;
export const PUT = leadHandlers.update;
export const DELETE = leadHandlers.delete;

import { leadHandlers } from "@/features/leads/server/lead.handlers";

export const GET = leadHandlers.list;
export const POST = leadHandlers.create;
export const PATCH = leadHandlers.bulkUpdate;
export const DELETE = leadHandlers.bulkDelete;

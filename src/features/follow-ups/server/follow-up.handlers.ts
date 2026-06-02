import { withAuth } from "@/server/http/with-auth";
import { ok, paginated, err } from "@/server/http/response";
import { followUpService } from "@/features/follow-ups/server/follow-up.service";
import { createFollowUpSchema, followUpQuerySchema, updateFollowUpSchema } from "@/features/follow-ups/follow-up.schema";

export const followUpHandlers = {
  listAll: withAuth(async (req, ctx) => {
    const qs = Object.fromEntries(req.nextUrl.searchParams);
    const parsed = followUpQuerySchema.safeParse(qs);
    if (!parsed.success) return err("Invalid query", 400, parsed.error.flatten().fieldErrors);
    const { rows, total } = await followUpService.listAll(parsed.data, ctx);
    return paginated(rows, total, parsed.data.page, parsed.data.limit);
  }),

  listForLead: withAuth(async (req, ctx, params) => {
    const { id } = await params as { id: string };
    return ok(await followUpService.listForLead(id, ctx));
  }),

  create: withAuth(async (req, ctx, params) => {
    const { id } = await params as { id: string };
    const body = await req.json();
    const parsed = createFollowUpSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    return ok(await followUpService.create(id, parsed.data, ctx), 201);
  }),

  updateStatus: withAuth(async (req, ctx, params) => {
    const { id } = await params as { id: string };
    const body = await req.json();
    const parsed = updateFollowUpSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    return ok(await followUpService.updateStatus(id, parsed.data, ctx));
  }),
};

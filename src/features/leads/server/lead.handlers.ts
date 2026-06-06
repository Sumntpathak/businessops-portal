import { withAuth } from "@/server/http/with-auth";
import { ok, paginated, err } from "@/server/http/response";
import { leadService } from "@/features/leads/server/lead.service";
import {
  bulkLeadDeleteSchema,
  bulkLeadUpdateSchema,
  createLeadSchema,
  leadQuerySchema,
  updateLeadSchema,
} from "@/features/leads/lead.schema";

export const leadHandlers = {
  list: withAuth(async (req, ctx) => {
    const qs = Object.fromEntries(req.nextUrl.searchParams);
    const parsed = leadQuerySchema.safeParse(qs);
    if (!parsed.success) return err("Invalid query", 400, parsed.error.flatten().fieldErrors);
    const { rows, total } = await leadService.list(parsed.data, ctx);
    return paginated(rows, total, parsed.data.page, parsed.data.limit);
  }),

  create: withAuth(async (req, ctx) => {
    const body = await req.json();
    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    return ok(await leadService.create(parsed.data, ctx), 201);
  }),

  bulkUpdate: withAuth(async (req, ctx) => {
    const body = await req.json();
    const parsed = bulkLeadUpdateSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    return ok(await leadService.bulkUpdate(parsed.data, ctx));
  }),

  bulkDelete: withAuth(async (req, ctx) => {
    const body = await req.json();
    const parsed = bulkLeadDeleteSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    return ok(await leadService.bulkDelete(parsed.data, ctx));
  }),

  getById: withAuth(async (req, ctx, params) => {
    const { id } = await params as { id: string };
    return ok(await leadService.getById(id, ctx));
  }),

  update: withAuth(async (req, ctx, params) => {
    const { id } = await params as { id: string };
    const body = await req.json();
    const parsed = updateLeadSchema.safeParse(body);
    if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    return ok(await leadService.update(id, parsed.data, ctx));
  }),

  delete: withAuth(async (req, ctx, params) => {
    const { id } = await params as { id: string };
    await leadService.delete(id, ctx);
    return ok({ message: "Lead deleted" });
  }),
};

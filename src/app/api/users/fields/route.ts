import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { userFieldDefinitions } from "@/server/db/schema";
import { withAuth } from "@/server/http/with-auth";
import { requireRole } from "@/server/auth/rbac";
import { err, ok } from "@/server/http/response";

const createFieldSchema = z.object({
  fieldKey:   z.string().trim().min(2).max(50).regex(/^[a-z0-9_]+$/, "Only lowercase letters, numbers and underscores"),
  label:      z.string().trim().min(1).max(100),
  fieldType:  z.enum(["text", "email", "phone", "number", "select"]).default("text"),
  isRequired: z.boolean().default(false),
  options:    z.array(z.string().trim().min(1)).optional(), // for select type
});

export const GET = withAuth(async (_req, ctx) => {
  requireRole(ctx, ["admin", "manager"]);
  const rows = await db.select().from(userFieldDefinitions).orderBy(userFieldDefinitions.createdAt);
  return ok(rows.map((f) => ({ ...f, options: f.options ? JSON.parse(f.options) : [] })));
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  requireRole(ctx, ["admin"]);
  const body = await req.json();
  const parsed = createFieldSchema.safeParse(body);
  if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

  try {
    const [field] = await db.insert(userFieldDefinitions).values({
      fieldKey:   parsed.data.fieldKey,
      label:      parsed.data.label,
      fieldType:  parsed.data.fieldType,
      isRequired: parsed.data.isRequired,
      options:    parsed.data.options?.length ? JSON.stringify(parsed.data.options) : null,
      createdBy:  ctx.sub,
    }).returning();
    return ok({ ...field, options: field.options ? JSON.parse(field.options) : [] }, 201);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "23505") return err("A field with that key already exists", 409);
    throw e;
  }
});

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { users, userFieldDefinitions } from "@/server/db/schema";
import { withAuth } from "@/server/http/with-auth";
import { err, ok } from "@/server/http/response";
import { AuthError } from "@/server/auth/session";
import { writeAuditLog } from "@/server/audit/audit-log";

const profileSchema = z.object({
  name:        z.string().trim().min(2).max(255).optional(),
  phone:       z.string().trim().max(30).optional().nullable(),
  profileData: z.record(z.string(), z.string().max(500)).optional(), // custom field values
});

export const GET = withAuth(async (_req, ctx, params) => {
  const { id } = await params as { id: string };
  // Users can view their own profile; admin/manager can view anyone
  if (ctx.role !== "admin" && ctx.role !== "manager" && ctx.sub !== id) {
    throw new AuthError(403, "Forbidden");
  }

  // Try full query with new columns; fall back if db:push hasn't run yet
  let user: { id: string; name: string; email: string; role: string; phone: string | null; profileData: string | null; isActive: boolean; createdAt: Date } | undefined;
  try {
    [user] = await db.select({
      id: users.id, name: users.name, email: users.email,
      role: users.role, phone: users.phone, profileData: users.profileData,
      isActive: users.isActive, createdAt: users.createdAt,
    }).from(users).where(eq(users.id, id)).limit(1);
  } catch {
    // phone/profile_data columns missing — db:push not run yet
    const [base] = await db.select({
      id: users.id, name: users.name, email: users.email,
      role: users.role, isActive: users.isActive, createdAt: users.createdAt,
    }).from(users).where(eq(users.id, id)).limit(1);
    if (base) user = { ...base, phone: null, profileData: null };
  }

  if (!user) throw new AuthError(404, "User not found");

  let fieldDefs: typeof userFieldDefinitions.$inferSelect[] = [];
  try {
    fieldDefs = await db.select().from(userFieldDefinitions).orderBy(userFieldDefinitions.createdAt);
  } catch {
    // Table may not exist yet if db:push has not been run — return empty definitions
  }

  return ok({
    ...user,
    profileData: user.profileData ? JSON.parse(user.profileData) : {},
    fieldDefinitions: fieldDefs.map((f) => ({
      ...f,
      options: f.options ? JSON.parse(f.options) : [],
    })),
  });
});

export const PUT = withAuth(async (req: NextRequest, ctx, params) => {
  const { id } = await params as { id: string };
  // Users can edit their own profile; admins can edit anyone
  if (ctx.role !== "admin" && ctx.sub !== id) {
    throw new AuthError(403, "Forbidden");
  }

  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return err("Validation failed", 400, parsed.error.flatten().fieldErrors);

  const [existing] = await db.select({ id: users.id, profileData: users.profileData })
    .from(users).where(eq(users.id, id)).limit(1);
  if (!existing) throw new AuthError(404, "User not found");

  // Validate required custom fields if profileData provided
  if (parsed.data.profileData !== undefined) {
    const fieldDefs = await db.select().from(userFieldDefinitions);
    const requiredMissing = fieldDefs
      .filter((f) => f.isRequired && !parsed.data.profileData?.[f.fieldKey]?.trim())
      .map((f) => f.label);
    if (requiredMissing.length > 0) {
      return err(`Required fields missing: ${requiredMissing.join(", ")}`, 400);
    }
  }

  // Merge new custom data over existing — don't wipe fields not sent
  const existingProfileData = existing.profileData ? JSON.parse(existing.profileData) as Record<string, string> : {};
  const mergedProfileData = parsed.data.profileData !== undefined
    ? { ...existingProfileData, ...parsed.data.profileData }
    : existingProfileData;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone;
  updates.profileData = JSON.stringify(mergedProfileData);

  await db.update(users).set(updates).where(eq(users.id, id));

  void writeAuditLog({
    actorUserId: ctx.sub,
    action: "USER_PROFILE_UPDATED",
    entityType: "user",
    entityId: id,
    metadata: { updatedFields: Object.keys(parsed.data) },
  });

  return ok({ message: "Profile updated" });
});

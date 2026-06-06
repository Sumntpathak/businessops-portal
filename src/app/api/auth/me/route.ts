import { getSession } from "@/server/auth/session";
import { ok, err } from "@/server/http/response";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { signToken } from "@/server/auth/jwt";
import { setAuthCookie } from "@/server/auth/cookies";
import { writeAuditLog } from "@/server/audit/audit-log";

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
});

export async function GET() {
  const ctx = await getSession();
  if (!ctx) return err("Unauthenticated", 401);
  return ok({ id: ctx.sub, email: ctx.email, name: ctx.name, role: ctx.role });
}

export async function PUT(req: Request) {
  const ctx = await getSession();
  if (!ctx) return err("Unauthenticated", 401);

  try {
    const body = await req.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return err("Validation failed", 400, parsed.error.flatten().fieldErrors);
    }

    const { name, email, currentPassword, newPassword } = parsed.data;

    // Load the user from the database
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.sub))
      .limit(1);

    if (!user) return err("User not found", 404);

    const updateFields: { name?: string; email?: string; passwordHash?: string; updatedAt: Date } = { updatedAt: new Date() };

    if (name !== undefined) updateFields.name = name;
    if (email !== undefined) {
      // Check if email is already taken by another user
      if (email.toLowerCase() !== user.email.toLowerCase()) {
        const [existing] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1);
        if (existing) return err("Email already registered", 409);
        updateFields.email = email.toLowerCase();
      }
    }

    if (newPassword !== undefined) {
      if (!currentPassword) {
        return err("Current password is required to set a new password", 400);
      }
      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) return err("Incorrect current password", 400);
      
      updateFields.passwordHash = await bcrypt.hash(newPassword, 12);
    }

    // Perform update
    const [updated] = await db
      .update(users)
      .set(updateFields)
      .where(eq(users.id, ctx.sub))
      .returning();

    // If name or email changed, issue a new JWT cookie
    if (name !== undefined || email !== undefined) {
      const newToken = await signToken({
        sub: updated.id,
        email: updated.email,
        role: updated.role,
        name: updated.name,
      });
      await setAuthCookie(newToken);
    }

    // Write audit log
    await writeAuditLog({
      actorUserId: ctx.sub,
      action: "USER_PROFILE_UPDATED",
      entityType: "user",
      entityId: ctx.sub,
      metadata: { name: name !== undefined, email: email !== undefined, passwordChanged: newPassword !== undefined },
    });

    return ok({ id: updated.id, email: updated.email, name: updated.name, role: updated.role });
  } catch (e) {
    console.error("[profile-update]", e);
    return err("Internal server error", 500);
  }
}

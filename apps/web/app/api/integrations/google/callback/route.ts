import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptRefreshToken, schema, withTenant } from "@recepto/db";
import { validateEnv } from "@recepto/shared/env";
import { getSessionUser } from "@/lib/auth-helpers";
import { calendarService } from "@/lib/calendar";
import { db } from "@/lib/db";
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  verifyGoogleOAuthState
} from "@/lib/google-oauth-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

function settingsRedirect(request: NextRequest, result: string) {
  return NextResponse.redirect(
    new URL("/dashboard/settings?google=" + encodeURIComponent(result), request.url)
  );
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  const parsed = callbackQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  const oauthError = request.nextUrl.searchParams.get("error");
  const cookieValue = cookies().get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  cookies().delete(GOOGLE_OAUTH_STATE_COOKIE);

  if (!user || oauthError || !parsed.success || !cookieValue) {
    return settingsRedirect(request, "denied");
  }

  const env = validateEnv(process.env);
  const payload = verifyGoogleOAuthState(
    parsed.data.state,
    cookieValue,
    env.SESSION_SECRET
  );
  if (!payload || payload.userId !== user.id) {
    return settingsRedirect(request, "invalid_state");
  }

  const [membership] = await db
    .select({ id: schema.tenantMembers.id })
    .from(schema.tenantMembers)
    .where(
      and(
        eq(schema.tenantMembers.userId, user.id),
        eq(schema.tenantMembers.tenantId, payload.tenantId)
      )
    )
    .limit(1);

  if (!membership) return settingsRedirect(request, "forbidden");

  try {
    const token = await calendarService.exchangeAuthorizationCode(parsed.data.code);
    if (!token.refresh_token) {
      return settingsRedirect(request, "missing_refresh_token");
    }

    const encryptedRefreshToken = encryptRefreshToken(
      token.refresh_token,
      env.SESSION_SECRET
    );
    const scoped = withTenant(db, payload.tenantId);
    await db
      .insert(schema.googleConnections)
      .values(
        scoped.values({
          refreshToken: encryptedRefreshToken,
          calendarId: "primary",
          connectedBy: user.id,
          status: "active"
        })
      )
      .onConflictDoUpdate({
        target: schema.googleConnections.tenantId,
        set: {
          refreshToken: encryptedRefreshToken,
          calendarId: "primary",
          connectedBy: user.id,
          status: "active",
          updatedAt: new Date()
        }
      });

    return settingsRedirect(request, "connected");
  } catch (error) {
    console.error("Google Calendar OAuth callback failed", error);
    return settingsRedirect(request, "failed");
  }
}

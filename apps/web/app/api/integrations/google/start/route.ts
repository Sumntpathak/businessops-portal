import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateEnv } from "@recepto/shared/env";
import { getApiTenantContext } from "@/lib/api-auth";
import { calendarService } from "@/lib/calendar";
import {
  createGoogleOAuthState,
  GOOGLE_OAUTH_STATE_COOKIE
} from "@/lib/google-oauth-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


export async function GET() {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const env = validateEnv(process.env);
  const oauth = createGoogleOAuthState(
    auth.context.user.id,
    auth.context.tenantId,
    env.SESSION_SECRET
  );

  cookies().set(GOOGLE_OAUTH_STATE_COOKIE, oauth.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60
  });

  return NextResponse.redirect(
    calendarService.getAuthorizationUrl(oauth.state, auth.context.user.email)
  );
}

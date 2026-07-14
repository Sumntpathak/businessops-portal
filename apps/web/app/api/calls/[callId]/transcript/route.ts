import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema, withTenant } from "@recepto/db";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { callId: string } }
) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const parsed = z.string().uuid().safeParse(params.callId);
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid call ID.", 400);

  try {
    const scoped = withTenant(db, auth.context.tenantId);
    const [call] = await db
      .select({ status: schema.calls.status })
      .from(schema.calls)
      .where(scoped.where(schema.calls, eq(schema.calls.id, parsed.data)))
      .limit(1);

    if (!call) return apiError("CALL_NOT_FOUND", "Call not found.", 404);

    const entries = await db
      .select({
        id: schema.callTranscripts.id,
        seq: schema.callTranscripts.seq,
        role: schema.callTranscripts.role,
        content: schema.callTranscripts.content,
        at: schema.callTranscripts.at
      })
      .from(schema.callTranscripts)
      .where(
        scoped.where(
          schema.callTranscripts,
          eq(schema.callTranscripts.callId, parsed.data)
        )
      )
      .orderBy(asc(schema.callTranscripts.seq));

    return NextResponse.json({
      data: {
        status: call.status,
        entries: entries.map((entry) => ({
          ...entry,
          at: entry.at.toISOString()
        }))
      }
    });
  } catch (error) {
    console.error("Call transcript fetch failed", error);
    return apiError("TRANSCRIPT_FETCH_FAILED", "Could not load the transcript.", 500);
  }
}

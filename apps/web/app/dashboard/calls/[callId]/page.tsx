import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@recepto/db";
import { requireTenant } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

export default async function CallDetailPage({
  params
}: {
  params: { callId: string };
}) {
  const parsed = z.string().uuid().safeParse(params.callId);
  if (!parsed.success) notFound();

  const context = await requireTenant();
  const scoped = withTenant(db, context.tenantId);
  const [call] = await db
    .select({
      id: schema.calls.id,
      startedAt: schema.calls.startedAt,
      endedAt: schema.calls.endedAt,
      durationSeconds: schema.calls.durationSeconds,
      status: schema.calls.status,
      callerName: schema.callers.displayName,
      callerPhone: schema.callers.phoneE164
    })
    .from(schema.calls)
    .innerJoin(
      schema.callers,
      and(
        eq(schema.callers.id, schema.calls.callerId),
        eq(schema.callers.tenantId, context.tenantId)
      )
    )
    .where(scoped.where(schema.calls, eq(schema.calls.id, parsed.data)))
    .limit(1);

  if (!call) notFound();

  const transcript = await db
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
        eq(schema.callTranscripts.callId, call.id)
      )
    )
    .orderBy(asc(schema.callTranscripts.seq));

  return (
    <section className="mx-auto max-w-4xl">
      <Link href="/dashboard/calls" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to calls
      </Link>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Call detail</p>
          <h1 className="mt-2 text-3xl font-semibold">
            {call.callerName ?? "Caller " + call.callerPhone.slice(-4)}
          </h1>
        </div>
        <div className="text-right text-sm">
          <p className="capitalize">{call.status.replace("_", " ")}</p>
          <p className="mt-1 text-muted-foreground">
            {call.durationSeconds == null ? "Duration unavailable" : call.durationSeconds + " seconds"}
          </p>
        </div>
      </div>

      <section className="mt-8 rounded-xl border">
        <div className="border-b p-5">
          <h2 className="font-semibold">Transcript</h2>
        </div>
        {transcript.length === 0 ? (
          <p className="p-12 text-center text-sm text-muted-foreground">
            No transcript events were captured for this call.
          </p>
        ) : (
          <ol className="space-y-5 p-5">
            {transcript.map((entry) => (
              <li
                key={entry.id}
                className={entry.role === "agent" ? "ml-auto max-w-[85%]" : "max-w-[85%]"}
              >
                <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <span>{entry.role}</span>
                  <time>{new Intl.DateTimeFormat("en-IN", { timeStyle: "medium" }).format(entry.at)}</time>
                </div>
                <p className="rounded-lg border bg-muted/20 p-3 text-sm leading-6">
                  {entry.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

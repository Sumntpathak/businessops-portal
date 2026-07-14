import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { MonitorSmartphone } from "lucide-react";
import { z } from "zod";
import { schema, withTenant } from "@recepto/db";
import { LiveTranscript } from "@/components/dashboard/live-transcript";
import { PageHeader, PageShell } from "@/components/dashboard/page-shell";
import { requireTenant } from "@/lib/auth-helpers";
import {
  STATUS_STYLES,
  formatDuration,
  initialsFor,
  lastFour,
  paletteFor
} from "@/lib/caller-display";
import { db } from "@/lib/db";
import { resolveDisplayedCountry } from "@/lib/intake-fields";

export const dynamic = "force-dynamic";

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
      providerCallSid: schema.calls.providerCallSid,
      callerId: schema.callers.id,
      callerName: schema.callers.displayName,
      callerPhone: schema.callers.phoneE164,
      callerCountry: schema.callers.country,
      callerTimezone: schema.callers.timezone,
      callerProfile: schema.callers.profile,
      callerStage: schema.callers.stage
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

  const [transcript, intakeFields, memories, previousCalls, bookings] = await Promise.all([
    db
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
      .orderBy(asc(schema.callTranscripts.seq)),
    db
      .select({
        key: schema.intakeFields.key,
        label: schema.intakeFields.label
      })
      .from(schema.intakeFields)
      .where(scoped.where(schema.intakeFields, eq(schema.intakeFields.active, true)))
      .orderBy(asc(schema.intakeFields.sort)),
    db
      .select({
        id: schema.callerMemories.id,
        kind: schema.callerMemories.kind,
        content: schema.callerMemories.content
      })
      .from(schema.callerMemories)
      .where(
        scoped.where(
          schema.callerMemories,
          and(
            eq(schema.callerMemories.callerId, call.callerId),
            ne(schema.callerMemories.kind, "summary")
          )
        )
      )
      .orderBy(desc(schema.callerMemories.createdAt))
      .limit(8),
    db
      .select({
        id: schema.calls.id,
        startedAt: schema.calls.startedAt,
        status: schema.calls.status,
        durationSeconds: schema.calls.durationSeconds
      })
      .from(schema.calls)
      .where(
        scoped.where(
          schema.calls,
          and(eq(schema.calls.callerId, call.callerId), ne(schema.calls.id, call.id))
        )
      )
      .orderBy(desc(schema.calls.startedAt))
      .limit(5),
    db
      .select({
        id: schema.bookings.id,
        startsAt: schema.bookings.startsAt,
        status: schema.bookings.status,
        sourceCallId: schema.bookings.sourceCallId,
        serviceName: schema.services.name
      })
      .from(schema.bookings)
      .innerJoin(
        schema.services,
        and(
          eq(schema.services.id, schema.bookings.serviceId),
          eq(schema.services.tenantId, context.tenantId)
        )
      )
      .where(
        scoped.where(
          schema.bookings,
          eq(schema.bookings.callerId, call.callerId)
        )
      )
      .orderBy(desc(schema.bookings.startsAt))
      .limit(6)
  ]);

  const isBrowserTest = call.providerCallSid.startsWith("browser-test-");
  const displayedCountry = resolveDisplayedCountry(
    call.callerProfile,
    intakeFields.map((field) => field.key),
    call.callerCountry
  );
  const title = isBrowserTest
    ? "Browser test call"
    : call.callerName ?? "Caller " + call.callerPhone.slice(-4);

  return (
    <PageShell>
      <PageHeader
        eyebrow={
          <Link href="/dashboard/calls" className="hover:text-foreground">
            ← Back to calls
          </Link>
        }
        title={title}
        actions={
          <div className="text-right text-sm">
            <span
              className={
                "inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize " +
                (STATUS_STYLES[call.status] ?? "bg-muted text-muted-foreground")
              }
            >
              {call.status.replace("_", " ")}
            </span>
            <p className="mt-1.5 text-muted-foreground">
              {formatDuration(call.durationSeconds)}
            </p>
          </div>
        }
      />

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6 lg:overflow-visible">
        <div className="lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <LiveTranscript
            callId={call.id}
            initialStatus={call.status}
            initialEntries={transcript.map((entry) => ({
              ...entry,
              at: entry.at.toISOString()
            }))}
          />
        </div>

        <aside className="mt-6 space-y-6 pb-1 lg:mt-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <section className="rounded-xl border p-5">
            <div className="flex items-center gap-3">
              <span
                className={
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold " +
                  paletteFor(call.callerPhone)
                }
              >
                {isBrowserTest ? (
                  <MonitorSmartphone className="h-4 w-4" />
                ) : (
                  initialsFor(call.callerName, call.callerPhone)
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {call.callerName ?? (isBrowserTest ? "Browser test" : "Unknown caller")}
                </p>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {isBrowserTest ? lastFour(call.callerPhone) : call.callerPhone}
                </p>
              </div>
            </div>
            <dl className="mt-4 space-y-2.5 border-t pt-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Stage</dt>
                <dd className="capitalize">{call.callerStage.replace("_", " ")}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Country</dt>
                <dd>{displayedCountry ?? "Not known"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Timezone</dt>
                <dd className="truncate">{call.callerTimezone ?? "Business default"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Started</dt>
                <dd>
                  {new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short"
                  }).format(call.startedAt)}
                </dd>
              </div>
            </dl>
          </section>

          {bookings.length > 0 && (
            <section className="rounded-xl border p-5">
              <h2 className="text-sm font-semibold">Bookings</h2>
              <ul className="mt-3 divide-y text-sm">
                {bookings.map((booking) => (
                  <li key={booking.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate font-medium">{booking.serviceName}</p>
                      <span
                        className={
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize " +
                          (booking.status === "confirmed"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400")
                        }
                      >
                        {booking.status}
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short"
                      }).format(booking.startsAt)}
                      {booking.sourceCallId === call.id && (
                        <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                          Booked on this call
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border p-5">
            <h2 className="text-sm font-semibold">Intake details</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              {intakeFields.map((field) => {
                const value = call.callerProfile[field.key];
                const empty = value === undefined || value === "";
                return (
                  <div key={field.key} className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{field.label}</dt>
                    <dd className={"text-right " + (empty ? "italic text-muted-foreground" : "")}>
                      {empty
                        ? "Not known"
                        : typeof value === "boolean"
                          ? value
                            ? "Yes"
                            : "No"
                          : String(value)}
                    </dd>
                  </div>
                );
              })}
              {intakeFields.length === 0 && (
                <p className="text-muted-foreground">No active intake fields.</p>
              )}
            </dl>
          </section>

          {memories.length > 0 && (
            <section className="rounded-xl border p-5">
              <h2 className="text-sm font-semibold">Notes &amp; preferences</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {memories.map((memory) => (
                  <li key={memory.id} className="flex gap-2">
                    <span className="mt-0.5 shrink-0 rounded-full border px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {memory.kind}
                    </span>
                    <span className="leading-6">{memory.content}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {previousCalls.length > 0 && (
            <section className="rounded-xl border p-5">
              <h2 className="text-sm font-semibold">Previous calls</h2>
              <ul className="mt-3 divide-y text-sm">
                {previousCalls.map((previous) => (
                  <li key={previous.id}>
                    <Link
                      href={"/dashboard/calls/" + previous.id}
                      className="flex items-center justify-between gap-3 py-2.5 transition hover:text-foreground"
                    >
                      <span className="text-muted-foreground">
                        {new Intl.DateTimeFormat("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short"
                        }).format(previous.startedAt)}
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize " +
                            (STATUS_STYLES[previous.status] ?? "bg-muted text-muted-foreground")
                          }
                        >
                          {previous.status.replace("_", " ")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(previous.durationSeconds)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </PageShell>
  );
}

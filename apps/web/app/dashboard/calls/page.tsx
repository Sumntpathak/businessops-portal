import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@recepto/db";
import { requireTenant } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

function lastFour(phone: string) {
  return "••••" + phone.slice(-4);
}

export default async function CallsPage() {
  const context = await requireTenant();
  const scoped = withTenant(db, context.tenantId);
  const calls = await db
    .select({
      id: schema.calls.id,
      startedAt: schema.calls.startedAt,
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
    .where(scoped.where(schema.calls))
    .orderBy(desc(schema.calls.startedAt))
    .limit(100);

  return (
    <section>
      <p className="text-sm text-muted-foreground">Voice activity</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Calls</h1>

      <div className="mt-8 overflow-hidden rounded-xl border">
        {calls.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-medium">No calls yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Incoming calls will appear here after your Twilio number is active.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {calls.map((call) => (
              <Link
                key={call.id}
                href={"/dashboard/calls/" + call.id}
                className="flex flex-wrap items-center justify-between gap-4 p-5 transition hover:bg-muted/30"
              >
                <div>
                  <p className="font-medium">
                    {call.callerName ?? lastFour(call.callerPhone)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short"
                    }).format(call.startedAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm capitalize">{call.status.replace("_", " ")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {call.durationSeconds == null ? "—" : call.durationSeconds + " sec"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

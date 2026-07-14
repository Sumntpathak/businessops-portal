import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@recepto/db";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import {
  CallsList,
  type CallListItem,
  type CallerGroup
} from "@/components/dashboard/calls-list";
import { requireTenant } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  const context = await requireTenant();
  const scoped = withTenant(db, context.tenantId);
  const calls = await db
    .select({
      id: schema.calls.id,
      startedAt: schema.calls.startedAt,
      durationSeconds: schema.calls.durationSeconds,
      status: schema.calls.status,
      providerCallSid: schema.calls.providerCallSid,
      callerId: schema.callers.id,
      callerName: schema.callers.displayName,
      callerPhone: schema.callers.phoneE164,
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
    .where(scoped.where(schema.calls))
    .orderBy(desc(schema.calls.startedAt))
    .limit(200);

  const summaryRows = calls.length
    ? await db
        .select({
          sourceCallId: schema.callerMemories.sourceCallId,
          content: schema.callerMemories.content
        })
        .from(schema.callerMemories)
        .where(
          scoped.where(
            schema.callerMemories,
            and(
              eq(schema.callerMemories.kind, "summary"),
              inArray(
                schema.callerMemories.sourceCallId,
                calls.map((call) => call.id)
              )
            )
          )
        )
    : [];

  const summaryByCall = new Map<string, string>();
  for (const row of summaryRows) {
    if (row.sourceCallId && !summaryByCall.has(row.sourceCallId)) {
      summaryByCall.set(row.sourceCallId, row.content);
    }
  }

  const phoneCalls = calls.filter(
    (call) => !call.providerCallSid.startsWith("browser-test-")
  );
  const testCalls = calls.filter((call) =>
    call.providerCallSid.startsWith("browser-test-")
  );

  // Rows are newest-first, so per caller the last row seen is call #1.
  const groupByCaller = new Map<string, CallerGroup>();
  for (const call of phoneCalls) {
    const group = groupByCaller.get(call.callerId) ?? {
      callerId: call.callerId,
      name: call.callerName,
      phone: call.callerPhone,
      stage: call.callerStage,
      calls: []
    };
    group.calls.push({
      id: call.id,
      startedAt: call.startedAt.toISOString(),
      durationSeconds: call.durationSeconds,
      status: call.status,
      summary: summaryByCall.get(call.id) ?? null,
      callNumber: 0
    });
    groupByCaller.set(call.callerId, group);
  }
  const groups = [...groupByCaller.values()].map((group) => ({
    ...group,
    calls: group.calls.map((call, index) => ({
      ...call,
      callNumber: group.calls.length - index
    }))
  }));

  const tests: CallListItem[] = testCalls.map((call) => ({
    id: call.id,
    startedAt: call.startedAt.toISOString(),
    durationSeconds: call.durationSeconds,
    status: call.status,
    summary: summaryByCall.get(call.id) ?? null,
    callNumber: 1
  }));

  return (
    <section className="flex h-full min-h-0 flex-col">
      <AutoRefresh />
      <CallsList groups={groups} tests={tests} />
    </section>
  );
}

import { and, asc, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { schema, withTenant, type createDatabase } from "@recepto/db";
import type { CallSession, CallerHistory } from "./call-session.js";

type Database = ReturnType<typeof createDatabase>;

export const EMPTY_HISTORY: CallerHistory = { upcomingBookings: [], pendingCallbacks: [], lastCallAt: null };

/** How much history goes into the prompt: enough to recognise a caller, never a full record. */
const MAX_MEMORIES = 5;
const MAX_BOOKINGS = 3;
const MAX_CALLBACKS = 3;

/**
 * Everything the receptionist should know about a returning caller before saying hello:
 * saved memories (including past call summaries), upcoming bookings, open callback
 * requests and when they last called. All queries run in parallel.
 */
export async function loadCallerContext(
  db: Database,
  tenantId: string,
  callerId: string,
  currentProviderCallSid: string
): Promise<{ memories: CallSession["memories"]; history: CallerHistory }> {
  const scoped = withTenant(db, tenantId);
  const [memories, bookings, callbacks, previousCalls] = await Promise.all([
    db
      .select({ id: schema.callerMemories.id, kind: schema.callerMemories.kind, content: schema.callerMemories.content })
      .from(schema.callerMemories)
      .where(scoped.where(schema.callerMemories, eq(schema.callerMemories.callerId, callerId)))
      .orderBy(desc(schema.callerMemories.createdAt))
      .limit(MAX_MEMORIES),
    db
      .select({ serviceName: schema.services.name, startsAt: schema.bookings.startsAt })
      .from(schema.bookings)
      .innerJoin(
        schema.services,
        and(eq(schema.services.id, schema.bookings.serviceId), eq(schema.services.tenantId, tenantId))
      )
      .where(
        scoped.where(
          schema.bookings,
          and(
            eq(schema.bookings.callerId, callerId),
            eq(schema.bookings.status, "confirmed"),
            gte(schema.bookings.startsAt, new Date()),
            isNull(schema.bookings.deletedAt)
          )
        )
      )
      .orderBy(asc(schema.bookings.startsAt))
      .limit(MAX_BOOKINGS),
    db
      .select({ reason: schema.callbackRequests.reason, createdAt: schema.callbackRequests.createdAt })
      .from(schema.callbackRequests)
      .where(
        scoped.where(
          schema.callbackRequests,
          and(eq(schema.callbackRequests.callerId, callerId), eq(schema.callbackRequests.status, "pending"))
        )
      )
      .orderBy(desc(schema.callbackRequests.createdAt))
      .limit(MAX_CALLBACKS),
    db
      .select({ startedAt: schema.calls.startedAt })
      .from(schema.calls)
      .where(
        scoped.where(
          schema.calls,
          and(eq(schema.calls.callerId, callerId), ne(schema.calls.providerCallSid, currentProviderCallSid))
        )
      )
      .orderBy(desc(schema.calls.startedAt))
      .limit(1)
  ]);

  return {
    memories,
    history: {
      upcomingBookings: bookings.map((booking) => ({
        serviceName: booking.serviceName,
        startsAt: booking.startsAt.toISOString()
      })),
      pendingCallbacks: callbacks.map((callback) => ({
        reason: callback.reason,
        createdAt: callback.createdAt.toISOString()
      })),
      lastCallAt: previousCalls[0]?.startedAt.toISOString() ?? null
    }
  };
}

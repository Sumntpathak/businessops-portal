import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolExecutor, type ToolExecutorDependencies } from "./tools.js";
import type { CallSession } from "./call-session.js";

const session: CallSession = {
  callId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f3",
  providerCallSid: "CA123",
  tenantId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f4",
  caller: {
    id: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f5",
    phoneE164: "+919876543210",
    displayName: "Asha"
  },
  agent: { agentMd: "# Clinic", voiceGreeting: "Hello", languageMode: "hinglish" },
  memories: [],
  startedAt: "2026-07-06T04:00:00.000Z"
};

function harness() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const service = {
    id: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f6",
    name: "Consultation",
    durationMinutes: 30
  };
  const dependencies: ToolExecutorDependencies = {
    availability: {
      getSlots: async (...args: any[]) => {
        calls.push({ name: "getSlots", args });
        return [{
          startsAt: new Date("2026-07-07T03:30:00.000Z"),
          endsAt: new Date("2026-07-07T04:00:00.000Z")
        }];
      }
    },
    calendar: {
      createEvent: async (...args: any[]) => {
        calls.push({ name: "createEvent", args });
        return "gcal-1";
      },
      deleteEvent: async (...args: any[]) => { calls.push({ name: "deleteEvent", args }); }
    },
    repository: {
      findService: async (...args: any[]) => { calls.push({ name: "findService", args }); return service; },
      updateCallerName: async (...args: any[]) => { calls.push({ name: "updateCallerName", args }); },
      createBooking: async (...args: any[]) => { calls.push({ name: "createBooking", args }); return { id: "booking-1" }; },
      findConfirmedBooking: async (...args: any[]) => { calls.push({ name: "findConfirmedBooking", args }); return { id: "booking-1", gcalEventId: "gcal-1" }; },
      cancelBooking: async (...args: any[]) => { calls.push({ name: "cancelBooking", args }); },
      saveMemory: async (...args: any[]) => { calls.push({ name: "saveMemory", args }); return { id: "memory-1" }; },
      getCallerContext: async (...args: any[]) => { calls.push({ name: "getCallerContext", args }); return { caller: session.caller, memories: [], upcomingBookings: [] }; }
    }
  };
  return { executor: new ToolExecutor(session, dependencies), calls, service };
}

describe("ToolExecutor", () => {
  it("resolves a service name and scopes availability to the session tenant", async () => {
    const { executor, calls, service } = harness();
    const result = await executor.execute("check_availability", {
      serviceName: "Consultation", date: "2026-07-07"
    });
    assert.deepEqual(result, { serviceId: service.id, slots: [{ startsAt: "2026-07-07T03:30:00.000Z", endsAt: "2026-07-07T04:00:00.000Z" }] });
    assert.deepEqual(calls.find((call) => call.name === "findService")?.args, [session.tenantId, { serviceName: "Consultation" }]);
    assert.deepEqual(calls.find((call) => call.name === "getSlots")?.args, [session.tenantId, service.id, "2026-07-07"]);
  });

  it("creates a caller-scoped booking and matching calendar event", async () => {
    const { executor, calls, service } = harness();
    const result = await executor.execute("create_booking", {
      serviceId: service.id,
      startsAt: "2026-07-07T03:30:00.000Z",
      callerName: "Asha Patel"
    });
    assert.deepEqual(result, { bookingId: "booking-1", eventId: "gcal-1", startsAt: "2026-07-07T03:30:00.000Z", endsAt: "2026-07-07T04:00:00.000Z", serviceName: "Consultation" });
    const create = calls.find((call) => call.name === "createBooking");
    assert.equal(create?.args[0], session.tenantId);
    assert.equal(create?.args[1], session.caller.id);
  });

  it("only cancels a confirmed booking belonging to the session caller", async () => {
    const { executor, calls } = harness();
    await executor.execute("cancel_booking", { bookingId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f7" });
    assert.deepEqual(calls.find((call) => call.name === "findConfirmedBooking")?.args, [session.tenantId, session.caller.id, "018f5f86-9cf1-7f4d-81d2-6f11a3e841f7"]);
    assert.deepEqual(calls.find((call) => call.name === "cancelBooking")?.args, [session.tenantId, session.caller.id, "booking-1"]);
  });

  it("validates and saves durable memory with the current call as source", async () => {
    const { executor, calls } = harness();
    await executor.execute("save_memory", { kind: "preference", content: "Prefers morning appointments" });
    assert.deepEqual(calls.find((call) => call.name === "saveMemory")?.args, [session.tenantId, session.caller.id, session.callId, { kind: "preference", content: "Prefers morning appointments" }]);
    await assert.rejects(() => executor.execute("save_memory", { kind: "secret", content: "x" }));
  });

  it("loads caller context using tenant and caller IDs from the session", async () => {
    const { executor, calls } = harness();
    await executor.execute("get_caller_context", {});
    assert.deepEqual(calls.find((call) => call.name === "getCallerContext")?.args, [session.tenantId, session.caller.id]);
  });
});


import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolExecutor, type ToolExecutorDependencies } from "./tools.js";
import type { CallSession } from "./call-session.js";

const session: CallSession = {
  callId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f3",
  providerCallSid: "CA123",
  tenantId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f4",
  timezone: "Asia/Kolkata",
  caller: {
    id: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f5",
    phoneE164: "+919876543210",
    displayName: "Asha",
    country: "India",
    timezone: "Asia/Kolkata",
    profile: {},
    stage: "new"
  },
  intakeFields: [],
  agent: { agentMd: "# Clinic", voiceGreeting: "Hello", languageMode: "hinglish", languages: ["English", "Hindi"] },
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
  const staffMember = {
    id: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f8",
    name: "Gagandeep Singh",
    isRegisteredAgent: true,
    credentialLabel: "MARA registered"
  };
  const dependencies: ToolExecutorDependencies = {
    availability: {
      getSlots: async (...args: any[]) => {
        calls.push({ name: "getSlots", args });
        return [{
          startsAt: new Date("2027-01-07T03:30:00.000Z"),
          endsAt: new Date("2027-01-07T04:00:00.000Z")
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
      findStaff: async (...args: any[]) => { calls.push({ name: "findStaff", args }); return staffMember; },
      listStaff: async (...args: any[]) => { calls.push({ name: "listStaff", args }); return [staffMember]; },
      findStaffPhoneForTransfer: async (...args: any[]) => {
        calls.push({ name: "findStaffPhoneForTransfer", args });
        return { id: staffMember.id, name: staffMember.name, phoneE164: "+15558675309" };
      },
      updateCallerName: async (...args: any[]) => { calls.push({ name: "updateCallerName", args }); },
      updateCallerProfile: async (...args: any[]) => { calls.push({ name: "updateCallerProfile", args }); return { updated: ["name"], rejected: [], name: "Asha", profile: {} }; },
      createBooking: async (...args: any[]) => { calls.push({ name: "createBooking", args }); return { id: "booking-1" }; },
      findConfirmedBooking: async (...args: any[]) => { calls.push({ name: "findConfirmedBooking", args }); return { id: "booking-1", gcalEventId: "gcal-1" }; },
      cancelBooking: async (...args: any[]) => { calls.push({ name: "cancelBooking", args }); },
      saveMemory: async (...args: any[]) => { calls.push({ name: "saveMemory", args }); return { id: "memory-1" }; },
      getCallerContext: async (...args: any[]) => { calls.push({ name: "getCallerContext", args }); return { caller: session.caller, memories: [], upcomingBookings: [], intakeFields: [] }; }
    }
  };
  return { executor: new ToolExecutor(session, dependencies), calls, service, staffMember, dependencies };
}

describe("ToolExecutor", () => {
  it("resolves a service name and scopes availability to the session tenant", async () => {
    const { executor, calls, service } = harness();
    const result = await executor.execute("check_availability", {
      serviceName: "Consultation", date: "2027-01-07"
    });
    assert.deepEqual(result, { serviceId: service.id, staffId: null, callerTimezone: "Asia/Kolkata", slots: [{ startsAt: "2027-01-07T03:30:00.000Z", endsAt: "2027-01-07T04:00:00.000Z", callerLocalTime: "7 Jan 2027, 09:00", businessLocalTime: "7 Jan 2027, 09:00" }] });
    assert.deepEqual(calls.find((call) => call.name === "findService")?.args, [session.tenantId, { serviceName: "Consultation" }]);
    assert.deepEqual(calls.find((call) => call.name === "getSlots")?.args, [session.tenantId, service.id, "2027-01-07", undefined]);
  });

  it("resolves a named staff member and scopes availability to them", async () => {
    const { executor, calls, service, staffMember } = harness();
    const result = await executor.execute("check_availability", {
      serviceName: "Consultation", staffName: "Gagandeep", date: "2027-01-07"
    }) as { staffId: string };
    assert.equal(result.staffId, staffMember.id);
    assert.deepEqual(calls.find((call) => call.name === "findStaff")?.args, [session.tenantId, { staffName: "Gagandeep" }]);
    assert.deepEqual(calls.find((call) => call.name === "getSlots")?.args, [session.tenantId, service.id, "2027-01-07", staffMember.id]);
  });

  it("lists active staff for the tenant", async () => {
    const { executor, calls, staffMember } = harness();
    const result = await executor.execute("list_staff", {});
    assert.deepEqual(result, { staff: [staffMember] });
    assert.deepEqual(calls.find((call) => call.name === "listStaff")?.args, [session.tenantId]);
  });

  it("filters adjacent business dates into the caller's local date", async () => {
    const { dependencies, calls, service } = harness();
    const callerSession: CallSession = {
      ...session,
      timezone: "Australia/Melbourne",
      caller: { ...session.caller, timezone: "Asia/Kolkata" }
    };
    const executor = new ToolExecutor(callerSession, dependencies);
    const result = await executor.execute("check_availability", {
      serviceId: service.id,
      date: "2027-01-07"
    }) as { callerTimezone: string; slots: unknown[] };
    assert.equal(result.callerTimezone, "Asia/Kolkata");
    assert.equal(result.slots.length, 1);
    assert.equal(calls.filter((call) => call.name === "getSlots").length, 3);
  });

  it("creates a caller-scoped booking and matching calendar event", async () => {
    const { executor, calls, service } = harness();
    const result = await executor.execute("create_booking", {
      serviceId: service.id,
      startsAt: "2027-01-07T03:30:00.000Z",
      callerName: "Asha Patel"
    });
    assert.deepEqual(result, { bookingId: "booking-1", eventId: "gcal-1", calendarSynced: true, startsAt: "2027-01-07T03:30:00.000Z", endsAt: "2027-01-07T04:00:00.000Z", callerLocalTime: "7 Jan 2027, 09:00", businessLocalTime: "7 Jan 2027, 09:00", serviceName: "Consultation", staffId: null });
    const create = calls.find((call) => call.name === "createBooking");
    assert.equal(create?.args[0], session.tenantId);
    assert.equal(create?.args[1], session.caller.id);
    assert.equal((create?.args[2] as { staffId: string | null }).staffId, null);
  });

  it("assigns a booking to a specific requested staff member", async () => {
    const { executor, calls, service, staffMember } = harness();
    const result = await executor.execute("create_booking", {
      serviceId: service.id,
      staffId: staffMember.id,
      startsAt: "2027-01-07T03:30:00.000Z",
      callerName: "Asha Patel"
    }) as { staffId: string };
    assert.equal(result.staffId, staffMember.id);
    const create = calls.find((call) => call.name === "createBooking");
    assert.equal((create?.args[2] as { staffId: string | null }).staffId, staffMember.id);
    assert.deepEqual(calls.find((call) => call.name === "findStaff")?.args, [session.tenantId, { staffId: staffMember.id }]);
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

  it("updates the current caller profile through the tenant-scoped repository", async () => {
    const { executor, calls } = harness();
    await executor.execute("update_caller_profile", { fields: { name: "Sumant" } });
    assert.deepEqual(calls.find((call) => call.name === "updateCallerProfile")?.args, [
      session.tenantId,
      session.caller.id,
      { name: "Sumant" }
    ]);
  });

  it("loads caller context using tenant and caller IDs from the session", async () => {
    const { executor, calls } = harness();
    await executor.execute("get_caller_context", {});
    assert.deepEqual(calls.find((call) => call.name === "getCallerContext")?.args, [session.tenantId, session.caller.id]);
  });

  it("rejects unknown tools and missing services", async () => {
    const { executor, dependencies } = harness();
    await assert.rejects(() => executor.execute("unknown_tool", {}), /Unknown tool/);
    dependencies.repository.findService = async () => null;
    await assert.rejects(
      () => executor.execute("check_availability", {
        serviceName: "Missing", date: "2027-01-07"
      }),
      /Service not found/
    );
  });

  it("removes the Google event if booking persistence fails", async () => {
    const { executor, dependencies, calls, service } = harness();
    dependencies.repository.createBooking = async () => {
      throw new Error("database failed");
    };
    await assert.rejects(
      () => executor.execute("create_booking", {
        serviceId: service.id,
        startsAt: "2027-01-07T03:30:00.000Z"
      }),
      /database failed/
    );
    assert.deepEqual(
      calls.find((call) => call.name === "deleteEvent")?.args,
      [session.tenantId, "gcal-1"]
    );
  });});




import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolExecutor, type ToolExecutorDependencies } from "./tools.js";
import type { CallSession } from "./call-session.js";

/**
 * Business in Melbourne (AEDT, UTC+11 in October), open 9 AM to 5 PM. A caller in
 * India (UTC+5:30) sees that as 3:30 AM to 11:30 AM, so only 9:00 to 11:30 AM India
 * time (2:30 to 5:00 PM Melbourne) suits both sides.
 */
function makeSession(callerTimezone: string): CallSession {
  return {
    callId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f3",
    providerCallSid: "CA123",
    tenantId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f4",
    timezone: "Australia/Melbourne",
    caller: { id: "c1", phoneE164: "+919876543210", displayName: null, country: "India", timezone: callerTimezone, profile: {}, stage: "new" },
    intakeFields: [],
    agent: { agentMd: "# T", voiceGreeting: "Hello", languageMode: "english", languages: ["English"] },
    services: [],
    memories: [],
    history: { upcomingBookings: [], pendingCallbacks: [], lastCallAt: null },
    startedAt: "2026-10-01T04:00:00.000Z"
  };
}

/** Open slots for one business date: every 30 minutes from `fromHour` to `toHour` Melbourne time. */
function melbourneSlots(date: string, fromHour = 9, toHour = 17) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const slots: Array<{ startsAt: Date; endsAt: Date }> = [];
  for (let minutes = fromHour * 60; minutes < toHour * 60; minutes += 30) {
    const startsAt = new Date(Date.UTC(y, m - 1, d, 0, minutes - 11 * 60)); // AEDT = UTC+11
    slots.push({ startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000) });
  }
  return slots;
}

function executorFor(callerTimezone: string, hours: [number, number] = [9, 17]) {
  const service = { id: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f6", name: "Consultation", durationMinutes: 30, price: "110.00" };
  const dependencies = {
    availability: { getSlots: async (_t: string, _s: string, date: string) => melbourneSlots(date, hours[0], hours[1]) },
    calendar: {},
    repository: { findService: async () => service, findStaff: async () => null }
  } as unknown as ToolExecutorDependencies;
  return new ToolExecutor(makeSession(callerTimezone), dependencies);
}

type Slot = { callerLocalTime: string; businessLocalTime: string; startsAt: string };
type Result = { slots: Slot[]; onlyOutsideCallerHours?: boolean; earliestOutsideHours?: Slot[]; searchedDays?: number; noSlotsExplanation?: string };

describe("check_availability for a caller in another timezone", () => {
  it("never offers the 3:30 AM slot: only times inside the caller's 9 AM to 6 PM", async () => {
    const result = (await executorFor("Asia/Kolkata").execute("check_availability", { serviceName: "Consultation", date: "2026-10-05" })) as Result;
    assert.ok(result.slots.length >= 2, "there are daytime options");
    for (const slot of result.slots) {
      assert.doesNotMatch(slot.callerLocalTime, /\b(12|[1-8]):\d\d AM/, `no small-hours slot, got ${slot.callerLocalTime}`);
    }
    assert.match(result.slots[0]!.callerLocalTime, /9:00 AM/);
    assert.match(result.slots[0]!.businessLocalTime, /2:30 PM/, "9:00 AM India is 2:30 PM Melbourne");
  });

  it("returns a few well-spread options, not the whole day", async () => {
    const result = (await executorFor("Asia/Kolkata").execute("check_availability", { serviceName: "Consultation", date: "2026-10-05" })) as Result;
    assert.ok(result.slots.length <= 4);
    const starts = result.slots.map((s) => new Date(s.startsAt).getTime());
    for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i]! - starts[i - 1]! >= 60 * 60_000, "at least an hour apart");
  });

  it("searches several days for 'any date' and returns the best slots across them", async () => {
    const result = (await executorFor("Asia/Kolkata").execute("check_availability", { serviceName: "Consultation", date: "2026-10-05", days: 5 })) as Result;
    assert.equal(result.searchedDays, 5);
    assert.ok(result.slots.length >= 4 && result.slots.length <= 6);
    const days = new Set(result.slots.map((s) => s.callerLocalTime.slice(0, 6)));
    assert.ok(days.size >= 2, `spread over several days, got ${[...days].join(", ")}`);
    for (const slot of result.slots) assert.doesNotMatch(slot.callerLocalTime, /\b[1-8]:\d\d AM/);
  });

  it("says so when openings exist but only outside the caller's daytime", async () => {
    // Business only open 8 PM to 11 PM Melbourne = 2:30 to 5:30 PM... use 11 PM to 2 AM style hours: 5 AM to 8 AM Melbourne = 11:30 PM to 2:30 AM India.
    const result = (await executorFor("Asia/Kolkata", [5, 8]).execute("check_availability", { serviceName: "Consultation", date: "2026-10-05", days: 3 })) as Result;
    assert.equal(result.slots.length, 0);
    assert.equal(result.onlyOutsideCallerHours, true);
    assert.ok((result.earliestOutsideHours?.length ?? 0) >= 1);
  });

  it("does not filter hours for a caller in the business's own timezone", async () => {
    const result = (await executorFor("Australia/Melbourne").execute("check_availability", { serviceName: "Consultation", date: "2026-10-05" })) as Result;
    assert.match(result.slots[0]!.callerLocalTime, /9:00 AM/);
    assert.equal(result.onlyOutsideCallerHours, undefined);
  });
});

describe("check_availability: 'after' and office hours in caller time", () => {
  it("only returns slots at or after the caller's requested time", async () => {
    const result = (await executorFor("Asia/Kolkata").execute("check_availability", { serviceName: "Consultation", date: "2026-10-05", after: "10:00" })) as Result;
    assert.ok(result.slots.length > 0);
    for (const slot of result.slots) assert.doesNotMatch(slot.callerLocalTime, / 9:\d\d AM/);
  });

  it("explains why nothing is free after the office has closed for the caller", async () => {
    const executor = executorFor("Asia/Kolkata");
    (executor as unknown as { session: CallSession }).session.businessHours =
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00:00", closes: "17:00:00", closed: weekday === 0 || weekday === 6 }));
    const result = (await executor.execute("check_availability", { serviceName: "Consultation", date: "2026-10-05", after: "13:00" })) as Result & { officeHoursCallerTime?: string };
    assert.equal(result.slots.length, 0);
    assert.match(result.officeHoursCallerTime ?? "", /to 11:30 AM caller's time/);
    assert.match(result.noSlotsExplanation ?? "", /Nothing is free after the requested time/);
    const earlier = (result as unknown as { latestEarlierSlots: Slot[] }).latestEarlierSlots;
    assert.equal(earlier.length, 2, "real earlier slots are offered instead of invented ones");
    assert.match(earlier[1]!.callerLocalTime, /11:00 AM/);
  });
});

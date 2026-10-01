import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isWithinCallerDay, localHour, pickAcrossDays, spreadPick, type SlotLike } from "./slot-selection.js";

const slot = (iso: string, minutes = 30): SlotLike => {
  const startsAt = new Date(iso);
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) };
};

describe("localHour", () => {
  it("reads the local clock in a timezone, including half-hour zones", () => {
    assert.equal(localHour(new Date("2026-10-05T00:00:00Z"), "Asia/Kolkata"), 5.5);
    assert.equal(localHour(new Date("2026-10-05T00:00:00Z"), "Australia/Melbourne"), 11);
    assert.equal(localHour(new Date("2026-10-05T03:30:00Z"), "Asia/Kolkata"), 9);
  });
});

describe("isWithinCallerDay", () => {
  it("rejects the small-hours slots an Indian caller was being offered", () => {
    // 9:00 AM Melbourne (AEDT) = 3:30 AM India.
    assert.equal(isWithinCallerDay(slot("2026-10-04T22:00:00Z"), "Asia/Kolkata"), false);
    assert.equal(isWithinCallerDay(slot("2026-10-05T02:00:00Z"), "Asia/Kolkata"), false); // 7:30 AM India
  });

  it("accepts slots inside 9 AM to 6 PM for the caller, and rejects ones that run past it", () => {
    assert.equal(isWithinCallerDay(slot("2026-10-05T03:30:00Z"), "Asia/Kolkata"), true); // 9:00 AM India = 2:30 PM Melbourne
    assert.equal(isWithinCallerDay(slot("2026-10-05T05:30:00Z"), "Asia/Kolkata"), true); // 11:00 AM India
    assert.equal(isWithinCallerDay(slot("2026-10-05T12:00:00Z", 60), "Asia/Kolkata"), false); // 5:30 PM start, ends 6:30 PM
  });
});

describe("spreadPick", () => {
  it("returns genuinely different options at least an hour apart", () => {
    const slots = ["03:30", "04:00", "04:30", "05:00", "05:30", "06:30"].map((t) => slot(`2026-10-05T${t}:00Z`));
    const picked = spreadPick(slots, 4);
    assert.deepEqual(picked.map((s) => s.startsAt.toISOString().slice(11, 16)), ["03:30", "04:30", "05:30", "06:30"]);
  });
});

describe("pickAcrossDays", () => {
  it("offers the earliest slots per day, earliest day first, capped overall", () => {
    const day = (date: string, times: string[]) => ({ date, slots: times.map((t) => slot(`${date}T${t}:00Z`)) });
    const picked = pickAcrossDays(
      [day("2026-10-07", ["04:00", "05:30"]), day("2026-10-05", ["03:30", "04:30", "06:00"]), day("2026-10-06", ["04:00"])],
      2,
      4
    );
    assert.deepEqual(
      picked.map((s) => s.startsAt.toISOString().slice(0, 16)),
      ["2026-10-05T03:30", "2026-10-05T04:30", "2026-10-06T04:00", "2026-10-07T04:00"]
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBusinessWindow, computeAvailableSlots } from "./availability.js";

const at = (hour: number, minute = 0) => new Date(Date.UTC(2030, 0, 7, hour, minute));

describe("computeAvailableSlots", () => {
  it("returns no slots on a closed day", () => {
    assert.deepEqual(computeAvailableSlots({
      closed: true,
      opensAt: at(9),
      closesAt: at(17),
      durationMinutes: 30,
      busy: []
    }), []);
  });

  it("removes every slot touched by a partial busy overlap", () => {
    const slots = computeAvailableSlots({
      closed: false,
      opensAt: at(9),
      closesAt: at(12),
      durationMinutes: 30,
      busy: [{ startsAt: at(9, 15), endsAt: at(10, 15) }]
    });

    assert.deepEqual(slots.map((slot) => slot.startsAt.toISOString()), [
      at(10, 30).toISOString(),
      at(11).toISOString(),
      at(11, 30).toISOString()
    ]);
  });

  it("allows slots immediately before and after back-to-back bookings", () => {
    const slots = computeAvailableSlots({
      closed: false,
      opensAt: at(9),
      closesAt: at(12),
      durationMinutes: 30,
      busy: [
        { startsAt: at(10), endsAt: at(10, 30) },
        { startsAt: at(10, 30), endsAt: at(11) }
      ]
    });

    assert.deepEqual(slots.map((slot) => slot.startsAt.toISOString()), [
      at(9).toISOString(),
      at(9, 30).toISOString(),
      at(11).toISOString(),
      at(11, 30).toISOString()
    ]);
  });

  it("converts Asia/Kolkata business hours across the UTC date boundary", () => {
    const window = buildBusinessWindow(
      "2030-01-07",
      "09:00:00",
      "10:00:00",
      "Asia/Kolkata"
    );

    assert.equal(window.opensAt.toISOString(), "2030-01-07T03:30:00.000Z");
    assert.equal(window.closesAt.toISOString(), "2030-01-07T04:30:00.000Z");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { explainNoSlots, officeStatusNow, spokenTime, weeklyHoursLines } from "./office-hours.js";
import type { BusinessHour } from "./call-session.js";

const TZ = "Australia/Melbourne";
const weekdays = (opens: string, closes: string): BusinessHour[] => [
  { weekday: 0, opens: "00:00:00", closes: "00:00:00", closed: true },
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens, closes, closed: false })),
  { weekday: 6, opens: "00:00:00", closes: "00:00:00", closed: true }
];
const hours = weekdays("09:00:00", "17:00:00");

// Tuesday 2026-09-29 in Melbourne is UTC+10.
const tuesday10am = new Date("2026-09-29T00:00:00.000Z");
const tuesday6pm = new Date("2026-09-29T08:00:00.000Z");
const friday6pm = new Date("2026-10-02T08:00:00.000Z");

describe("office hours", () => {
  it("speaks times naturally", () => {
    assert.equal(spokenTime("09:00:00"), "9 AM");
    assert.equal(spokenTime("17:30:00"), "5:30 PM");
    assert.equal(spokenTime("12:00:00"), "12 PM");
  });

  it("lists the weekly schedule with closed days", () => {
    const lines = weeklyHoursLines(hours);
    assert.match(lines, /Monday: 9 AM to 5 PM/);
    assert.match(lines, /Sunday: closed/);
  });

  it("reports open during hours", () => {
    assert.match(officeStatusNow(hours, TZ, tuesday10am), /OPEN right now, until 5 PM/);
  });

  it("reports closed for today after hours with the next opening", () => {
    const status = officeStatusNow(hours, TZ, tuesday6pm);
    assert.match(status, /CLOSED for today/);
    assert.match(status, /tomorrow at 9 AM/);
  });

  it("skips the weekend when saying when the office next opens", () => {
    assert.match(officeStatusNow(hours, TZ, friday6pm), /next opens Monday at 9 AM/);
  });

  it("explains an empty today as closed for the day once hours are over", () => {
    const result = explainNoSlots(hours, TZ, "2026-09-29", 45, tuesday6pm);
    assert.equal(result.reason, "office_closed_for_today");
    assert.match(result.explanation, /9 AM to 5 PM/);
  });

  it("explains an empty weekend day as closed that weekday", () => {
    const result = explainNoSlots(hours, TZ, "2026-10-03", 45, tuesday10am);
    assert.equal(result.reason, "office_closed_that_day");
    assert.match(result.explanation, /Saturdays/);
  });

  it("treats an empty open day with time left as fully booked", () => {
    const result = explainNoSlots(hours, TZ, "2026-09-30", 45, tuesday10am);
    assert.equal(result.reason, "fully_booked");
  });
});

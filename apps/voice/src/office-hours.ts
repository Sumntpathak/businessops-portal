import type { BusinessHour } from "./call-session.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type NoSlotsReason =
  | "office_closed_for_today"
  | "office_closed_that_day"
  | "fully_booked";

function toMinutes(time: string): number {
  const [hours = "0", minutes = "0"] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function spokenTime(time: string): string {
  const total = toMinutes(time);
  const hours24 = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return minutes === 0 ? `${hours12} ${suffix}` : `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function localNow(timezone: string, at: Date): { date: string; weekday: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value])
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function hoursFor(hours: BusinessHour[], weekday: number): BusinessHour | undefined {
  return hours.find((row) => row.weekday === weekday);
}

function isOpenDay(row: BusinessHour | undefined): row is BusinessHour {
  return Boolean(row && !row.closed);
}

function nextOpening(hours: BusinessHour[], fromWeekday: number): string | null {
  for (let offset = 1; offset <= 7; offset += 1) {
    const weekday = (fromWeekday + offset) % 7;
    const row = hoursFor(hours, weekday);
    if (isOpenDay(row)) {
      const day = offset === 1 ? "tomorrow" : WEEKDAYS[weekday];
      return `${day} at ${spokenTime(row.opens)}`;
    }
  }
  return null;
}

export function weeklyHoursLines(hours: BusinessHour[]): string {
  if (hours.length === 0) return "- Office hours are not configured.";
  return [...hours]
    .sort((a, b) => a.weekday - b.weekday)
    .map((row) =>
      row.closed
        ? `- ${WEEKDAYS[row.weekday]}: closed`
        : `- ${WEEKDAYS[row.weekday]}: ${spokenTime(row.opens)} to ${spokenTime(row.closes)}`
    )
    .join("\n");
}

export function officeStatusNow(hours: BusinessHour[], timezone: string, at = new Date()): string {
  if (hours.length === 0) return "Office hours are not configured — do not guess whether the office is open.";
  const now = localNow(timezone, at);
  const today = hoursFor(hours, now.weekday);
  const next = nextOpening(hours, now.weekday);
  const reopen = next ? ` It next opens ${next}.` : "";

  if (!isOpenDay(today)) return `The office is CLOSED today (${WEEKDAYS[now.weekday]}).${reopen}`;
  if (now.minutes < toMinutes(today.opens)) {
    return `The office has not opened yet today — it opens at ${spokenTime(today.opens)} and closes at ${spokenTime(today.closes)}.`;
  }
  if (now.minutes >= toMinutes(today.closes)) {
    return `The office has CLOSED for today (it closed at ${spokenTime(today.closes)}).${reopen}`;
  }
  return `The office is OPEN right now, until ${spokenTime(today.closes)} today.`;
}

export function explainNoSlots(
  hours: BusinessHour[],
  timezone: string,
  date: string,
  durationMinutes: number,
  at = new Date()
): { reason: NoSlotsReason; explanation: string } {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const row = hoursFor(hours, weekday);
  const next = nextOpening(hours, weekday);
  const reopen = next ? ` Next opening: ${next}.` : "";

  if (hours.length > 0 && !isOpenDay(row)) {
    return {
      reason: "office_closed_that_day",
      explanation: `The office is closed on ${WEEKDAYS[weekday]}s.${reopen}`
    };
  }

  const now = localNow(timezone, at);
  if (row && date === now.date && now.minutes + durationMinutes > toMinutes(row.closes)) {
    return {
      reason: "office_closed_for_today",
      explanation: `Office hours today were ${spokenTime(row.opens)} to ${spokenTime(row.closes)}, so there is no time left to book today.${reopen}`
    };
  }

  return {
    reason: "fully_booked",
    explanation: "The office is open that day but every consultation slot is already taken."
  };
}

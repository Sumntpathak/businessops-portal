/**
 * Chooses which open slots the agent should be shown.
 *
 * check_availability used to return every open business slot in order, so for a
 * caller in India the first offer was the business's 9 AM Melbourne start, which is
 * 3:30 AM in India. The tool now only offers times that suit the caller, searches
 * several days when the caller has no preferred date, and returns a handful of
 * spread-out slots instead of the whole day.
 */

/** A caller in a different timezone is only offered slots inside this window of their local day. */
export const CALLER_DAY_START_HOUR = 9;
export const CALLER_DAY_END_HOUR = 18;

/** Most slots handed to the model in one tool result. */
export const MAX_SLOTS_OFFERED = 6;

/** Least gap between two slots in the same list, so the options are genuinely different. */
const MIN_GAP_MS = 60 * 60 * 1000;

export interface SlotLike {
  startsAt: Date;
  endsAt: Date;
}

/** `date` (YYYY-MM-DD) plus `days` calendar days, as YYYY-MM-DD. */
export function addDaysIso(date: string, days: number): string {
  const base = new Date(date + "T12:00:00.000Z");
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Local clock time in `timeZone` as fractional hours, e.g. 3:30 PM -> 15.5. */
export function localHour(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour + minute / 60;
}

/** True when the whole slot falls inside the caller's sensible day (9 AM to 6 PM their time). */
export function isWithinCallerDay(slot: SlotLike, callerTimezone: string): boolean {
  const start = localHour(slot.startsAt, callerTimezone);
  const end = localHour(slot.endsAt, callerTimezone);
  return start >= CALLER_DAY_START_HOUR && end <= CALLER_DAY_END_HOUR && end > start;
}

/** Offset of `timeZone` from UTC at `at`, in ms (e.g. +10:00 -> 36_000_000). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23"
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` reads `date` (YYYY-MM-DD) `time` (HH:MM[:SS]). */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset even when the guess lands across a DST change.
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

interface OpenHours { weekday: number; opens: string; closes: string; closed: boolean }

function clockLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

/**
 * For a caller in another timezone: when the office is open on `date`, said in the
 * caller's own time, plus the latest start for a `durationMinutes` appointment. The
 * model used to convert times itself and got them wrong, and kept re-offering the same
 * slot to a caller asking for "after 1 PM" without saying the office was closed by then.
 */
export function officeHoursForCaller(
  hours: OpenHours[],
  businessTimezone: string,
  callerTimezone: string,
  date: string,
  durationMinutes: number
): string | undefined {
  if (hours.length === 0) return undefined; // hours not set up: say nothing rather than "closed"
  const weekday = new Date(date + "T12:00:00.000Z").getUTCDay();
  const row = hours.find((entry) => entry.weekday === weekday);
  if (!row || row.closed) return `The office is closed on ${date} (business calendar).`;
  const opens = zonedTimeToUtc(date, row.opens, businessTimezone);
  const closes = zonedTimeToUtc(date, row.closes, businessTimezone);
  const lastStart = new Date(closes.getTime() - durationMinutes * 60_000);
  return (
    `On ${date} the office is open ${clockLabel(opens, callerTimezone)} to ${clockLabel(closes, callerTimezone)} caller's time ` +
    `(${clockLabel(opens, businessTimezone)} to ${clockLabel(closes, businessTimezone)} business time). ` +
    `The latest appointment start is ${clockLabel(lastStart, callerTimezone)} caller's time. Nothing later is possible that day.`
  );
}

/** First slot, then each next slot at least an hour later, up to `max` (slots must be sorted). */
export function spreadPick<T extends SlotLike>(slots: T[], max: number): T[] {
  const picked: T[] = [];
  for (const slot of slots) {
    const last = picked.at(-1);
    if (!last || slot.startsAt.getTime() - last.startsAt.getTime() >= MIN_GAP_MS) picked.push(slot);
    if (picked.length >= max) break;
  }
  return picked;
}

export interface DaySlots<T extends SlotLike> {
  /** Caller-local calendar date, YYYY-MM-DD. */
  date: string;
  slots: T[];
}

/**
 * Picks the best slots across days: the earliest one or two per day, earliest day
 * first, so "any day this week" returns a short list spread over the week.
 */
export function pickAcrossDays<T extends SlotLike>(days: DaySlots<T>[], perDay: number, max = MAX_SLOTS_OFFERED): T[] {
  const picked: T[] = [];
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const slot of spreadPick(day.slots, perDay)) {
      picked.push(slot);
      if (picked.length >= max) return picked;
    }
  }
  return picked;
}

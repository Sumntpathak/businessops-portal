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

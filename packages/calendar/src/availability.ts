import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface AvailabilitySlot {
  startsAt: Date;
  endsAt: Date;
}

export interface SlotComputation {
  closed: boolean;
  opensAt: Date;
  closesAt: Date;
  durationMinutes: number;
  busy: readonly BusyInterval[];
  minStartsAt?: Date;
  /**
   * Admin-added windows (availability_overrides kind "add") that open up slots
   * outside the normal opens/closesAt range for this date — e.g. a Saturday
   * special-hours window. Sliced the same way as the main window and still
   * checked against `busy`.
   */
  extraWindows?: readonly { startsAt: Date; endsAt: Date }[];
}

function sliceWindow(
  opensAt: Date,
  closesAt: Date,
  durationMinutes: number,
  busy: readonly BusyInterval[],
  minStartsAt: Date | undefined
): AvailabilitySlot[] {
  if (closesAt <= opensAt || (minStartsAt && closesAt <= minStartsAt)) return [];

  const slots: AvailabilitySlot[] = [];
  for (
    let startsAt = opensAt;
    addMinutes(startsAt, durationMinutes) <= closesAt;
    startsAt = addMinutes(startsAt, durationMinutes)
  ) {
    if (minStartsAt && startsAt <= minStartsAt) continue;

    const slot = { startsAt, endsAt: addMinutes(startsAt, durationMinutes) };
    if (!busy.some((interval) => overlaps(slot, interval))) {
      slots.push(slot);
    }
  }
  return slots;
}

export function buildBusinessWindow(
  date: string,
  opens: string,
  closes: string,
  timezone: string
): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: fromZonedTime(date + "T" + opens, timezone),
    closesAt: fromZonedTime(date + "T" + closes, timezone)
  };
}

function overlaps(slot: AvailabilitySlot, busy: BusyInterval): boolean {
  return slot.startsAt < busy.endsAt && slot.endsAt > busy.startsAt;
}

export function computeAvailableSlots(input: SlotComputation): AvailabilitySlot[] {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    return [];
  }

  const mainWindowSlots = input.closed
    ? []
    : sliceWindow(input.opensAt, input.closesAt, input.durationMinutes, input.busy, input.minStartsAt);

  const extraSlots = (input.extraWindows ?? []).flatMap((window) =>
    sliceWindow(window.startsAt, window.endsAt, input.durationMinutes, input.busy, input.minStartsAt)
  );

  return [...mainWindowSlots, ...extraSlots].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );
}

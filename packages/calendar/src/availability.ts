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
  if (
    input.closed ||
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes <= 0 ||
    input.closesAt <= input.opensAt
  ) {
    return [];
  }

  const slots: AvailabilitySlot[] = [];

  for (
    let startsAt = input.opensAt;
    addMinutes(startsAt, input.durationMinutes) <= input.closesAt;
    startsAt = addMinutes(startsAt, input.durationMinutes)
  ) {
    const slot = {
      startsAt,
      endsAt: addMinutes(startsAt, input.durationMinutes)
    };

    if (!input.busy.some((interval) => overlaps(slot, interval))) {
      slots.push(slot);
    }
  }

  return slots;
}

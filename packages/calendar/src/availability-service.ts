import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { schema, withTenant, type createDatabase } from "@recepto/db";
import {
  buildBusinessWindow,
  computeAvailableSlots,
  type AvailabilitySlot,
  type BusyInterval
} from "./availability.js";
import {
  CalendarConnectionRevokedError,
  type CalendarService
} from "./calendar-service.js";

type Database = ReturnType<typeof createDatabase>;

export class AvailabilityService {
  constructor(
    private readonly db: Database,
    private readonly calendar: CalendarService
  ) {}

  async getSlots(
    tenantId: string,
    serviceId: string,
    date: string,
    staffId?: string
  ): Promise<AvailabilitySlot[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Availability date must use YYYY-MM-DD");
    }

    const scoped = withTenant(this.db, tenantId);
    const [tenant, service] = await Promise.all([
      this.db
        .select({ timezone: schema.tenants.timezone })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1)
        .then((rows) => rows[0]),
      this.db
        .select({ durationMinutes: schema.services.durationMinutes })
        .from(schema.services)
        .where(
          scoped.where(
            schema.services,
            and(
              eq(schema.services.id, serviceId),
              eq(schema.services.active, true)
            )
          )
        )
        .limit(1)
        .then((rows) => rows[0])
    ]);

    if (!tenant || !service) return [];

    const weekday = new Date(date + "T00:00:00.000Z").getUTCDay();
    const [[hours], overrides] = await Promise.all([
      this.db
        .select({
          opens: schema.businessHours.opens,
          closes: schema.businessHours.closes,
          closed: schema.businessHours.closed
        })
        .from(schema.businessHours)
        .where(
          scoped.where(
            schema.businessHours,
            eq(schema.businessHours.weekday, weekday)
          )
        )
        .limit(1),
      this.db
        .select({
          kind: schema.availabilityOverrides.kind,
          opens: schema.availabilityOverrides.opens,
          closes: schema.availabilityOverrides.closes,
          closed: schema.availabilityOverrides.closed,
          startsAt: schema.availabilityOverrides.startsAt,
          endsAt: schema.availabilityOverrides.endsAt
        })
        .from(schema.availabilityOverrides)
        .where(
          scoped.where(
            schema.availabilityOverrides,
            eq(schema.availabilityOverrides.date, date)
          )
        )
    ]);

    if (!hours) return [];

    // day_hours override replaces the weekly template for this one date —
    // it is the source of truth the admin set by hand, so it always wins.
    const dayHoursOverride = overrides.find((row) => row.kind === "day_hours");
    const effectiveHours = dayHoursOverride
      ? {
          opens: dayHoursOverride.opens ?? hours.opens,
          closes: dayHoursOverride.closes ?? hours.closes,
          closed: dayHoursOverride.closed ?? hours.closed
        }
      : hours;

    const window = effectiveHours.closed
      ? null
      : buildBusinessWindow(date, effectiveHours.opens, effectiveHours.closes, tenant.timezone);

    const extraWindows = overrides
      .filter(
        (row): row is typeof row & { startsAt: Date; endsAt: Date } =>
          row.kind === "add" && row.startsAt !== null && row.endsAt !== null
      )
      .map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt }));

    const blocks: BusyInterval[] = overrides
      .filter(
        (row): row is typeof row & { startsAt: Date; endsAt: Date } =>
          row.kind === "block" && row.startsAt !== null && row.endsAt !== null
      )
      .map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt }));

    const bounds = [
      ...(window ? [window.opensAt, window.closesAt] : []),
      ...extraWindows.flatMap((w) => [w.startsAt, w.endsAt])
    ];
    if (bounds.length === 0) return [];

    const now = new Date();
    const queryStart = new Date(Math.min(...bounds.map((d) => d.getTime())));
    const queryEnd = new Date(Math.max(...bounds.map((d) => d.getTime())));

    if (queryEnd <= now) return [];

    const [calendarBusy, bookings] = await Promise.all([
      // No connected Google Calendar is a supported mode: availability then
      // relies on business hours + internal bookings only.
      this.calendar
        .getFreeBusy(tenantId, { startsAt: queryStart, endsAt: queryEnd })
        .catch((error: unknown): BusyInterval[] => {
          if (error instanceof CalendarConnectionRevokedError) return [];
          throw error;
        }),
      this.db
        .select({
          startsAt: schema.bookings.startsAt,
          endsAt: schema.bookings.endsAt
        })
        .from(schema.bookings)
        .where(
          scoped.where(
            schema.bookings,
            and(
              eq(schema.bookings.status, "confirmed"),
              isNull(schema.bookings.deletedAt),
              lt(schema.bookings.startsAt, queryEnd),
              gt(schema.bookings.endsAt, queryStart),
              // Staff share one tenant calendar, so busy time must be scoped
              // to the requested staff member's own bookings — otherwise one
              // staff member's booking would incorrectly block a different
              // staff member's identical slot. Unassigned bookings don't
              // block a specific staff member either way. When no staffId is
              // given (auto-assign mode), every confirmed booking counts.
              staffId ? eq(schema.bookings.staffId, staffId) : undefined
            )
          )
        )
    ]);

    return computeAvailableSlots({
      closed: !window,
      opensAt: window?.opensAt ?? now,
      closesAt: window?.closesAt ?? now,
      durationMinutes: service.durationMinutes,
      busy: [...calendarBusy, ...bookings, ...blocks],
      minStartsAt: now,
      extraWindows
    });
  }
}

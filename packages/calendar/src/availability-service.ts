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
    date: string
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
    const [hours] = await this.db
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
      .limit(1);

    if (!hours || hours.closed) return [];

    const window = buildBusinessWindow(
      date,
      hours.opens,
      hours.closes,
      tenant.timezone
    );
    const [calendarBusy, bookings] = await Promise.all([
      // No connected Google Calendar is a supported mode: availability then
      // relies on business hours + internal bookings only.
      this.calendar
        .getFreeBusy(tenantId, {
          startsAt: window.opensAt,
          endsAt: window.closesAt
        })
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
              lt(schema.bookings.startsAt, window.closesAt),
              gt(schema.bookings.endsAt, window.opensAt)
            )
          )
        )
    ]);

    return computeAvailableSlots({
      closed: false,
      ...window,
      durationMinutes: service.durationMinutes,
      busy: [...calendarBusy, ...bookings]
    });
  }
}

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  sql
} from "drizzle-orm";
import { z } from "zod";
import {
  CalendarConnectionRevokedError,
  type AvailabilityService,
  type CalendarService
} from "@recepto/calendar";
import {
  schema,
  withTenant,
  type createDatabase
} from "@recepto/db";
import type { CallSession } from "./call-session.js";
import {
  adjacentIsoDates,
  formatCallerLocalTime,
  localDateInTimezone,
  validateProfileFields,
  type ProfileValue,
  type RejectedProfileField
} from "./caller-profile.js";

type Database = ReturnType<typeof createDatabase>;

export interface ToolService {
  id: string;
  name: string;
  durationMinutes: number;
}

export interface ToolRepository {
  findService(
    tenantId: string,
    selector: { serviceId?: string; serviceName?: string }
  ): Promise<ToolService | null>;
  updateCallerName(
    tenantId: string,
    callerId: string,
    displayName: string
  ): Promise<void>;
  updateCallerProfile(
    tenantId: string,
    callerId: string,
    fields: Record<string, unknown>
  ): Promise<{
    updated: string[];
    rejected: RejectedProfileField[];
    name: string | null;
    profile: Record<string, ProfileValue>;
  }>;
  createBooking(
    tenantId: string,
    callerId: string,
    values: {
      serviceId: string;
      startsAt: Date;
      endsAt: Date;
      gcalEventId: string | null;
    }
  ): Promise<{ id: string }>;
  findConfirmedBooking(
    tenantId: string,
    callerId: string,
    bookingId: string
  ): Promise<{ id: string; gcalEventId: string | null } | null>;
  cancelBooking(
    tenantId: string,
    callerId: string,
    bookingId: string
  ): Promise<void>;
  saveMemory(
    tenantId: string,
    callerId: string,
    sourceCallId: string,
    memory: { kind: "fact" | "preference" | "summary"; content: string }
  ): Promise<{ id: string }>;
  getCallerContext(
    tenantId: string,
    callerId: string
  ): Promise<{
    caller: CallSession["caller"];
    memories: Array<{ id: string; kind: "fact" | "preference" | "summary"; content: string }>;
    upcomingBookings: Array<{
      id: string;
      serviceName: string;
      startsAt: Date;
      endsAt: Date;
    }>;
    intakeFields: CallSession["intakeFields"];
  }>;
}

export interface ToolExecutorDependencies {
  availability: Pick<AvailabilityService, "getSlots">;
  calendar: Pick<CalendarService, "createEvent" | "deleteEvent">;
  repository: ToolRepository;
}

const availabilityInput = z
  .object({
    serviceId: z.string().uuid().optional(),
    serviceName: z.string().trim().min(1).max(160).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  })
  .refine((value) => Boolean(value.serviceId || value.serviceName), {
    message: "serviceId or serviceName is required"
  });

const createBookingInput = z.object({
  serviceId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  callerName: z.string().trim().min(1).max(120).optional()
});

const cancelBookingInput = z.object({ bookingId: z.string().uuid() });
const saveMemoryInput = z.object({
  kind: z.enum(["fact", "preference", "summary"]),
  content: z.string().trim().min(1).max(2_000)
});
const updateCallerProfileInput = z.object({
  fields: z.record(z.union([z.string(), z.number().finite(), z.boolean()]))
});
const emptyInput = z.object({}).strict();

export class ToolExecutor {
  constructor(
    private readonly session: CallSession,
    private readonly dependencies: ToolExecutorDependencies
  ) {}

  async execute(name: string, rawInput: unknown): Promise<unknown> {
    switch (name) {
      case "check_availability":
        return this.checkAvailability(availabilityInput.parse(rawInput));
      case "create_booking":
        return this.createBooking(createBookingInput.parse(rawInput));
      case "cancel_booking":
        return this.cancelBooking(cancelBookingInput.parse(rawInput));
      case "save_memory":
        return this.saveMemory(saveMemoryInput.parse(rawInput));
      case "update_caller_profile":
        return this.updateCallerProfile(updateCallerProfileInput.parse(rawInput));
      case "get_caller_context":
        emptyInput.parse(rawInput);
        return this.getCallerContext();
      default:
        throw new Error("Unknown tool: " + name);
    }
  }

  private async checkAvailability(input: z.infer<typeof availabilityInput>) {
    const selector = input.serviceId
      ? { serviceId: input.serviceId }
      : { serviceName: input.serviceName };
    const service = await this.dependencies.repository.findService(
      this.session.tenantId,
      selector
    );
    if (!service) throw new Error("Service not found");

    const callerTimezone = this.session.caller.timezone ?? this.session.timezone;
    const businessDates = callerTimezone === this.session.timezone
      ? [input.date]
      : adjacentIsoDates(input.date);
    const candidateGroups = await Promise.all(
      businessDates.map((date) =>
        this.dependencies.availability.getSlots(this.session.tenantId, service.id, date)
      )
    );
    const slots = candidateGroups
      .flat()
      .filter((slot, index, all) =>
        all.findIndex((other) => other.startsAt.getTime() === slot.startsAt.getTime()) === index
      )
      .filter((slot) => localDateInTimezone(slot.startsAt, callerTimezone) === input.date);
    return {
      serviceId: service.id,
      callerTimezone,
      slots: slots.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        callerLocalTime: formatCallerLocalTime(slot.startsAt, callerTimezone)
      }))
    };
  }

  private async createBooking(input: z.infer<typeof createBookingInput>) {
    const service = await this.dependencies.repository.findService(
      this.session.tenantId,
      { serviceId: input.serviceId }
    );
    if (!service) throw new Error("Service not found");

    const startsAt = new Date(input.startsAt);
    if (startsAt <= new Date()) throw new Error("Booking must be in the future");
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: this.session.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(startsAt);
    const value = (type: "year" | "month" | "day") =>
      parts.find((part) => part.type === type)?.value ?? "";
    const localDate = value("year") + "-" + value("month") + "-" + value("day");
    const slots = await this.dependencies.availability.getSlots(
      this.session.tenantId,
      service.id,
      localDate
    );
    const selected = slots.find(
      (slot) => slot.startsAt.getTime() === startsAt.getTime()
    );
    if (!selected) throw new Error("Requested booking slot is unavailable");
    const endsAt = selected.endsAt;

    if (input.callerName) {
      await this.dependencies.repository.updateCallerName(
        this.session.tenantId,
        this.session.caller.id,
        input.callerName
      );
    }

    // A tenant without a connected Google Calendar still gets local bookings;
    // the dashboard remains the source of truth until OAuth is completed.
    let eventId: string | null;
    try {
      eventId = await this.dependencies.calendar.createEvent(
        this.session.tenantId,
        {
          title: service.name + " — " + (input.callerName ?? this.session.caller.displayName ?? this.session.caller.phoneE164),
          startsAt,
          endsAt,
          description: "Booked by the Recepto voice receptionist."
        }
      );
    } catch (error) {
      if (!(error instanceof CalendarConnectionRevokedError)) throw error;
      eventId = null;
    }

    try {
      const booking = await this.dependencies.repository.createBooking(
        this.session.tenantId,
        this.session.caller.id,
        {
          serviceId: service.id,
          startsAt,
          endsAt,
          gcalEventId: eventId
        }
      );
      return {
        bookingId: booking.id,
        eventId,
        calendarSynced: eventId !== null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        serviceName: service.name
      };
    } catch (error) {
      if (eventId) {
        await this.dependencies.calendar
          .deleteEvent(this.session.tenantId, eventId)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  private async cancelBooking(input: z.infer<typeof cancelBookingInput>) {
    const booking = await this.dependencies.repository.findConfirmedBooking(
      this.session.tenantId,
      this.session.caller.id,
      input.bookingId
    );
    if (!booking) throw new Error("Confirmed booking not found");

    if (booking.gcalEventId) {
      try {
        await this.dependencies.calendar.deleteEvent(
          this.session.tenantId,
          booking.gcalEventId
        );
      } catch (error) {
        // A calendar disconnected after the booking was made must not block
        // the local cancellation.
        if (!(error instanceof CalendarConnectionRevokedError)) throw error;
      }
    }
    await this.dependencies.repository.cancelBooking(
      this.session.tenantId,
      this.session.caller.id,
      booking.id
    );
    return { bookingId: booking.id, cancelled: true };
  }

  private async updateCallerProfile(input: z.infer<typeof updateCallerProfileInput>) {
    return this.dependencies.repository.updateCallerProfile(
      this.session.tenantId,
      this.session.caller.id,
      input.fields
    );
  }

  private async saveMemory(input: z.infer<typeof saveMemoryInput>) {
    const memory = await this.dependencies.repository.saveMemory(
      this.session.tenantId,
      this.session.caller.id,
      this.session.callId,
      input
    );
    return { memoryId: memory.id, saved: true };
  }

  private async getCallerContext() {
    const context = await this.dependencies.repository.getCallerContext(
      this.session.tenantId,
      this.session.caller.id
    );
    const callerTimezone = context.caller.timezone ?? this.session.timezone;
    return {
      ...context,
      callerTimezone,
      upcomingBookings: context.upcomingBookings.map((booking) => ({
        ...booking,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
        callerLocalTime: formatCallerLocalTime(booking.startsAt, callerTimezone)
      }))
    };
  }
}

export class DrizzleToolRepository implements ToolRepository {
  constructor(private readonly db: Database) {}

  async findService(
    tenantId: string,
    selector: { serviceId?: string; serviceName?: string }
  ): Promise<ToolService | null> {
    const scoped = withTenant(this.db, tenantId);

    if (selector.serviceId) {
      const [service] = await this.db
        .select({
          id: schema.services.id,
          name: schema.services.name,
          durationMinutes: schema.services.durationMinutes
        })
        .from(schema.services)
        .where(
          scoped.where(
            schema.services,
            and(eq(schema.services.id, selector.serviceId), eq(schema.services.active, true))
          )
        )
        .limit(1);
      return service ?? null;
    }

    const query = (selector.serviceName ?? "").trim();
    if (!query) return null;

    // Escape LIKE wildcards so a caller phrase like "100% visa help" cannot
    // accidentally match everything.
    const likeQuery = query.replace(/[\\%_]/g, "\\$&");

    const [substringMatch] = await this.db
      .select({
        id: schema.services.id,
        name: schema.services.name,
        durationMinutes: schema.services.durationMinutes
      })
      .from(schema.services)
      .where(
        scoped.where(
          schema.services,
          and(ilike(schema.services.name, `%${likeQuery}%`), eq(schema.services.active, true))
        )
      )
      .limit(1);
    if (substringMatch) return substringMatch;

    // Fuzzy fallback: score every active service by shared significant words
    // (e.g. caller says "student visa", service is named "Student Services Consultation").
    const candidates = await this.db
      .select({
        id: schema.services.id,
        name: schema.services.name,
        durationMinutes: schema.services.durationMinutes
      })
      .from(schema.services)
      .where(scoped.where(schema.services, eq(schema.services.active, true)));

    const queryWords = new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2)
    );
    if (queryWords.size === 0) return null;

    let best: ToolService | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const candidateWords = candidate.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2);
      const score = candidateWords.filter((word) => queryWords.has(word)).length;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return bestScore > 0 ? best : null;
  }

  async updateCallerName(
    tenantId: string,
    callerId: string,
    displayName: string
  ): Promise<void> {
    const scoped = withTenant(this.db, tenantId);
    await this.db
      .update(schema.callers)
      .set({ displayName, updatedAt: new Date() })
      .where(scoped.where(schema.callers, eq(schema.callers.id, callerId)));
  }

  async updateCallerProfile(
    tenantId: string,
    callerId: string,
    fields: Record<string, unknown>
  ) {
    const scoped = withTenant(this.db, tenantId);
    const definitions = await this.db
      .select({
        key: schema.intakeFields.key,
        type: schema.intakeFields.type,
        options: schema.intakeFields.options,
        active: schema.intakeFields.active
      })
      .from(schema.intakeFields)
      .where(scoped.where(schema.intakeFields));

    const { accepted, rejected } = validateProfileFields(fields, definitions);
    const name = typeof accepted.name === "string" ? accepted.name : undefined;
    const profileUpdates = Object.fromEntries(
      Object.entries(accepted).filter(([key]) => key !== "name")
    ) as Record<string, ProfileValue>;
    const updated = Object.keys(accepted);

    if (updated.length === 0) {
      const [caller] = await this.db
        .select({
          name: schema.callers.displayName,
          profile: schema.callers.profile
        })
        .from(schema.callers)
        .where(scoped.where(schema.callers, eq(schema.callers.id, callerId)))
        .limit(1);
      if (!caller) throw new Error("Caller not found");
      return { updated, rejected, name: caller.name, profile: caller.profile };
    }

    const [caller] = await this.db
      .update(schema.callers)
      .set({
        ...(name ? { displayName: name } : {}),
        ...(Object.keys(profileUpdates).length > 0
          ? { profile: sql`${schema.callers.profile} || ${JSON.stringify(profileUpdates)}::jsonb` }
          : {}),
        updatedAt: new Date()
      })
      .where(scoped.where(schema.callers, eq(schema.callers.id, callerId)))
      .returning({
        name: schema.callers.displayName,
        profile: schema.callers.profile
      });
    if (!caller) throw new Error("Caller not found");
    return { updated, rejected, name: caller.name, profile: caller.profile };
  }

  async createBooking(
    tenantId: string,
    callerId: string,
    values: {
      serviceId: string;
      startsAt: Date;
      endsAt: Date;
      gcalEventId: string | null;
    }
  ): Promise<{ id: string }> {
    const scoped = withTenant(this.db, tenantId);
    const [booking] = await this.db
      .insert(schema.bookings)
      .values(
        scoped.values({
          callerId,
          serviceId: values.serviceId,
          startsAt: values.startsAt,
          endsAt: values.endsAt,
          status: "confirmed" as const,
          gcalEventId: values.gcalEventId,
          notes: "Booked by voice agent"
        })
      )
      .returning({ id: schema.bookings.id });
    if (!booking) throw new Error("Booking insert returned no row");
    return booking;
  }

  async findConfirmedBooking(
    tenantId: string,
    callerId: string,
    bookingId: string
  ): Promise<{ id: string; gcalEventId: string | null } | null> {
    const scoped = withTenant(this.db, tenantId);
    const [booking] = await this.db
      .select({
        id: schema.bookings.id,
        gcalEventId: schema.bookings.gcalEventId
      })
      .from(schema.bookings)
      .where(
        scoped.where(
          schema.bookings,
          and(
            eq(schema.bookings.id, bookingId),
            eq(schema.bookings.callerId, callerId),
            eq(schema.bookings.status, "confirmed"),
            isNull(schema.bookings.deletedAt)
          )
        )
      )
      .limit(1);
    return booking ?? null;
  }

  async cancelBooking(
    tenantId: string,
    callerId: string,
    bookingId: string
  ): Promise<void> {
    const scoped = withTenant(this.db, tenantId);
    await this.db
      .update(schema.bookings)
      .set({
        status: "cancelled",
        deletedAt: new Date(),
        updatedAt: new Date()
      })
      .where(
        scoped.where(
          schema.bookings,
          and(
            eq(schema.bookings.id, bookingId),
            eq(schema.bookings.callerId, callerId),
            isNull(schema.bookings.deletedAt)
          )
        )
      );
  }

  async saveMemory(
    tenantId: string,
    callerId: string,
    sourceCallId: string,
    memory: { kind: "fact" | "preference" | "summary"; content: string }
  ): Promise<{ id: string }> {
    const scoped = withTenant(this.db, tenantId);
    const [saved] = await this.db
      .insert(schema.callerMemories)
      .values(
        scoped.values({
          callerId,
          sourceCallId,
          kind: memory.kind,
          content: memory.content
        })
      )
      .returning({ id: schema.callerMemories.id });
    if (!saved) throw new Error("Memory insert returned no row");
    return saved;
  }

  async getCallerContext(tenantId: string, callerId: string) {
    const scoped = withTenant(this.db, tenantId);
    const [callerRows, memories, upcomingBookings, intakeFields] = await Promise.all([
      this.db
        .select({
          id: schema.callers.id,
          phoneE164: schema.callers.phoneE164,
          displayName: schema.callers.displayName,
          country: schema.callers.country,
          timezone: schema.callers.timezone,
          profile: schema.callers.profile,
          stage: schema.callers.stage
        })
        .from(schema.callers)
        .where(scoped.where(schema.callers, eq(schema.callers.id, callerId)))
        .limit(1),
      this.db
        .select({
          id: schema.callerMemories.id,
          kind: schema.callerMemories.kind,
          content: schema.callerMemories.content
        })
        .from(schema.callerMemories)
        .where(
          scoped.where(
            schema.callerMemories,
            eq(schema.callerMemories.callerId, callerId)
          )
        )
        .orderBy(desc(schema.callerMemories.createdAt))
        .limit(5),
      this.db
        .select({
          id: schema.bookings.id,
          serviceName: schema.services.name,
          startsAt: schema.bookings.startsAt,
          endsAt: schema.bookings.endsAt
        })
        .from(schema.bookings)
        .innerJoin(
          schema.services,
          and(
            eq(schema.services.id, schema.bookings.serviceId),
            eq(schema.services.tenantId, tenantId)
          )
        )
        .where(
          scoped.where(
            schema.bookings,
            and(
              eq(schema.bookings.callerId, callerId),
              eq(schema.bookings.status, "confirmed"),
              gte(schema.bookings.startsAt, new Date()),
              isNull(schema.bookings.deletedAt)
            )
          )
        )
        .orderBy(asc(schema.bookings.startsAt))
        .limit(10),
      this.db
        .select({
          id: schema.intakeFields.id,
          key: schema.intakeFields.key,
          label: schema.intakeFields.label,
          type: schema.intakeFields.type,
          options: schema.intakeFields.options,
          priority: schema.intakeFields.priority,
          sort: schema.intakeFields.sort,
          active: schema.intakeFields.active
        })
        .from(schema.intakeFields)
        .where(scoped.where(schema.intakeFields, eq(schema.intakeFields.active, true)))
        .orderBy(asc(schema.intakeFields.sort))
    ]);

    const caller = callerRows[0];
    if (!caller) throw new Error("Caller not found");
    return { caller, memories, upcomingBookings, intakeFields };
  }
}

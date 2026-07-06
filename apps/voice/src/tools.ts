import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNull
} from "drizzle-orm";
import { z } from "zod";
import type { AvailabilityService, CalendarService } from "@recepto/calendar";
import {
  schema,
  withTenant,
  type createDatabase
} from "@recepto/db";
import type { CallSession } from "./call-session.js";

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
  createBooking(
    tenantId: string,
    callerId: string,
    values: {
      serviceId: string;
      startsAt: Date;
      endsAt: Date;
      gcalEventId: string;
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

    const slots = await this.dependencies.availability.getSlots(
      this.session.tenantId,
      service.id,
      input.date
    );
    return {
      serviceId: service.id,
      slots: slots.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString()
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

    const eventId = await this.dependencies.calendar.createEvent(
      this.session.tenantId,
      {
        title: service.name + " — " + (input.callerName ?? this.session.caller.displayName ?? this.session.caller.phoneE164),
        startsAt,
        endsAt,
        description: "Booked by the Recepto voice receptionist."
      }
    );

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
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        serviceName: service.name
      };
    } catch (error) {
      await this.dependencies.calendar
        .deleteEvent(this.session.tenantId, eventId)
        .catch(() => undefined);
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
      await this.dependencies.calendar.deleteEvent(
        this.session.tenantId,
        booking.gcalEventId
      );
    }
    await this.dependencies.repository.cancelBooking(
      this.session.tenantId,
      this.session.caller.id,
      booking.id
    );
    return { bookingId: booking.id, cancelled: true };
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
    return {
      ...context,
      upcomingBookings: context.upcomingBookings.map((booking) => ({
        ...booking,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString()
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
    const match = selector.serviceId
      ? eq(schema.services.id, selector.serviceId)
      : ilike(schema.services.name, selector.serviceName ?? "");
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
          and(match, eq(schema.services.active, true))
        )
      )
      .limit(1);
    return service ?? null;
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

  async createBooking(
    tenantId: string,
    callerId: string,
    values: {
      serviceId: string;
      startsAt: Date;
      endsAt: Date;
      gcalEventId: string;
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
    const [callerRows, memories, upcomingBookings] = await Promise.all([
      this.db
        .select({
          id: schema.callers.id,
          phoneE164: schema.callers.phoneE164,
          displayName: schema.callers.displayName
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
        .limit(10)
    ]);

    const caller = callerRows[0];
    if (!caller) throw new Error("Caller not found");
    return { caller, memories, upcomingBookings };
  }
}



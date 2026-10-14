import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { explainNoSlots } from "./office-hours.js";
import { addDaysIso, isWithinCallerDay, localHour, officeHoursForCaller, pickAcrossDays, spreadPick } from "./slot-selection.js";
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
  price: string | null;
}

export interface ToolStaff {
  id: string;
  name: string;
  isRegisteredAgent: boolean;
  credentialLabel: string;
}

export interface ToolRepository {
  findService(
    tenantId: string,
    selector: { serviceId?: string; serviceName?: string }
  ): Promise<ToolService | null>;
  findStaff(
    tenantId: string,
    selector: { staffId?: string; staffName?: string }
  ): Promise<ToolStaff | null>;
  /**
   * Resolves a staff member's phone number for call transfer. Deliberately
   * separate from findStaff/ToolStaff, which are model-facing and must never
   * expose a phone number to the AI or a tool-call transcript.
   */
  findStaffPhoneForTransfer(
    tenantId: string,
    selector: { staffId?: string; staffName?: string }
  ): Promise<{ id: string; name: string; phoneE164: string | null } | null>;
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
      staffId: string | null;
      startsAt: Date;
      endsAt: Date;
      gcalEventId: string | null;
    }
  ): Promise<{ id: string }>;
  createCallbackRequest(
    tenantId: string,
    callerId: string,
    sourceCallId: string,
    values: { reason: string; preferredTime: string }
  ): Promise<{ id: string }>;
}

export interface ToolExecutorDependencies {
  availability: Pick<AvailabilityService, "getSlots">;
  calendar: Pick<CalendarService, "createEvent" | "deleteEvent">;
  repository: ToolRepository;
}

const availabilityInput = z
  .object({
    serviceId: z.string().uuid().nullable().optional(),
    serviceName: z.string().trim().min(1).max(160).nullable().optional(),
    service: z.string().trim().min(1).max(160).nullable().optional(),
    staffId: z.string().uuid().nullable().optional(),
    staffName: z.string().trim().min(1).max(160).nullable().optional(),
    staff: z.string().trim().min(1).max(160).nullable().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    days: z.number().int().nullable().optional(),
    after: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).nullable().optional()
  })
  .transform((val) => ({
    serviceId: val.serviceId ?? undefined,
    serviceName: val.serviceName ?? val.service ?? "Consultation",
    staffId: val.staffId ?? undefined,
    staffName: val.staffName ?? val.staff ?? undefined,
    date: val.date ?? new Date().toISOString().split("T")[0]!,
    // How many days to search from `date`; "any day this week" callers get several.
    days: Math.min(MAX_SEARCH_DAYS, Math.max(1, val.days ?? 1)),
    // Caller-local "HH:MM": only slots starting at or after it ("anything after 12?").
    afterHour: val.after ? Number(val.after.split(":")[0]) + Number(val.after.split(":")[1]) / 60 : undefined
  }));

const createBookingInput = z
  .object({
    serviceId: z.string().uuid().nullable().optional(),
    serviceName: z.string().trim().min(1).max(160).nullable().optional(),
    service: z.string().trim().min(1).max(160).nullable().optional(),
    staffId: z.string().uuid().nullable().optional(),
    staffName: z.string().trim().min(1).max(160).nullable().optional(),
    startsAt: z.string(),
    callerName: z.string().trim().min(1).max(120).nullable().optional(),
    name: z.string().trim().min(1).max(120).nullable().optional()
  })
  .transform((val) => ({
    serviceId: val.serviceId ?? undefined,
    serviceName: val.serviceName ?? val.service ?? "Consultation",
    staffId: val.staffId ?? undefined,
    staffName: val.staffName ?? undefined,
    startsAt: val.startsAt,
    callerName: val.callerName ?? val.name ?? undefined
  }));

const updateCallerProfileInput = z
  .union([
    z.object({
      fields: z.record(z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.undefined()]))
    }),
    z.record(z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.undefined()]))
  ])
  .transform((val) => {
    if ("fields" in val && typeof val.fields === "object" && val.fields !== null) {
      return val as { fields: Record<string, unknown> };
    }
    const cleanFields: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(val)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        cleanFields[k] = v;
      }
    }
    return { fields: cleanFields };
  });
const requestCallbackInput = z
  .object({
    reason: z.string().trim().min(1).max(500).nullable().optional(),
    preferredTime: z.string().trim().max(200).nullable().optional(),
    time: z.string().trim().max(200).nullable().optional()
  })
  .transform((val) => ({
    reason: val.reason ?? "Caller asked for a call back",
    preferredTime: val.preferredTime ?? val.time ?? ""
  }));

const TOOL_TIMEOUT_MS = 3_500;

/** Most days one check_availability call may search ("any day this week"). */
const MAX_SEARCH_DAYS = 7;

export class ToolExecutor {
  constructor(
    private readonly session: CallSession,
    private readonly dependencies: ToolExecutorDependencies
  ) {}

  async execute(name: string, rawInput: unknown): Promise<unknown> {
    const executePromise = this.runTool(name, rawInput);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Tool ${name} timed out after ${TOOL_TIMEOUT_MS}ms`)),
        TOOL_TIMEOUT_MS
      )
    );
    return Promise.race([executePromise, timeoutPromise]);
  }

  private async runTool(name: string, rawInput: unknown): Promise<unknown> {
    switch (name) {
      case "check_availability":
        return this.checkAvailability(availabilityInput.parse(rawInput));
      case "create_booking":
        return this.createBooking(createBookingInput.parse(rawInput));
      case "request_callback":
        return this.requestCallback(requestCallbackInput.parse(rawInput));
      case "update_caller_profile":
        return this.updateCallerProfile(updateCallerProfileInput.parse(rawInput));
      default:
        throw new Error("Unknown tool: " + name);
    }
  }

  private async checkAvailability(input: z.infer<typeof availabilityInput>) {
    const selector = input.serviceId
      ? { serviceId: input.serviceId }
      : { serviceName: input.serviceName };
    const staffSelector = input.staffId || input.staffName
      ? (input.staffId ? { staffId: input.staffId } : { staffName: input.staffName })
      : null;

    // Parallelize service and staff lookup to save one network/database roundtrip
    const [service, staff] = await Promise.all([
      this.dependencies.repository.findService(this.session.tenantId, selector),
      staffSelector
        ? this.dependencies.repository.findStaff(this.session.tenantId, staffSelector)
        : Promise.resolve(null)
    ]);

    if (!service) throw new Error("Service not found");
    if (staffSelector && !staff) throw new Error("Staff member not found");
    const serviceId = service.id;
    const staffId = staff?.id;

    const callerTimezone = this.session.caller.timezone ?? this.session.timezone;
    const sameTimezone = callerTimezone === this.session.timezone;
    const searchDates = Array.from({ length: input.days }, (_, offset) => addDaysIso(input.date, offset));
    // A caller's day can straddle two business dates, so search the neighbours too.
    const businessDates = sameTimezone
      ? searchDates
      : [...new Set(searchDates.flatMap((date) => adjacentIsoDates(date)))];
    const candidateGroups = await Promise.all(
      businessDates.map((date) =>
        this.dependencies.availability.getSlots(this.session.tenantId, serviceId, date, staffId)
      )
    );
    const openSlots = candidateGroups
      .flat()
      .filter((slot, index, all) =>
        all.findIndex((other) => other.startsAt.getTime() === slot.startsAt.getTime()) === index
      )
      .filter((slot) => searchDates.includes(localDateInTimezone(slot.startsAt, callerTimezone)))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    // A caller in another timezone is only offered times inside their own 9 AM to 6 PM.
    const inCallerDay = sameTimezone ? openSlots : openSlots.filter((slot) => isWithinCallerDay(slot, callerTimezone));
    const afterHour = input.afterHour;
    const suitable = afterHour === undefined
      ? inCallerDay
      : inCallerDay.filter((slot) => localHour(slot.startsAt, callerTimezone) >= afterHour);
    const byDay = new Map<string, typeof suitable>();
    for (const slot of suitable) {
      const day = localDateInTimezone(slot.startsAt, callerTimezone);
      byDay.set(day, [...(byDay.get(day) ?? []), slot]);
    }
    const offered =
      input.days > 1
        ? pickAcrossDays([...byDay].map(([date, slots]) => ({ date, slots })), 2)
        : spreadPick(suitable, 4);

    const onlyOutsideCallerHours = offered.length === 0 && openSlots.length > 0 && afterHour === undefined;
    const officeHoursCallerTime = sameTimezone
      ? undefined
      : officeHoursForCaller(this.session.businessHours ?? [], this.session.timezone, callerTimezone, input.date, service.durationMinutes);
    const noSlots =
      openSlots.length === 0 && input.days === 1
        ? explainNoSlots(this.session.businessHours ?? [], this.session.timezone, input.date, service.durationMinutes)
        : null;
    const toSlot = (slot: (typeof openSlots)[number]) => ({
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      callerLocalTime: formatCallerLocalTime(slot.startsAt, callerTimezone),
      businessLocalTime: formatCallerLocalTime(slot.startsAt, this.session.timezone)
    });
    return {
      serviceId,
      serviceName: service.name,
      price: service.price,
      staffId: staffId ?? null,
      callerTimezone,
      ...(input.days > 1 ? { searchedDays: input.days } : {}),
      ...(sameTimezone ? {} : { onlyOffering: "times between 9 AM and 6 PM in the caller's own timezone" }),
      ...(officeHoursCallerTime ? { officeHoursCallerTime } : {}),
      ...(afterHour !== undefined && offered.length === 0
        ? {
            noSlotsExplanation:
              "Nothing is free after the requested time that day. Use officeHoursCallerTime to say why, then offer one of latestEarlierSlots or another day. Never offer a time that is not listed.",
            latestEarlierSlots: inCallerDay.slice(-2).map(toSlot)
          }
        : {}),
      ...(noSlots ? { noSlotsReason: noSlots.reason, noSlotsExplanation: noSlots.explanation } : {}),
      ...(openSlots.length === 0 && input.days > 1
        ? { noSlotsExplanation: `There are no openings in the next ${input.days} days.` }
        : {}),
      ...(onlyOutsideCallerHours
        ? {
            onlyOutsideCallerHours: true,
            hint: "Openings exist, but only outside 9 AM to 6 PM for the caller. Say so in one sentence and offer the earliest of earliestOutsideHours only if the caller agrees, or offer a callback.",
            earliestOutsideHours: openSlots.slice(0, 2).map(toSlot)
          }
        : {}),
      slots: offered.map(toSlot)
    };
  }

  private async createBooking(input: z.infer<typeof createBookingInput>) {
    const selector = input.serviceId
      ? { serviceId: input.serviceId }
      : { serviceName: input.serviceName };

    const [service, staff] = await Promise.all([
      this.dependencies.repository.findService(this.session.tenantId, selector),
      input.staffId
        ? this.dependencies.repository.findStaff(this.session.tenantId, { staffId: input.staffId })
        : Promise.resolve(null)
    ]);

    if (!service) throw new Error("Service not found");
    if (input.staffId && !staff) throw new Error("Staff member not found");
    const serviceId = service.id;
    const serviceName = service.name;
    const staffId = staff?.id ?? null;

    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new Error("Invalid start time for booking");
    }
    if (startsAt <= new Date()) {
      throw new Error("Cannot book appointment in the past");
    }

    const businessDate = localDateInTimezone(startsAt, this.session.timezone);
    const slots = await this.dependencies.availability.getSlots(
      this.session.tenantId,
      serviceId,
      businessDate,
      staffId ?? undefined
    );
    const selected = slots.find(
      (slot) => Math.abs(slot.startsAt.getTime() - startsAt.getTime()) < 60_000
    );
    if (!selected) throw new Error("Requested booking slot is unavailable");
    const endsAt = selected.endsAt;

    // The caller-name update and the calendar sync are independent writes —
    // running them concurrently instead of sequentially removes dead air
    // right after the caller confirms a time slot.
    const nameUpdate = input.callerName
      ? this.dependencies.repository.updateCallerName(
          this.session.tenantId,
          this.session.caller.id,
          input.callerName
        )
      : Promise.resolve();

    // A tenant without a connected Google Calendar still gets local bookings;
    // the dashboard remains the source of truth until OAuth is completed.
    const calendarCreate = this.dependencies.calendar
      .createEvent(this.session.tenantId, {
        title: serviceName + " — " + (input.callerName ?? this.session.caller.displayName ?? this.session.caller.phoneE164),
        startsAt,
        endsAt,
        description: "Booked by the Recepto voice receptionist."
      })
      .then((id) => ({ eventId: id, error: null as unknown }))
      .catch((error: unknown) => ({ eventId: null, error }));

    const [, calendarResult] = await Promise.all([nameUpdate, calendarCreate]);
    if (calendarResult.error && !(calendarResult.error instanceof CalendarConnectionRevokedError)) {
      throw calendarResult.error;
    }
    const eventId = calendarResult.eventId;

    try {
      const booking = await this.dependencies.repository.createBooking(
        this.session.tenantId,
        this.session.caller.id,
        {
          serviceId,
          staffId,
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
        callerLocalTime: formatCallerLocalTime(
          startsAt,
          this.session.caller.timezone ?? this.session.timezone
        ),
        businessLocalTime: formatCallerLocalTime(startsAt, this.session.timezone),
        serviceName,
        price: service.price,
        staffId
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

  private async updateCallerProfile(input: z.infer<typeof updateCallerProfileInput>) {
    return this.dependencies.repository.updateCallerProfile(
      this.session.tenantId,
      this.session.caller.id,
      input.fields
    );
  }

  private async requestCallback(input: z.infer<typeof requestCallbackInput>) {
    const request = await this.dependencies.repository.createCallbackRequest(
      this.session.tenantId,
      this.session.caller.id,
      this.session.callId,
      input
    );
    return { callbackRequestId: request.id, recorded: true };
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const METADATA_CACHE_TTL_MS = 60_000;

export class DrizzleToolRepository implements ToolRepository {
  private readonly servicesCache = new Map<string, CacheEntry<ToolService[]>>();
  private readonly staffCache = new Map<string, CacheEntry<ToolStaff[]>>();
  private readonly staffPhoneCache = new Map<
    string,
    CacheEntry<Array<{ id: string; name: string; phoneE164: string | null }>>
  >();
  private readonly intakeDefsCache = new Map<
    string,
    CacheEntry<
      Array<{
        key: string;
        type: "text" | "select" | "boolean" | "number";
        options: unknown;
        active: boolean;
      }>
    >
  >();

  constructor(private readonly db: Database) {}

  private getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = map.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value;
    }
    return null;
  }

  private setCached<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
    map.set(key, { value, expiresAt: Date.now() + METADATA_CACHE_TTL_MS });
  }

  async getActiveServices(tenantId: string): Promise<ToolService[]> {
    const cached = this.getCached(this.servicesCache, tenantId);
    if (cached) return cached;

    const scoped = withTenant(this.db, tenantId);
    const services = await this.db
      .select({
        id: schema.services.id,
        name: schema.services.name,
        durationMinutes: schema.services.durationMinutes,
        price: schema.services.price
      })
      .from(schema.services)
      .where(scoped.where(schema.services, eq(schema.services.active, true)));

    this.setCached(this.servicesCache, tenantId, services);
    return services;
  }

  async findService(
    tenantId: string,
    selector: { serviceId?: string; serviceName?: string }
  ): Promise<ToolService | null> {
    const services = await this.getActiveServices(tenantId);

    if (selector.serviceId) {
      const match = services.find((s) => s.id === selector.serviceId);
      return match ?? null;
    }

    const query = (selector.serviceName ?? "").trim();
    if (!query) return null;

    const queryLower = query.toLowerCase();

    // 1. Direct exact or substring match
    const substringMatch = services.find((s) =>
      s.name.toLowerCase().includes(queryLower)
    );
    if (substringMatch) return substringMatch;

    // 2. Fuzzy fallback: score every active service by shared significant words
    const queryWords = new Set(
      queryLower
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2)
    );
    if (queryWords.size === 0) return null;

    let best: ToolService | null = null;
    let bestScore = 0;
    for (const candidate of services) {
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

  async findStaff(
    tenantId: string,
    selector: { staffId?: string; staffName?: string }
  ): Promise<ToolStaff | null> {
    const staffList = await this.listStaff(tenantId);

    if (selector.staffId) {
      const match = staffList.find((s) => s.id === selector.staffId);
      return match ?? null;
    }

    const query = (selector.staffName ?? "").trim();
    if (!query) return null;

    const queryLower = query.toLowerCase();
    const match = staffList.find((s) => s.name.toLowerCase().includes(queryLower));
    return match ?? null;
  }

  async findStaffPhoneForTransfer(
    tenantId: string,
    selector: { staffId?: string; staffName?: string }
  ): Promise<{ id: string; name: string; phoneE164: string | null } | null> {
    let phones = this.getCached(this.staffPhoneCache, tenantId);
    if (!phones) {
      const scoped = withTenant(this.db, tenantId);
      const [staffRows, ownLines] = await Promise.all([
        this.db
          .select({
            id: schema.staff.id,
            name: schema.staff.name,
            phoneE164: schema.staff.phoneE164
          })
          .from(schema.staff)
          .where(scoped.where(schema.staff, eq(schema.staff.active, true))),
        this.db
          .select({ e164: schema.phoneNumbers.e164 })
          .from(schema.phoneNumbers)
          .where(scoped.where(schema.phoneNumbers))
      ]);
      // Never transfer to one of this business's own AI lines: the "transfer"
      // would just dial the receptionist again and loop the caller back to it.
      const ownNumbers = new Set(ownLines.map((line) => line.e164));
      phones = staffRows.map((row) => ({
        ...row,
        phoneE164: row.phoneE164 && ownNumbers.has(row.phoneE164) ? null : row.phoneE164
      }));
      this.setCached(this.staffPhoneCache, tenantId, phones);
    }

    if (selector.staffId) {
      const match = phones.find((s) => s.id === selector.staffId);
      return match ?? null;
    }

    const query = (selector.staffName ?? "").trim();
    if (!query) {
      const anyStaff = phones.find((s) => s.phoneE164 !== null);
      return anyStaff ?? null;
    }

    const queryLower = query.toLowerCase();
    const match = phones.find((s) => s.name.toLowerCase().includes(queryLower));
    return match ?? null;
  }

  private async listStaff(tenantId: string): Promise<ToolStaff[]> {
    const cached = this.getCached(this.staffCache, tenantId);
    if (cached) return cached;

    const scoped = withTenant(this.db, tenantId);
    const staffList = await this.db
      .select({
        id: schema.staff.id,
        name: schema.staff.name,
        isRegisteredAgent: schema.staff.isRegisteredAgent,
        credentialLabel: schema.staff.credentialLabel
      })
      .from(schema.staff)
      .where(scoped.where(schema.staff, eq(schema.staff.active, true)))
      .orderBy(asc(schema.staff.name));

    this.setCached(this.staffCache, tenantId, staffList);
    return staffList;
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
    let definitions = this.getCached(this.intakeDefsCache, tenantId);
    if (!definitions) {
      definitions = await this.db
        .select({
          key: schema.intakeFields.key,
          type: schema.intakeFields.type,
          options: schema.intakeFields.options,
          active: schema.intakeFields.active
        })
        .from(schema.intakeFields)
        .where(scoped.where(schema.intakeFields));
      this.setCached(this.intakeDefsCache, tenantId, definitions);
    }

    const { accepted, rejected } = validateProfileFields(fields, definitions);
    const name = typeof accepted.name === "string" ? accepted.name : undefined;
    const phone = typeof accepted.phone === "string" ? accepted.phone : undefined;
    const profileUpdates = Object.fromEntries(
      Object.entries(accepted).filter(([key]) => key !== "name" && key !== "phone")
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
        ...(phone ? { phoneE164: phone } : {}),
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
      staffId: string | null;
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
          staffId: values.staffId,
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

  async createCallbackRequest(
    tenantId: string,
    callerId: string,
    sourceCallId: string,
    values: { reason: string; preferredTime: string }
  ): Promise<{ id: string }> {
    const scoped = withTenant(this.db, tenantId);
    const [saved] = await this.db
      .insert(schema.callbackRequests)
      .values(
        scoped.values({
          callerId,
          sourceCallId,
          reason: values.reason,
          preferredTime: values.preferredTime
        })
      )
      .returning({ id: schema.callbackRequests.id });
    if (!saved) throw new Error("Callback request insert returned no row");
    return saved;
  }
}

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  }
});

const auditColumns = () => ({
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export const tenantStatusEnum = pgEnum("tenant_status", [
  "onboarding",
  "review",
  "live",
  "suspended"
]);
export const tenantRoleEnum = pgEnum("tenant_role", ["owner", "staff"]);
export const languageModeEnum = pgEnum("language_mode", ["hinglish", "english", "hindi"]);
export const agentProfileSourceEnum = pgEnum("agent_profile_source", ["auto", "manual"]);
export const phoneChannelEnum = pgEnum("phone_channel", ["twilio", "whatsapp"]);
export const phoneStatusEnum = pgEnum("phone_status", ["active", "inactive"]);
export const memoryKindEnum = pgEnum("memory_kind", ["fact", "preference", "summary"]);
export const intakeFieldTypeEnum = pgEnum("intake_field_type", ["text", "select", "boolean", "number"]);
export const intakeFieldPriorityEnum = pgEnum("intake_field_priority", ["key", "optional"]);
export const callerStageEnum = pgEnum("caller_stage", ["new", "interested", "booked", "client"]);
export const callDirectionEnum = pgEnum("call_direction", ["inbound", "outbound"]);
export const callStatusEnum = pgEnum("call_status", [
  "ringing",
  "in_progress",
  "completed",
  "failed",
  "abandoned",
  "transferred"
]);
export const transcriptRoleEnum = pgEnum("transcript_role", [
  "caller",
  "agent",
  "system",
  "tool"
]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "confirmed",
  "cancelled",
  "completed",
  "no_show"
]);
export const googleConnectionStatusEnum = pgEnum("google_connection_status", [
  "active",
  "revoked"
]);
export const onboardingJobStatusEnum = pgEnum("onboarding_job_status", [
  "queued",
  "crawling",
  "distilling",
  "ready_for_review",
  "failed"
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull(),
    passwordHash: text("password_hash"),
    name: text("name").notNull(),
    ...auditColumns()
  },
  (table) => [uniqueIndex("users_email_uidx").on(table.email)]
);

export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull(),
    source: text("source").notNull().default("landing"),
    ...auditColumns()
  },
  (table) => [uniqueIndex("waitlist_signups_email_uidx").on(table.email)]
);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: tenantStatusEnum("status").notNull().default("onboarding"),
    businessPhone: text("business_phone").notNull(),
    websiteUrl: text("website_url").notNull(),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    // Opt-in: Twilio places caller-consent/compliance responsibility on us, not
    // them, so recording the transferred call segment defaults off per tenant.
    transferRecordingEnabled: boolean("transfer_recording_enabled").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    ...auditColumns()
  },
  (table) => [uniqueIndex("tenants_slug_uidx").on(table.slug)]
);

export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: tenantRoleEnum("role").notNull(),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("tenant_members_tenant_user_uidx").on(table.tenantId, table.userId),
    index("tenant_members_tenant_id_idx").on(table.tenantId),
    index("tenant_members_user_id_idx").on(table.userId)
  ]
);

export const agentProfiles = pgTable(
  "agent_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentMd: text("agent_md").notNull(),
    voiceGreeting: text("voice_greeting").notNull(),
    languageMode: languageModeEnum("language_mode").notNull().default("hinglish"),
    languages: jsonb("languages").$type<string[]>().notNull().default(sql`'["English", "Hindi"]'::jsonb`),
    version: integer("version").notNull().default(1),
    source: agentProfileSourceEnum("source").notNull(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("agent_profiles_tenant_id_uidx").on(table.tenantId),
    index("agent_profiles_updated_by_idx").on(table.updatedBy)
  ]
);

export const agentProfileRevisions = pgTable(
  "agent_profile_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentMd: text("agent_md").notNull(),
    version: integer("version").notNull(),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("agent_profile_revisions_tenant_version_uidx").on(
      table.tenantId,
      table.version
    ),
    index("agent_profile_revisions_tenant_id_idx").on(table.tenantId)
  ]
);

export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    e164: text("e164").notNull(),
    channel: phoneChannelEnum("channel").notNull(),
    status: phoneStatusEnum("status").notNull().default("active"),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("phone_numbers_e164_uidx").on(table.e164),
    index("phone_numbers_tenant_id_idx").on(table.tenantId)
  ]
);

export const tenantTwilioCredentials = pgTable(
  "tenant_twilio_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    accountSid: text("account_sid").notNull(),
    // AES-256-GCM ciphertext (iv + tag + data, base64) — see lib/crypto/secret-box.
    authTokenCiphertext: text("auth_token_ciphertext").notNull(),
    phoneNumberSid: text("phone_number_sid").notNull(),
    webhookConfiguredAt: timestamp("webhook_configured_at", { withTimezone: true, mode: "date" }),
    ...auditColumns()
  },
  (table) => [uniqueIndex("tenant_twilio_credentials_tenant_id_uidx").on(table.tenantId)]
);

export const callers = pgTable(
  "callers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    phoneE164: text("phone_e164").notNull(),
    displayName: text("display_name"),
    country: text("country"),
    timezone: text("timezone"),
    profile: jsonb("profile").$type<Record<string, string | number | boolean>>().notNull().default(sql`'{}'::jsonb`),
    stage: callerStageEnum("stage").notNull().default("new"),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("callers_tenant_phone_uidx").on(table.tenantId, table.phoneE164),
    index("callers_tenant_id_idx").on(table.tenantId)
  ]
);

export const intakeFields = pgTable(
  "intake_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: intakeFieldTypeEnum("type").notNull(),
    options: jsonb("options").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    priority: intakeFieldPriorityEnum("priority").notNull().default("optional"),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("intake_fields_tenant_key_uidx").on(table.tenantId, table.key),
    index("intake_fields_tenant_id_idx").on(table.tenantId),
    check("intake_fields_sort_check", sql`${table.sort} >= 0`)
  ]
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    callerId: uuid("caller_id")
      .notNull()
      .references(() => callers.id, { onDelete: "restrict" }),
    channel: phoneChannelEnum("channel").notNull(),
    direction: callDirectionEnum("direction").notNull(),
    providerCallSid: text("provider_call_sid").notNull(),
    status: callStatusEnum("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    durationSeconds: integer("duration_seconds"),
    // Reused for the transferred segment's recording when a tenant has
    // transferRecordingEnabled — nothing else populates this column today.
    recordingUrl: text("recording_url"),
    transferredToStaffId: uuid("transferred_to_staff_id").references(() => staff.id, {
      onDelete: "set null"
    }),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("calls_provider_call_sid_uidx").on(table.providerCallSid),
    index("calls_tenant_id_idx").on(table.tenantId),
    index("calls_caller_id_idx").on(table.callerId),
    index("calls_transferred_to_staff_id_idx").on(table.transferredToStaffId)
  ]
);

export const callerMemories = pgTable(
  "caller_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    callerId: uuid("caller_id")
      .notNull()
      .references(() => callers.id, { onDelete: "cascade" }),
    kind: memoryKindEnum("kind").notNull(),
    content: text("content").notNull(),
    sourceCallId: uuid("source_call_id").references(() => calls.id, {
      onDelete: "set null"
    }),
    ...auditColumns()
  },
  (table) => [
    index("caller_memories_tenant_id_idx").on(table.tenantId),
    index("caller_memories_caller_id_idx").on(table.callerId),
    index("caller_memories_source_call_id_idx").on(table.sourceCallId)
  ]
);

export const callTranscripts = pgTable(
  "call_transcripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: transcriptRoleEnum("role").notNull(),
    content: text("content").notNull(),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull(),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("call_transcripts_call_seq_uidx").on(table.callId, table.seq),
    index("call_transcripts_tenant_id_idx").on(table.tenantId),
    index("call_transcripts_call_id_idx").on(table.callId)
  ]
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }),
    description: text("description").notNull(),
    active: boolean("active").notNull().default(true),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("services_tenant_name_uidx").on(table.tenantId, table.name),
    index("services_tenant_id_idx").on(table.tenantId)
  ]
);

export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Nullable today; call transfer (a later phase) will require this to be set
    // before a staff member can receive a live transferred call.
    phoneE164: text("phone_e164"),
    isRegisteredAgent: boolean("is_registered_agent").notNull().default(false),
    // Free text so the credential this flag represents stays business-specific
    // (e.g. "MARA registered") rather than hardcoding one industry's term.
    credentialLabel: text("credential_label").notNull().default(""),
    active: boolean("active").notNull().default(true),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("staff_tenant_name_uidx").on(table.tenantId, table.name),
    index("staff_tenant_id_idx").on(table.tenantId)
  ]
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    callerId: uuid("caller_id")
      .notNull()
      .references(() => callers.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    // Nullable: a booking may have no specific staff assigned (auto-assign
    // mode, or tenants that never add staff) — must stay backward compatible.
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    status: bookingStatusEnum("status").notNull().default("confirmed"),
    gcalEventId: text("gcal_event_id"),
    sourceCallId: uuid("source_call_id").references(() => calls.id, {
      onDelete: "set null"
    }),
    notes: text("notes").notNull().default(""),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    ...auditColumns()
  },
  (table) => [
    index("bookings_tenant_starts_at_idx").on(table.tenantId, table.startsAt),
    index("bookings_tenant_id_idx").on(table.tenantId),
    index("bookings_caller_id_idx").on(table.callerId),
    index("bookings_service_id_idx").on(table.serviceId),
    index("bookings_staff_id_idx").on(table.staffId),
    index("bookings_source_call_id_idx").on(table.sourceCallId)
  ]
);

export const businessHours = pgTable(
  "business_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    opens: time("opens").notNull(),
    closes: time("closes").notNull(),
    closed: boolean("closed").notNull().default(false),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("business_hours_tenant_weekday_uidx").on(table.tenantId, table.weekday),
    index("business_hours_tenant_id_idx").on(table.tenantId),
    check("business_hours_weekday_check", sql`${table.weekday} between 0 and 6`)
  ]
);

export const googleConnections = pgTable(
  "google_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    refreshToken: text("refresh_token").notNull(),
    calendarId: text("calendar_id").notNull(),
    connectedBy: uuid("connected_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: googleConnectionStatusEnum("status").notNull().default("active"),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("google_connections_tenant_id_uidx").on(table.tenantId),
    index("google_connections_connected_by_idx").on(table.connectedBy)
  ]
);

export const onboardingJobs = pgTable(
  "onboarding_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    status: onboardingJobStatusEnum("status").notNull().default("queued"),
    inputUrl: text("input_url").notNull(),
    inputHint: text("input_hint").notNull().default(""),
    crawlResult: jsonb("crawl_result").$type<Array<{ url: string; title: string; text: string }>>(),
    error: text("error"),
    ...auditColumns()
  },
  (table) => [index("onboarding_jobs_tenant_id_idx").on(table.tenantId)]
);

export const apiUsage = pgTable(
  "api_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    callsCount: integer("calls_count").notNull().default(0),
    callSeconds: integer("call_seconds").notNull().default(0),
    llmTokens: integer("llm_tokens").notNull().default(0),
    ...auditColumns()
  },
  (table) => [
    uniqueIndex("api_usage_tenant_day_uidx").on(table.tenantId, table.day),
    index("api_usage_tenant_id_idx").on(table.tenantId)
  ]
);

import crypto from "node:crypto";
import formbody from "@fastify/formbody";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { WebSocket, WebSocketServer } from "ws";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  AvailabilityService,
  CalendarService
} from "@recepto/calendar";
import { createDatabase, decryptTwilioAuthToken, schema, withTenant } from "@recepto/db";
import { validateEnv } from "@recepto/shared/env";
import type { AIBridge, TranscriptEvent } from "./ai-bridge.js";
import { AzureRealtimeBridge, buildSessionConfig } from "./azure-realtime-bridge.js";
import { GeminiLiveBridge } from "./gemini-live-bridge.js";
import type { CallSession } from "./call-session.js";
import { deriveCallerGeo } from "./caller-profile.js";
import { createCallSummarizer } from "./call-summary-worker.js";
import {
  AzureSipClient,
  incomingCallEventSchema,
  phoneFromSipHeader,
  sipHeader,
  verifyWebhookSignature
} from "./channels/azure-sip.js";
import { TwilioAdapter } from "./channels/twilio.js";
import { startOnboardingWorker } from "./onboarding/worker.js";
import {
  DrizzleToolRepository,
  ToolExecutor
} from "./tools.js";

const env = validateEnv(process.env);

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when VOICE_PROVIDER=gemini-live`);
  }
  return value;
}

/**
 * Parses GOOGLE_APPLICATION_CREDENTIALS_JSON for hosts (e.g. Render without
 * Secret Files) that can't mount a credentials file for
 * GOOGLE_APPLICATION_CREDENTIALS to point at. Returns undefined when unset so
 * the caller falls back to standard file-path ADC.
 */
function parseInlineGoogleCredentials(): Record<string, unknown> | undefined {
  const raw = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON");
  }
}

const db = createDatabase(env.DATABASE_URL);
// Redis is now optional: it backs only best-effort webhook dedupe, so a failed
// connection must never crash the process or block a call.
const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true
});
redis.on("error", () => {
  // Logged at the call site that used it; swallowing here prevents an unhandled
  // 'error' event from taking the voice server down.
});
void redis.connect().catch(() => undefined);
const calendarService = new CalendarService({
  db,
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  redirectUri: env.GOOGLE_REDIRECT_URI,
  sessionSecret: env.SESSION_SECRET
});
const availabilityService = new AvailabilityService(db, calendarService);
const toolRepository = new DrizzleToolRepository(db);

const app = Fastify({
  logger: true,
  trustProxy: true,
  genReqId: (request) =>
    request.headers["x-request-id"]?.toString() ?? crypto.randomUUID()
});
await app.register(formbody);

// Parse JSON while keeping the raw bytes: webhook signature verification
// (Azure SIP) must run against the exact body the sender signed.
app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (request, body, done) => {
    (request as { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
    } catch {
      done(new Error("Invalid JSON body"), undefined);
    }
  }
);

const mediaStreams = new WebSocketServer({ noServer: true });
const onboardingWorker = startOnboardingWorker(app.log);
const summarizeCall = createCallSummarizer(app.log);

/**
 * Summaries run in the background after a call ends. They must never delay
 * finalization or surface as a call failure, so errors are logged and dropped.
 */
function scheduleCallSummary(job: {
  callId: string;
  tenantId: string;
  callerId: string;
}): void {
  void summarizeCall(job).catch((error: unknown) => {
    app.log.error({ err: error, callId: job.callId }, "Call summary failed");
  });
}
const twilioHttp = new TwilioAdapter({
  accountSid: env.TWILIO_ACCOUNT_SID,
  authToken: env.TWILIO_AUTH_TOKEN
});

const incomingCallSchema = z.object({
  CallSid: z.string().min(1).max(64),
  From: z.string().regex(/^\+[1-9]\d{7,14}$/),
  To: z.string().regex(/^\+[1-9]\d{7,14}$/)
});

function publicHttpUrl(path: string): string {
  return new URL(path, env.PUBLIC_VOICE_URL.endsWith("/") ? env.PUBLIC_VOICE_URL : env.PUBLIC_VOICE_URL + "/").toString();
}

function publicWebSocketUrl(path: string): string {
  const url = new URL(path, env.PUBLIC_VOICE_URL.endsWith("/") ? env.PUBLIC_VOICE_URL : env.PUBLIC_VOICE_URL + "/");
  url.protocol = "wss:";
  return url.toString();
}

/**
 * Builds a TwilioAdapter scoped to whichever Twilio account actually owns a
 * given call. A call REDIRECT (unlike hangup, which works from either
 * account for a call the receiving number answered) must be issued from the
 * same account that owns the call — so transfer specifically needs the
 * tenant's own credentials when they've connected their own Twilio account,
 * not the platform-wide default used elsewhere in this file.
 */
async function getTenantTwilioAdapter(tenantId: string): Promise<TwilioAdapter> {
  const [credentials] = await db
    .select({
      accountSid: schema.tenantTwilioCredentials.accountSid,
      authTokenCiphertext: schema.tenantTwilioCredentials.authTokenCiphertext
    })
    .from(schema.tenantTwilioCredentials)
    .where(eq(schema.tenantTwilioCredentials.tenantId, tenantId))
    .limit(1);

  if (!credentials) {
    return new TwilioAdapter({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN
    });
  }

  return new TwilioAdapter({
    accountSid: credentials.accountSid,
    authToken: decryptTwilioAuthToken(credentials.authTokenCiphertext, env.SESSION_SECRET)
  });
}

function requestHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  return headers;
}

app.get("/health", async () => ({
  ok: true as const,
  uptime: process.uptime()
}));

app.post("/twilio/incoming", async (request, reply) => {
  const rawBody = z.record(z.string()).safeParse(request.body);
  const parsed = rawBody.success
    ? incomingCallSchema.safeParse(rawBody.data)
    : { success: false as const };
  if (!parsed.success) {
    return reply.code(400).send({
      error: { code: "INVALID_INPUT", message: "Invalid Twilio call payload." }
    });
  }

  try {
    // The globally unique called number is the trusted routing key that establishes tenant scope.
    // It must be resolved BEFORE signature verification: each tenant may bring their own Twilio
    // account, so the Auth Token used to verify the signature depends on which tenant this is.
    const [destination] = await db
      .select({
        tenantId: schema.phoneNumbers.tenantId,
        tenantStatus: schema.tenants.status,
        authTokenCiphertext: schema.tenantTwilioCredentials.authTokenCiphertext
      })
      .from(schema.phoneNumbers)
      .innerJoin(
        schema.tenants,
        and(
          eq(schema.tenants.id, schema.phoneNumbers.tenantId),
          isNull(schema.tenants.deletedAt)
        )
      )
      .leftJoin(
        schema.tenantTwilioCredentials,
        eq(schema.tenantTwilioCredentials.tenantId, schema.phoneNumbers.tenantId)
      )
      .where(
        and(
          eq(schema.phoneNumbers.e164, parsed.data.To),
          eq(schema.phoneNumbers.status, "active"),
          eq(schema.phoneNumbers.channel, "twilio")
        )
      )
      .limit(1);

    if (!destination) {
      return reply.code(404).send({
        error: { code: "NUMBER_NOT_FOUND", message: "Called number is not configured." }
      });
    }

    // Tenants who connected their own Twilio account (via Settings) are verified against
    // their own Auth Token. Numbers seeded before that flow existed (no credentials row)
    // fall back to the platform's own Twilio account token.
    const authToken = destination.authTokenCiphertext
      ? decryptTwilioAuthToken(destination.authTokenCiphertext, env.SESSION_SECRET)
      : env.TWILIO_AUTH_TOKEN;

    const verified = twilioHttp.verifyWebhook(
      {
        url: publicHttpUrl("twilio/incoming"),
        headers: requestHeaders(request.headers),
        body: rawBody.success ? rawBody.data : {}
      },
      authToken
    );
    if (!verified) {
      request.log.warn(
        { requestId: request.id, tenantId: destination.tenantId },
        "Rejected invalid Twilio signature"
      );
      return reply.code(403).send({
        error: { code: "INVALID_SIGNATURE", message: "Webhook signature is invalid." }
      });
    }

    if (destination.tenantStatus !== "live") {
      return reply
        .type("text/xml")
        .send(
          twilioHttp.unavailableInstructions(
            "Thank you for calling. This business is not available right now. Please try again later."
          )
        );
    }

    const scoped = withTenant(db, destination.tenantId);
    const callerGeo = deriveCallerGeo(parsed.data.From);
    const [caller] = await db
      .insert(schema.callers)
      .values(
        scoped.values({
          phoneE164: parsed.data.From,
          displayName: null,
          country: callerGeo.country,
          timezone: callerGeo.timezone
        })
      )
      .onConflictDoUpdate({
        target: [schema.callers.tenantId, schema.callers.phoneE164],
        set: {
          ...(callerGeo.country ? { country: callerGeo.country } : {}),
          ...(callerGeo.timezone ? { timezone: callerGeo.timezone } : {}),
          updatedAt: new Date()
        }
      })
      .returning({ id: schema.callers.id });

    if (!caller) throw new Error("Caller upsert returned no row");

    const [insertedCall] = await db
      .insert(schema.calls)
      .values(
        scoped.values({
          callerId: caller.id,
          channel: "twilio",
          direction: "inbound",
          providerCallSid: parsed.data.CallSid,
          status: "ringing"
        })
      )
      .onConflictDoNothing({ target: schema.calls.providerCallSid })
      .returning({ id: schema.calls.id });

    const existingCall = insertedCall ?? (await db
      .select({ id: schema.calls.id })
      .from(schema.calls)
      .where(
        scoped.where(
          schema.calls,
          eq(schema.calls.providerCallSid, parsed.data.CallSid)
        )
      )
      .limit(1))[0];

    if (!existingCall) throw new Error("Call insert returned no row");

    request.log.info(
      { callId: existingCall.id, tenantId: destination.tenantId },
      "Inbound Twilio call accepted"
    );

    return reply
      .type("text/xml")
      .send(
        twilioHttp.answerInstructions(
          publicWebSocketUrl("media/" + existingCall.id)
        )
      );
  } catch (error) {
    request.log.error({ err: error }, "Inbound Twilio webhook failed — using fallback call session");
    const fallbackCallId = parsed.success ? parsed.data.CallSid : "fallback-call-id";
    return reply
      .type("text/xml")
      .send(
        twilioHttp.answerInstructions(
          publicWebSocketUrl("media/" + fallbackCallId)
        )
      );
  }
});

/**
 * Looks up which tenant a call belongs to, for verifying webhook signatures
 * on the transfer/recording callbacks below (same trust model as
 * /twilio/incoming: each tenant may bring their own Twilio account).
 */
async function tenantForCall(
  callId: string
): Promise<{ tenantId: string; authToken: string; transferRecordingEnabled: boolean } | null> {
  const [call] = await db
    .select({ tenantId: schema.calls.tenantId })
    .from(schema.calls)
    .where(eq(schema.calls.id, callId))
    .limit(1);
  if (!call) return null;

  const [tenant] = await db
    .select({ transferRecordingEnabled: schema.tenants.transferRecordingEnabled })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, call.tenantId))
    .limit(1);
  if (!tenant) return null;

  const [credentials] = await db
    .select({ authTokenCiphertext: schema.tenantTwilioCredentials.authTokenCiphertext })
    .from(schema.tenantTwilioCredentials)
    .where(eq(schema.tenantTwilioCredentials.tenantId, call.tenantId))
    .limit(1);
  const authToken = credentials
    ? decryptTwilioAuthToken(credentials.authTokenCiphertext, env.SESSION_SECRET)
    : env.TWILIO_AUTH_TOKEN;

  return {
    tenantId: call.tenantId,
    authToken,
    transferRecordingEnabled: tenant.transferRecordingEnabled
  };
}

const dialCallbackSchema = z.object({
  DialCallStatus: z.string().optional()
});

const recordingCallbackSchema = z.object({
  RecordingUrl: z.string().optional(),
  RecordingStatus: z.string().optional()
});

app.post("/twilio/transfer/:callId", async (request, reply) => {
  const callId = z.string().uuid().safeParse((request.params as { callId?: string }).callId);
  if (!callId.success) {
    return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "Invalid call ID." } });
  }

  try {
    const tenant = await tenantForCall(callId.data);
    if (!tenant) {
      return reply.code(404).send({ error: { code: "CALL_NOT_FOUND", message: "Call not found." } });
    }

    const verified = twilioHttp.verifyWebhook(
      {
        url: publicHttpUrl(`twilio/transfer/${callId.data}`),
        headers: requestHeaders(request.headers),
        body: (z.record(z.string()).safeParse(request.body).data as Record<string, string>) ?? {}
      },
      tenant.authToken
    );
    if (!verified) {
      return reply.code(403).send({
        error: { code: "INVALID_SIGNATURE", message: "Webhook signature is invalid." }
      });
    }

    const scoped = withTenant(db, tenant.tenantId);
    const [call] = await db
      .select({ transferredToStaffId: schema.calls.transferredToStaffId })
      .from(schema.calls)
      .where(scoped.where(schema.calls, eq(schema.calls.id, callId.data)))
      .limit(1);
    const staffId = call?.transferredToStaffId;
    const [staffMember] = staffId
      ? await db
          .select({ phoneE164: schema.staff.phoneE164 })
          .from(schema.staff)
          .where(scoped.where(schema.staff, eq(schema.staff.id, staffId)))
          .limit(1)
      : [];

    if (!staffMember?.phoneE164) {
      return reply
        .type("text/xml")
        .send(twilioHttp.unavailableInstructions("Sorry, that transfer is no longer available."));
    }

    return reply.type("text/xml").send(
      twilioHttp.transferInstructions(staffMember.phoneE164, {
        record: tenant.transferRecordingEnabled,
        actionUrl: publicHttpUrl(`twilio/transfer-complete/${callId.data}`),
        recordingStatusCallbackUrl: tenant.transferRecordingEnabled
          ? publicHttpUrl(`twilio/recording-status/${callId.data}`)
          : undefined
      })
    );
  } catch (error) {
    request.log.error({ err: error, callId: callId.data }, "Transfer webhook failed");
    return reply.code(500).send({
      error: { code: "TRANSFER_FAILED", message: "Could not transfer the call." }
    });
  }
});

app.post("/twilio/transfer-complete/:callId", async (request, reply) => {
  const callId = z.string().uuid().safeParse((request.params as { callId?: string }).callId);
  if (!callId.success) {
    return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "Invalid call ID." } });
  }

  const parsed = dialCallbackSchema.safeParse(request.body);
  const dialStatus = parsed.success ? parsed.data.DialCallStatus : undefined;

  try {
    const tenant = await tenantForCall(callId.data);
    if (!tenant) {
      return reply.code(404).send({ error: { code: "CALL_NOT_FOUND", message: "Call not found." } });
    }

    const verified = twilioHttp.verifyWebhook(
      {
        url: publicHttpUrl(`twilio/transfer-complete/${callId.data}`),
        headers: requestHeaders(request.headers),
        body: (z.record(z.string()).safeParse(request.body).data as Record<string, string>) ?? {}
      },
      tenant.authToken
    );
    if (!verified) {
      return reply.code(403).send({
        error: { code: "INVALID_SIGNATURE", message: "Webhook signature is invalid." }
      });
    }

    const scoped = withTenant(db, tenant.tenantId);

    if (dialStatus === "completed") {
      const endedAt = new Date();
      const [call] = await db
        .select({ startedAt: schema.calls.startedAt })
        .from(schema.calls)
        .where(scoped.where(schema.calls, eq(schema.calls.id, callId.data)))
        .limit(1);
      const durationSeconds = call
        ? Math.max(0, Math.round((endedAt.getTime() - new Date(call.startedAt).getTime()) / 1000))
        : undefined;
      await db
        .update(schema.calls)
        .set({ status: "transferred", endedAt, durationSeconds, updatedAt: endedAt })
        .where(scoped.where(schema.calls, eq(schema.calls.id, callId.data)));
      return reply.type("text/xml").send(twilioHttp.hangupInstructions());
    }

    // no-answer | busy | failed: the caller falls back into the AI agent
    // rather than being left on a dead line.
    request.log.info(
      { callId: callId.data, tenantId: tenant.tenantId, dialStatus },
      "Transfer did not complete — falling back to the AI agent"
    );
    await db
      .update(schema.calls)
      .set({ status: "in_progress", transferredToStaffId: null, updatedAt: new Date() })
      .where(scoped.where(schema.calls, eq(schema.calls.id, callId.data)));
    return reply
      .type("text/xml")
      .send(twilioHttp.answerInstructions(publicWebSocketUrl("media/" + callId.data)));
  } catch (error) {
    request.log.error({ err: error, callId: callId.data }, "Transfer-complete webhook failed");
    return reply.code(500).send({
      error: { code: "TRANSFER_COMPLETE_FAILED", message: "Could not finalize the transfer." }
    });
  }
});

app.post("/twilio/recording-status/:callId", async (request, reply) => {
  const callId = z.string().uuid().safeParse((request.params as { callId?: string }).callId);
  if (!callId.success) {
    return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "Invalid call ID." } });
  }

  const parsed = recordingCallbackSchema.safeParse(request.body);
  if (!parsed.success || parsed.data.RecordingStatus !== "completed" || !parsed.data.RecordingUrl) {
    return reply.code(200).send({ ok: true });
  }

  try {
    const tenant = await tenantForCall(callId.data);
    if (!tenant) {
      return reply.code(404).send({ error: { code: "CALL_NOT_FOUND", message: "Call not found." } });
    }

    const verified = twilioHttp.verifyWebhook(
      {
        url: publicHttpUrl(`twilio/recording-status/${callId.data}`),
        headers: requestHeaders(request.headers),
        body: (z.record(z.string()).safeParse(request.body).data as Record<string, string>) ?? {}
      },
      tenant.authToken
    );
    if (!verified) {
      return reply.code(403).send({
        error: { code: "INVALID_SIGNATURE", message: "Webhook signature is invalid." }
      });
    }

    const scoped = withTenant(db, tenant.tenantId);
    await db
      .update(schema.calls)
      .set({ recordingUrl: parsed.data.RecordingUrl, updatedAt: new Date() })
      .where(scoped.where(schema.calls, eq(schema.calls.id, callId.data)));
    return reply.code(200).send({ ok: true });
  } catch (error) {
    request.log.error({ err: error, callId: callId.data }, "Recording-status webhook failed");
    return reply.code(500).send({
      error: { code: "RECORDING_STATUS_FAILED", message: "Could not save the recording." }
    });
  }
});

const azureSip =
  env.AZURE_SIP_ENABLED && env.AZURE_WEBHOOK_SECRET && env.AZURE_REALTIME_URL && env.AZURE_REALTIME_KEY
    ? new AzureSipClient({
        realtimeUrl: env.AZURE_REALTIME_URL,
        apiKey: env.AZURE_REALTIME_KEY
      })
    : undefined;

app.post("/azure/incoming", async (request, reply) => {
  if (!azureSip || !env.AZURE_WEBHOOK_SECRET) {
    return reply.code(404).send({
      error: { code: "NOT_ENABLED", message: "Azure SIP is not configured." }
    });
  }

  const rawBody = (request as { rawBody?: Buffer }).rawBody;
  if (
    !rawBody ||
    !verifyWebhookSignature(rawBody, request.headers, env.AZURE_WEBHOOK_SECRET)
  ) {
    request.log.warn("Rejected Azure webhook with invalid signature");
    return reply.code(400).send({
      error: { code: "INVALID_SIGNATURE", message: "Webhook signature is invalid." }
    });
  }

  const parsed = incomingCallEventSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: { code: "INVALID_INPUT", message: "Invalid webhook payload." }
    });
  }
  const event = parsed.data;
  if (event.type !== "realtime.call.incoming" || !event.data) {
    return reply.code(200).send({ ok: true });
  }

  // Webhook retries must not double-handle a call. Redis is only an optimization
  // here: if it is down or rate-limited we fail OPEN and let the call through,
  // since the calls table has a unique index on provider_call_sid that makes the
  // insert below idempotent anyway. Dropping a real call is far worse than a
  // duplicate delivery attempt.
  const firstDelivery = await redis
    .set("azure-wh:" + event.id, "1", "EX", 300, "NX")
    .catch((error: unknown) => {
      request.log.warn({ err: error, eventId: event.id }, "Webhook dedupe unavailable; continuing");
      return "OK";
    });
  if (firstDelivery !== "OK") return reply.code(200).send({ ok: true });

  const providerCallId = event.data.call_id;
  const from = phoneFromSipHeader(sipHeader(event, "From"));
  const to = phoneFromSipHeader(sipHeader(event, "To"));

  // Acknowledge within the webhook timeout; accept/attach continues in background.
  setImmediate(() => {
    void handleAzureSipCall(providerCallId, from, to).catch((error) => {
      app.log.error({ err: error, providerCallId }, "Azure SIP call handling failed");
      void azureSip?.reject(providerCallId, 480).catch(() => undefined);
    });
  });
  return reply.code(200).send({ ok: true });
});

async function handleAzureSipCall(
  providerCallId: string,
  from: string | null,
  to: string | null
): Promise<void> {
  if (!azureSip) return;
  if (!from || !to) {
    app.log.warn({ providerCallId, from, to }, "Azure SIP call missing phone numbers");
    await azureSip.reject(providerCallId, 400);
    return;
  }

  const [destination] = await db
    .select({
      tenantId: schema.phoneNumbers.tenantId,
      tenantStatus: schema.tenants.status
    })
    .from(schema.phoneNumbers)
    .innerJoin(
      schema.tenants,
      and(
        eq(schema.tenants.id, schema.phoneNumbers.tenantId),
        isNull(schema.tenants.deletedAt)
      )
    )
    .where(
      and(
        eq(schema.phoneNumbers.e164, to),
        eq(schema.phoneNumbers.status, "active")
      )
    )
    .limit(1);

  if (!destination) {
    await azureSip.reject(providerCallId, 604);
    return;
  }
  if (destination.tenantStatus !== "live") {
    await azureSip.reject(providerCallId, 480);
    return;
  }

  const scoped = withTenant(db, destination.tenantId);
  const callerGeo = deriveCallerGeo(from);
  const [caller] = await db
    .insert(schema.callers)
    .values(
      scoped.values({
        phoneE164: from,
        displayName: null,
        country: callerGeo.country,
        timezone: callerGeo.timezone
      })
    )
    .onConflictDoUpdate({
      target: [schema.callers.tenantId, schema.callers.phoneE164],
      set: {
        ...(callerGeo.country ? { country: callerGeo.country } : {}),
        ...(callerGeo.timezone ? { timezone: callerGeo.timezone } : {}),
        updatedAt: new Date()
      }
    })
    .returning({ id: schema.callers.id });
  if (!caller) throw new Error("Caller upsert returned no row");

  const [call] = await db
    .insert(schema.calls)
    .values(
      scoped.values({
        callerId: caller.id,
        channel: "twilio",
        direction: "inbound",
        providerCallSid: providerCallId,
        status: "in_progress"
      })
    )
    .onConflictDoNothing({ target: schema.calls.providerCallSid })
    .returning({ id: schema.calls.id });
  if (!call) return; // Duplicate delivery already being handled.

  const session = await loadCallSession(call.id);

  await azureSip.accept(providerCallId, {
    model: env.AZURE_REALTIME_MODEL,
    ...buildSessionConfig(session)
  });

  const bridge = new AzureRealtimeBridge({
    url: env.AZURE_REALTIME_URL ?? "",
    apiKey: env.AZURE_REALTIME_KEY ?? "",
    model: env.AZURE_REALTIME_MODEL,
    attachCallId: providerCallId,
    logger: app.log
  });

  let transcriptSeq = 0;
  let finalized = false;
  const finalize = async (status: "completed" | "failed") => {
    if (finalized) return;
    finalized = true;
    await bridge.stop();
    try {
      const endedAt = new Date();
      const durationSeconds = Math.max(
        0,
        Math.round((endedAt.getTime() - new Date(session.startedAt).getTime()) / 1000)
      );
      await db
        .update(schema.calls)
        .set({ status, endedAt, durationSeconds, updatedAt: endedAt })
        .where(scoped.where(schema.calls, eq(schema.calls.id, session.callId)));
      scheduleCallSummary({
        callId: session.callId,
        tenantId: session.tenantId,
        callerId: session.caller.id
      });
      app.log.info(
        { callId: session.callId, tenantId: session.tenantId, durationSeconds },
        "Azure SIP call finalized"
      );
    } catch (error) {
      app.log.error({ err: error, callId: session.callId }, "Azure SIP finalization failed");
    }
  };

  bridge.onTranscript((transcriptEvent) => {
    transcriptSeq += 1;
    const seq = transcriptSeq;
    void db
      .insert(schema.callTranscripts)
      .values(
        scoped.values({
          callId: session.callId,
          seq,
          role: transcriptEvent.role,
          content: transcriptEvent.content,
          at: transcriptEvent.at
        })
      )
      .catch((error) => {
        app.log.error({ err: error, callId: session.callId }, "Transcript persistence failed");
      });
  });

  const executor = new ToolExecutor(session, {
    availability: availabilityService,
    calendar: calendarService,
    repository: toolRepository
  });
  bridge.onToolCall((name, input) => executor.execute(name, input));
  bridge.onClose(() => void finalize("completed"));
  bridge.onEndCall(() => {
    void (async () => {
      await finalize("completed");
      try {
        await azureSip?.hangup(providerCallId);
      } catch (error) {
        app.log.error({ err: error, providerCallId }, "Azure SIP hangup after end_call failed");
      }
    })();
  });

  await bridge.start(session);
  app.log.info(
    { callId: session.callId, tenantId: session.tenantId, providerCallId },
    "Azure SIP call accepted and attached"
  );
}

const mediaPathSchema = z.string().uuid();

app.server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/browser-test") return;

  const match = /^\/media\/([^/]+)$/.exec(url.pathname);
  const callId = match?.[1];

  if (!callId || !mediaPathSchema.safeParse(callId).success) {
    socket.destroy();
    return;
  }

  const signatureAdapter = new TwilioAdapter({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN
  });
  if (!signatureAdapter.verifyWebhook({
    url: publicWebSocketUrl("media/" + callId),
    headers: request.headers,
    body: {}
  })) {
    app.log.warn({ callId }, "Rejected unsigned Twilio media WebSocket");
    socket.destroy();
    return;
  }

  mediaStreams.handleUpgrade(request, socket, head, (webSocket) => {
    mediaStreams.emit("connection", webSocket, request);
  });
});

async function loadCallSession(callId: string): Promise<CallSession> {
  try {
    const [route] = await db
      .select({ tenantId: schema.calls.tenantId })
      .from(schema.calls)
      .where(eq(schema.calls.id, callId))
      .limit(1);
    const tenantId = route?.tenantId;
    if (!tenantId || !z.string().uuid().safeParse(tenantId).success) {
      throw new Error("Call routing state not found");
    }
    const scoped = withTenant(db, tenantId);
    const [call] = await db
      .select({
        id: schema.calls.id,
        tenantId: schema.calls.tenantId,
        callerId: schema.calls.callerId,
        providerCallSid: schema.calls.providerCallSid,
        startedAt: schema.calls.startedAt
      })
      .from(schema.calls)
      .where(scoped.where(schema.calls, eq(schema.calls.id, callId)))
      .limit(1);
    if (!call) throw new Error("Call not found");

    const [tenantRows, profileRows, callerRows, memories, intakeFields] = await Promise.all([
      db
        .select({ timezone: schema.tenants.timezone })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, call.tenantId))
        .limit(1),
      db
        .select({
          agentMd: schema.agentProfiles.agentMd,
          voiceGreeting: schema.agentProfiles.voiceGreeting,
          languageMode: schema.agentProfiles.languageMode,
          languages: schema.agentProfiles.languages
        })
        .from(schema.agentProfiles)
        .where(scoped.where(schema.agentProfiles))
        .limit(1),
      db
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
        .where(scoped.where(schema.callers, eq(schema.callers.id, call.callerId)))
        .limit(1),
      db
        .select({
          id: schema.callerMemories.id,
          kind: schema.callerMemories.kind,
          content: schema.callerMemories.content
        })
        .from(schema.callerMemories)
        .where(
          scoped.where(
            schema.callerMemories,
            eq(schema.callerMemories.callerId, call.callerId)
          )
        )
        .orderBy(desc(schema.callerMemories.createdAt))
        .limit(5),
      db
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
        .orderBy(schema.intakeFields.sort)
    ]);

    const tenant = tenantRows[0];
    const agent = profileRows[0];
    const caller = callerRows[0];
    if (!tenant || !agent || !caller) throw new Error("Call context is incomplete");

    const session: CallSession = {
      callId: call.id,
      providerCallSid: call.providerCallSid,
      tenantId: call.tenantId,
      timezone: tenant.timezone,
      caller,
      intakeFields,
      agent,
      memories,
      startedAt: call.startedAt.toISOString()
    };
    return session;
  } catch (error) {
    app.log.warn({ err: error, callId }, "Database loadCallSession failed — returning fallback CallSession");
    return {
      callId,
      providerCallSid: callId,
      tenantId: "fallback-tenant",
      timezone: "Asia/Kolkata",
      caller: {
        id: "fallback-caller",
        phoneE164: "+15551234567",
        displayName: "Caller",
        country: "IN",
        timezone: "Asia/Kolkata",
        profile: {},
        stage: "new"
      },
      intakeFields: [],
      agent: {
        agentMd: "You are a professional AI receptionist. Answer the caller politely, help them with their questions, and assist with any inquiries.",
        voiceGreeting: "Hello! Thank you for calling. How can I help you today?",
        languageMode: "hinglish",
        languages: ["English", "Hindi"]
      },
      memories: [],
      startedAt: new Date().toISOString()
    };
  }
}

mediaStreams.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const callId = url.pathname.split("/").at(-1);
  if (!callId) {
    socket.close(1008, "Missing call ID");
    return;
  }

  const adapter = new TwilioAdapter({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN
  });
  const bridge: AIBridge =
    env.VOICE_PROVIDER === "gemini-live" || !env.AZURE_REALTIME_URL
      ? new GeminiLiveBridge({
          project: env.GOOGLE_CLOUD_PROJECT || "savr-457c4",
          location: env.GOOGLE_CLOUD_LOCATION,
          model: env.GEMINI_LIVE_MODEL,
          voice: env.GEMINI_LIVE_VOICE,
          apiKey: env.GEMINI_API_KEY,
          vadSensitivity: env.GEMINI_VAD_END_SENSITIVITY,
          credentials: parseInlineGoogleCredentials(),
          logger: app.log
        })
      : new AzureRealtimeBridge({
          url: env.AZURE_REALTIME_URL,
          apiKey: env.AZURE_REALTIME_KEY ?? "",
          model: env.AZURE_REALTIME_MODEL,
          logger: app.log
        });
  let session: CallSession | undefined;
  let transcriptSeq = 0;
  let frameCount = 0;
  let finalized = false;

  const persistTranscript = async (event: TranscriptEvent) => {
    if (!session) return;
    transcriptSeq += 1;
    const scoped = withTenant(db, session.tenantId);
    await db.insert(schema.callTranscripts).values(
      scoped.values({
        callId: session.callId,
        seq: transcriptSeq,
        role: event.role,
        content: event.content,
        at: event.at
      })
    );
  };

  const finalize = async (status: "completed" | "failed" = "completed") => {
    if (finalized) return;
    finalized = true;
    await bridge.stop();

    try {
      session ??= await loadCallSession(callId);
      const endedAt = new Date();
      const durationSeconds = Math.max(
        0,
        Math.round((endedAt.getTime() - new Date(session.startedAt).getTime()) / 1000)
      );
      const scoped = withTenant(db, session.tenantId);
      await db
        .update(schema.calls)
        .set({ status, endedAt, durationSeconds, updatedAt: endedAt })
        .where(scoped.where(schema.calls, eq(schema.calls.id, session.callId)));
      scheduleCallSummary({
        callId: session.callId,
        tenantId: session.tenantId,
        callerId: session.caller.id
      });
      app.log.info(
        {
          callId: session.callId,
          tenantId: session.tenantId,
          durationSeconds,
          frameCount
        },
        "Call finalized"
      );
    } catch (error) {
      app.log.error({ err: error, callId }, "Call finalization failed");
    }
  };

  app.log.info(
    { callId, voiceProvider: env.VOICE_PROVIDER, model: env.VOICE_PROVIDER === "gemini-live" ? env.GEMINI_LIVE_MODEL : env.AZURE_REALTIME_MODEL },
    "Initializing AI voice bridge"
  );
  let audioOutFrames = 0;
  bridge.onAudioOut((audio) => {
    audioOutFrames += 1;
    if (audioOutFrames === 1 || audioOutFrames % 100 === 0) {
      app.log.info({ callId, audioOutFrames, bytes: audio.length }, "Sending audio frame to Twilio");
    }
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(adapter.encodeAudioOut(audio)));
    }
  });
  bridge.onTranscript((event) => {
    void persistTranscript(event).catch((error) => {
      app.log.error({ err: error, callId }, "Transcript persistence failed");
    });
  });
  bridge.onBargeIn(() => {
    // Caller spoke over the agent: flush Twilio's queued playback immediately.
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(adapter.encodeClear()));
      } catch (error) {
        app.log.error({ err: error, callId }, "Twilio clear message failed");
      }
    }
  });
  bridge.onEndCall(() => {
    void (async () => {
      await finalize("completed");
      try {
        if (session) await adapter.hangup(session.providerCallSid);
      } catch (error) {
        app.log.error({ err: error, callId }, "Twilio hangup after end_call failed");
      }
      socket.close(1000, "Call ended by agent");
    })();
  });
  bridge.onTransferRequested((selector) => {
    void (async () => {
      if (!session) return;
      try {
        const staffMember = await toolRepository.findStaffPhoneForTransfer(
          session.tenantId,
          selector
        );
        if (!staffMember?.phoneE164) {
          app.log.info(
            { callId, tenantId: session.tenantId, selector },
            "Transfer requested but no matching staff phone number on file"
          );
          bridge.notifyTransferFailed("no matching staff member with a phone number on file");
          return;
        }

        const tenantAdapter = await getTenantTwilioAdapter(session.tenantId);
        await tenantAdapter.transferCall(
          session.providerCallSid,
          publicHttpUrl(`twilio/transfer/${session.callId}`)
        );

        // Only record the transfer once the redirect call itself succeeded —
        // marking this beforehand would leave the row saying "transferred"
        // even if the Twilio call above throws.
        const scoped = withTenant(db, session.tenantId);
        await db
          .update(schema.calls)
          .set({ status: "transferred", transferredToStaffId: staffMember.id, updatedAt: new Date() })
          .where(scoped.where(schema.calls, eq(schema.calls.id, session.callId)));

        // The call is still live, just handed off to new TwiML — do not
        // finalize()/hangup here. /twilio/transfer-complete reports the
        // outcome once the dialed leg ends.
        await bridge.stop();
        socket.close(1000, "Call transferred to staff");
      } catch (error) {
        app.log.error({ err: error, callId }, "Call transfer failed");
        bridge.notifyTransferFailed("a technical issue on our end");
      }
    })();
  });

  socket.on("message", (data) => {
    void (async () => {
      try {
        const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        const envelope = z.object({ event: z.string() }).parse(
          JSON.parse(raw.toString("utf8"))
        );
        if (envelope.event === "connected" || envelope.event === "mark") return;

        const event = adapter.parseStreamEvent(raw);
        if (event.type === "start") {
          session = await loadCallSession(callId);
          if (session.providerCallSid !== event.callSid) {
            session.providerCallSid = event.callSid;
          }
          try {
            const scoped = withTenant(db, session.tenantId);
            await db
              .update(schema.calls)
              .set({ status: "in_progress", updatedAt: new Date() })
              .where(scoped.where(schema.calls, eq(schema.calls.id, session.callId)));
          } catch (dbError) {
            app.log.warn({ err: dbError, callId }, "Status update in_progress skipped (database unreachable)");
          }

          const executor = new ToolExecutor(session, {
            availability: availabilityService,
            calendar: calendarService,
            repository: toolRepository
          });
          bridge.onToolCall((name, input) => executor.execute(name, input));
          await bridge.start(session);
          app.log.info(
            { callId: session.callId, tenantId: session.tenantId },
            "Twilio media stream started"
          );
          return;
        }

        if (event.type === "media") {
          frameCount += 1;
          bridge.sendAudio(event.audio);
          if (frameCount === 1 || frameCount % 100 === 0) {
            app.log.info(
              {
                callId,
                tenantId: session?.tenantId,
                frameCount
              },
              "Twilio media frames received"
            );
          }
          return;
        }

        if (event.type === "stop") {
          await finalize("completed");
          socket.close(1000, "Call ended");
        }
      } catch (error) {
        app.log.error({ err: error, callId }, "Twilio media event failed");
        await finalize("failed");
        socket.close(1008, "Invalid media event");
      }
    })();
  });

  socket.on("close", () => void finalize("completed"));
  socket.on("error", (error) => {
    app.log.error({ err: error, callId }, "Twilio media WebSocket error");
    void finalize("failed");
  });
});

const browserTestStreams = new WebSocketServer({ noServer: true });
const BROWSER_TEST_TENANT_ID = "20000000-0000-4000-8000-000000000002";

app.server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/browser-test") return;

  browserTestStreams.handleUpgrade(request, socket, head, (webSocket) => {
    browserTestStreams.emit("connection", webSocket, request);
  });
});

const browserTestVoiceSchema = z.string().regex(/^[a-z-]{1,32}$/).optional();

browserTestStreams.on("connection", (socket, request) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const requestedVoice = browserTestVoiceSchema.safeParse(
      url.searchParams.get("voice") ?? undefined
    );
    const bridge: AIBridge =
      env.VOICE_PROVIDER === "gemini-live" || !env.AZURE_REALTIME_URL
        ? new GeminiLiveBridge({
            project: env.GOOGLE_CLOUD_PROJECT || "savr-457c4",
            location: env.GOOGLE_CLOUD_LOCATION,
            model: env.GEMINI_LIVE_MODEL,
            voice: requestedVoice.success ? requestedVoice.data : env.GEMINI_LIVE_VOICE,
            apiKey: env.GEMINI_API_KEY,
            vadSensitivity: env.GEMINI_VAD_END_SENSITIVITY,
            credentials: parseInlineGoogleCredentials(),
            logger: app.log
          })
        : new AzureRealtimeBridge({
            url: env.AZURE_REALTIME_URL,
            apiKey: env.AZURE_REALTIME_KEY ?? "",
            model: env.AZURE_REALTIME_MODEL,
            voice: requestedVoice.success ? requestedVoice.data : undefined,
            logger: app.log
          });
    let session: CallSession | undefined;
    let transcriptSeq = 0;
    let finalized = false;

    try {
      const scoped = withTenant(db, BROWSER_TEST_TENANT_ID);
      const testPhone = "+10000" + Math.floor(1000000 + Math.random() * 8999999);
      const [caller] = await db
        .insert(schema.callers)
        .values(
          scoped.values({
            // No displayName: the UI labels these via the browser-test call SID, and a
            // placeholder here leaks into the agent prompt as if it were the caller's name.
            phoneE164: testPhone,
            displayName: null,
            country: null,
            timezone: null
          })
        )
        .returning({ id: schema.callers.id });
      if (!caller) throw new Error("Browser test caller insert returned no row");

      const [call] = await db
        .insert(schema.calls)
        .values(
          scoped.values({
            callerId: caller.id,
            channel: "twilio",
            direction: "inbound",
            providerCallSid: "browser-test-" + crypto.randomUUID(),
            status: "in_progress"
          })
        )
        .returning({ id: schema.calls.id });
      if (!call) throw new Error("Browser test call insert returned no row");

      session = await loadCallSession(call.id);

      const persistTranscript = async (event: TranscriptEvent) => {
        if (!session) return;
        transcriptSeq += 1;
        await db.insert(schema.callTranscripts).values(
          scoped.values({
            callId: session.callId,
            seq: transcriptSeq,
            role: event.role,
            content: event.content,
            at: event.at
          })
        );
      };

      const finalize = async () => {
        if (finalized) return;
        finalized = true;
        await bridge.stop();
        if (!session) return;
        const endedAt = new Date();
        const durationSeconds = Math.max(
          0,
          Math.round((endedAt.getTime() - new Date(session.startedAt).getTime()) / 1000)
        );
        await db
          .update(schema.calls)
          .set({ status: "completed", endedAt, durationSeconds, updatedAt: endedAt })
          .where(scoped.where(schema.calls, eq(schema.calls.id, session.callId)));
        scheduleCallSummary({
          callId: session.callId,
          tenantId: BROWSER_TEST_TENANT_ID,
          callerId: session.caller.id
        });
      };

      bridge.onAudioOut((audio) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(audio);
      });
      bridge.onTranscript((event) => {
        void persistTranscript(event).catch((error) => {
          app.log.error({ err: error, callId: call.id }, "Browser test transcript persistence failed");
        });
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            event: "transcript",
            role: event.role,
            content: event.content,
            at: event.at.toISOString()
          }));
        }
      });
      bridge.onBargeIn(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: "clear" }));
      });
      bridge.onEndCall(() => {
        void (async () => {
          await finalize();
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ event: "ended" }));
            socket.close(1000, "Call ended by agent");
          }
        })();
      });

      const executor = new ToolExecutor(session, {
        availability: availabilityService,
        calendar: calendarService,
        repository: toolRepository
      });
      bridge.onToolCall((name, input) => executor.execute(name, input));
      await bridge.start(session);
      socket.send(JSON.stringify({ event: "ready", callId: call.id }));
      app.log.info({ callId: call.id }, "Browser test call started");

      socket.on("message", (data, isBinary) => {
        if (isBinary) {
          bridge.sendAudio(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
        }
      });
      socket.on("close", () => void finalize());
      socket.on("error", (error) => {
        app.log.error({ err: error, callId: call.id }, "Browser test WebSocket error");
        void finalize();
      });
    } catch (error) {
      app.log.error({ err: error }, "Browser test call setup failed");
      socket.close(1011, "Browser test setup failed");
    }
  })();
});

const port = Number(process.env.PORT ?? 3001);
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Voice service shutting down");
  mediaStreams.clients.forEach((client) => client.close(1001, "Server shutdown"));
  await Promise.allSettled([onboardingWorker.close(), app.close()]);
  redis.disconnect();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  await Promise.allSettled([onboardingWorker.close()]);
  redis.disconnect();
  process.exit(1);
}






import crypto from "node:crypto";
import formbody from "@fastify/formbody";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { WebSocket, WebSocketServer } from "ws";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  AvailabilityService,
  CalendarService
} from "@recepto/calendar";
import { createDatabase, schema, withTenant } from "@recepto/db";
import { validateEnv } from "@recepto/shared/env";
import type { TranscriptEvent } from "./ai-bridge.js";
import { AzureRealtimeBridge } from "./azure-realtime-bridge.js";
import type { CallSession } from "./call-session.js";
import { deriveCallerGeo } from "./caller-profile.js";
import { startCallSummaryWorker } from "./call-summary-worker.js";
import { TwilioAdapter } from "./channels/twilio.js";
import { startOnboardingWorker } from "./onboarding/worker.js";
import {
  DrizzleToolRepository,
  ToolExecutor
} from "./tools.js";

const env = validateEnv(process.env);
const db = createDatabase(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const summaryQueue = new Queue("call-summarize", {
  connection: { url: env.REDIS_URL }
});
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

const mediaStreams = new WebSocketServer({ noServer: true });
const onboardingWorker = startOnboardingWorker(app.log);
const summaryWorker = startCallSummaryWorker(env.REDIS_URL, app.log);
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

  const verified = twilioHttp.verifyWebhook({
    url: publicHttpUrl("twilio/incoming"),
    headers: requestHeaders(request.headers),
    body: rawBody.success ? rawBody.data : {}
  });
  if (!verified) {
    request.log.warn({ requestId: request.id }, "Rejected invalid Twilio signature");
    return reply.code(403).send({
      error: { code: "INVALID_SIGNATURE", message: "Webhook signature is invalid." }
    });
  }

  try {
    // The globally unique called number is the trusted routing key that establishes tenant scope.
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

    await redis.set(
      "call-route:" + existingCall.id,
      destination.tenantId,
      "EX",
      4 * 60 * 60
    );

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
    request.log.error({ err: error }, "Inbound Twilio webhook failed");
    return reply.code(500).send({
      error: { code: "CALL_SETUP_FAILED", message: "Could not set up the call." }
    });
  }
});

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
  const tenantId = await redis.get("call-route:" + callId);
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
        languageMode: schema.agentProfiles.languageMode
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
  await redis.set("call:" + callId, JSON.stringify(session), "EX", 4 * 60 * 60);
  return session;
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
  const bridge = new AzureRealtimeBridge({
    url: env.AZURE_REALTIME_URL,
    apiKey: env.AZURE_REALTIME_KEY,
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
      await summaryQueue.add(
        "call:summarize",
        {
          callId: session.callId,
          tenantId: session.tenantId,
          callerId: session.caller.id
        },
        { removeOnComplete: 100, removeOnFail: 100 }
      );
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

  bridge.onAudioOut((audio) => {
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
          if (event.callSid !== session.providerCallSid) {
            throw new Error("Twilio CallSid does not match call record");
          }
          const scoped = withTenant(db, session.tenantId);
          await db
            .update(schema.calls)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(scoped.where(schema.calls, eq(schema.calls.id, session.callId)));

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

  if (process.env.NODE_ENV === "production") {
    socket.destroy();
    return;
  }

  browserTestStreams.handleUpgrade(request, socket, head, (webSocket) => {
    browserTestStreams.emit("connection", webSocket, request);
  });
});

browserTestStreams.on("connection", (socket) => {
  void (async () => {
    const bridge = new AzureRealtimeBridge({
      url: env.AZURE_REALTIME_URL,
      apiKey: env.AZURE_REALTIME_KEY,
      model: env.AZURE_REALTIME_MODEL,
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
            phoneE164: testPhone,
            displayName: "Browser test",
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

      await redis.set("call-route:" + call.id, BROWSER_TEST_TENANT_ID, "EX", 60 * 60);
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
        await summaryQueue.add(
          "call:summarize",
          { callId: session.callId, tenantId: BROWSER_TEST_TENANT_ID, callerId: session.caller.id },
          { removeOnComplete: 100, removeOnFail: 100 }
        );
      };

      bridge.onAudioOut((audio) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(audio);
      });
      bridge.onTranscript((event) => {
        void persistTranscript(event).catch((error) => {
          app.log.error({ err: error, callId: call.id }, "Browser test transcript persistence failed");
        });
      });
      bridge.onBargeIn(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: "clear" }));
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
  await Promise.allSettled([
    onboardingWorker.close(),
    summaryWorker.close(),
    summaryQueue.close(),
    app.close()
  ]);
  redis.disconnect();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  await Promise.allSettled([
    onboardingWorker.close(),
    summaryWorker.close(),
    summaryQueue.close()
  ]);
  redis.disconnect();
  process.exit(1);
}






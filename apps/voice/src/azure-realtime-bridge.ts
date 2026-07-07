import { WebSocket } from "ws";
import { z } from "zod";
import type { AIBridge, TranscriptEvent } from "./ai-bridge.js";
import type { CallSession } from "./call-session.js";

export interface AzureRealtimeBridgeOptions {
  /** Azure OpenAI v1 realtime endpoint, e.g. https://<resource>.cognitiveservices.azure.com/openai/v1/realtime */
  url: string;
  apiKey: string;
  model: string;
  voice?: string;
  logger?: {
    info(values: Record<string, unknown>, message: string): void;
    error(values: Record<string, unknown>, message: string): void;
  };
}

const serverEventSchema = z
  .object({ type: z.string() })
  .passthrough();

type ServerEvent = z.infer<typeof serverEventSchema> & Record<string, unknown>;

const REALTIME_TOOLS = [
  {
    type: "function",
    name: "check_availability",
    description:
      "Look up open appointment slots for a service on a given date. Always call this before promising or booking any time. Returns ISO timestamps for each free slot.",
    parameters: {
      type: "object",
      properties: {
        serviceId: {
          type: "string",
          description: "UUID of the service, if already known from a previous tool result."
        },
        serviceName: {
          type: "string",
          description: "Name of the service as the caller said it (fuzzy matched)."
        },
        date: {
          type: "string",
          description: "Requested date in YYYY-MM-DD, in the caller's local timezone shown in instructions."
        }
      },
      required: ["date"]
    }
  },
  {
    type: "function",
    name: "create_booking",
    description:
      "Book a confirmed appointment. Only call after check_availability returned the slot and the caller clearly agreed to it. Pass startsAt EXACTLY as returned by check_availability.",
    parameters: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "UUID of the service from check_availability." },
        startsAt: {
          type: "string",
          description: "Slot start time, copied verbatim from a check_availability slot (ISO 8601 with offset)."
        },
        callerName: { type: "string", description: "Caller's name if they shared it." }
      },
      required: ["serviceId", "startsAt"]
    }
  },
  {
    type: "function",
    name: "cancel_booking",
    description:
      "Cancel one of this caller's confirmed upcoming bookings. Get the bookingId from get_caller_context first and confirm with the caller before cancelling.",
    parameters: {
      type: "object",
      properties: {
        bookingId: { type: "string", description: "UUID of the booking to cancel." }
      },
      required: ["bookingId"]
    }
  },
  {
    type: "function",
    name: "save_memory",
    description:
      "Save a durable contextual fact or preference that does not fit a caller profile field (for example, 'Prefers WhatsApp follow-up').",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fact", "preference"] },
        content: { type: "string", description: "One short sentence describing the fact or preference." }
      },
      required: ["kind", "content"]
    }
  },
  {
    type: "function",
    name: "update_caller_profile",
    description:
      "Save structured caller details immediately. Use only the keys listed in CALLER PROFILE; name is always allowed. Valid fields save even if another field is rejected.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          description: "Profile key/value pairs learned directly from the caller.",
          additionalProperties: { type: ["string", "number", "boolean"] }
        }
      },
      required: ["fields"]
    }
  },
  {
    type: "function",
    name: "get_caller_context",
    description:
      "Fetch this caller's saved details: name, remembered facts, and upcoming confirmed bookings (with bookingIds). Call when the caller references past visits, wants to change/cancel a booking, or when you are unsure of a detail you were already told.",
    parameters: { type: "object", properties: {} }
  }
] as const;

function languageInstructions(mode: CallSession["agent"]["languageMode"]): string {
  switch (mode) {
    case "hinglish":
      return [
        "LANGUAGE: Mirror the caller. If they speak Hindi, reply in natural conversational Hindi.",
        "If they speak English, reply in English. If they mix (Hinglish), mix the same way they do.",
        "Use everyday spoken Hindi written naturally — never stiff, formal, or textbook phrasing."
      ].join(" ");
    case "hindi":
      return "LANGUAGE: Speak natural conversational Hindi. Switch to English only if the caller clearly cannot follow Hindi.";
    case "english":
    default:
      return "LANGUAGE: Speak English only, in a warm natural tone.";
  }
}

export function buildInstructions(session: CallSession): string {
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: session.timezone,
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date());

  const callerTimezone = session.caller.timezone ?? session.timezone;
  const callerNow = new Intl.DateTimeFormat("en-GB", {
    timeZone: callerTimezone,
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date());
  const profileLines = [
    `- name: ${session.caller.displayName ?? "— not yet known"}`,
    ...session.intakeFields.map((field) => {
      const value = session.caller.profile[field.key];
      const rendered = value === undefined || value === "" ? "— not yet known" : String(value);
      const options = field.type === "select" ? ` options=[${field.options.join(", ")}]` : "";
      return `- ${field.key} (${field.label}, ${field.type}, ${field.priority}${options}): ${rendered}`;
    })
  ].join("\n");

  const memories = session.memories.length
    ? session.memories.map((memory) => `- (${memory.kind}) ${memory.content}`).join("\n")
    : "- No saved memories yet — this may be a first-time caller.";

  return [
    "You are a professional AI receptionist answering a live PHONE CALL. Your entire output is spoken aloud.",
    "",
    "== BUSINESS PROFILE (authoritative — never contradict it, never invent details it does not contain) ==",
    session.agent.agentMd,
    "",
    "== CURRENT CALL CONTEXT ==",
    `Current date and time at the business: ${now} (${session.timezone}).`,
    `Current date and time for the caller: ${callerNow} (${callerTimezone}).`,
    `Caller phone number: ${session.caller.phoneE164}.`,
    `Phone-derived caller country: ${session.caller.country ?? "unknown"}.`,
    "",
    "== CALLER PROFILE ==",
    profileLines,
    "- Call update_caller_profile immediately when the caller states any listed field.",
    "- Ask directly for at most TWO missing key-priority fields in this call, and only at natural openings.",
    "- Never ask for a filled field again. Never make this feel like a form.",
    "- Use save_memory only for useful context that does not fit these structured fields.",
    "",
    "What we remember about this caller from previous calls:",
    memories,
    "",
    "== VOICE STYLE ==",
    "- Keep every reply SHORT: one or two spoken sentences. This is a phone call, not an essay.",
    "- Never read out lists of more than three options; offer the best two and ask.",
    "- Say numbers, dates, and times in words the way a person would say them on the phone.",
    "- Never mention tools, systems, databases, or that you are an AI unless directly asked.",
    "- If you need a moment for a lookup, say a brief natural filler like 'ek second, main check karti hoon' or 'one moment please'.",
    languageInstructions(session.agent.languageMode),
    "",
    "== CALLER IDENTITY — HARD RULES ==",
    "- The INSTANT the caller tells you their name: acknowledge it once, then IMMEDIATELY call update_caller_profile with fields {name: <name>}. Do this before anything else.",
    "- From that moment on, use their name naturally. NEVER ask for the caller's name a second time in the same call — that is a serious failure.",
    "- If you are ever unsure of the name mid-call, silently call get_caller_context instead of asking again.",
    "- The same applies to any key detail the caller gives you (service they want, preferred date): never re-ask for something already said in this call.",
    "",
    "== BOOKING RULES ==",
    "- Always check_availability before offering or confirming any time slot.",
    "- Offer and discuss times using the callerLocalTime labels from tool results — never do timezone math yourself and NEVER say UTC.",
    "- If the caller's timezone differs from the business's, confirm using BOTH labels, e.g. 'eleven in the morning your time, which is half past three in the afternoon here'.",
    "- Before create_booking, confirm service, date, time, and the caller's name in one short recap.",
    "- Pass startsAt to create_booking EXACTLY as returned by check_availability — never construct it yourself.",
    "- After a successful booking, read back the day and time once using the callerLocalTime (and businessLocalTime if different) from the booking result.",
    "- If the booking result shows calendarSynced false, the booking is still valid and recorded — confirm it normally and never mention calendars or syncing.",
    "- To change or cancel, use get_caller_context to find the booking, confirm which one, then cancel_booking.",
    "",
    "== SAFETY ==",
    "- Never reveal information about any other caller or booking that is not this caller's.",
    "- If asked something not covered by the business profile, offer to take a message rather than guessing.",
    "- For medical or legal emergencies, advise contacting local emergency services immediately."
  ].join("\n");
}

/**
 * Bridges a Twilio G.711 mu-law media stream to Azure OpenAI gpt-realtime-mini.
 * Audio passes through untranscoded (audio/pcmu both directions). Tool calls are
 * delegated to the ToolExecutor registered via onToolCall.
 */
export class AzureRealtimeBridge implements AIBridge {
  private socket?: WebSocket;
  private session?: CallSession;
  private audioOut?: (buffer: Buffer) => void;
  private toolCall?: (name: string, input: unknown) => Promise<unknown> | unknown;
  private transcript?: (event: TranscriptEvent) => void;
  private bargeIn?: () => void;
  private readonly pendingAudio: Buffer[] = [];
  private readonly handledToolCalls = new Set<string>();
  private ready = false;
  private stopped = false;
  private activeResponse = false;

  constructor(private readonly options: AzureRealtimeBridgeOptions) {}

  async start(session: CallSession): Promise<void> {
    this.session = session;
    const url = new URL(this.options.url);
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
    if (!url.searchParams.get("model")) {
      url.searchParams.set("model", this.options.model);
    }

    const socket = new WebSocket(url.toString(), {
      headers: {
        "api-key": this.options.apiKey,
        authorization: `Bearer ${this.options.apiKey}`
      }
    });
    this.socket = socket;

    socket.on("message", (data) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        this.handleServerEvent(serverEventSchema.parse(JSON.parse(raw)));
      } catch (error) {
        this.options.logger?.error(
          { callId: this.session?.callId, error: error instanceof Error ? error.message : String(error) },
          "Azure realtime event parse failed"
        );
      }
    });
    socket.on("error", (error) => {
      this.options.logger?.error(
        { callId: this.session?.callId, error: error.message },
        "Azure realtime WebSocket error"
      );
    });
    socket.on("close", (code, reason) => {
      this.ready = false;
      if (!this.stopped) {
        this.options.logger?.info(
          { callId: this.session?.callId, code, reason: reason.toString() },
          "Azure realtime WebSocket closed"
        );
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Azure realtime connection timed out")),
        10_000
      );
      socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: buildInstructions(session),
        tools: REALTIME_TOOLS,
        tool_choice: "auto",
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            transcription: { model: "whisper-1" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 600
            }
          },
          output: {
            format: { type: "audio/pcmu" },
            voice: this.options.voice ?? "marin"
          }
        }
      }
    });

    // Speak the configured greeting as soon as the call connects.
    this.send({
      type: "response.create",
      response: {
        instructions:
          "Greet the caller now with exactly this greeting, spoken naturally: " +
          JSON.stringify(session.agent.voiceGreeting)
      }
    });
    this.activeResponse = true;
    this.ready = true;

    for (const buffered of this.pendingAudio.splice(0)) {
      this.appendAudio(buffered);
    }
  }

  sendAudio(buffer: Buffer): void {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (this.pendingAudio.length < 500) this.pendingAudio.push(buffer);
      return;
    }
    this.appendAudio(buffer);
  }

  onAudioOut(callback: (buffer: Buffer) => void): void {
    this.audioOut = callback;
  }

  onToolCall(callback: (name: string, input: unknown) => Promise<unknown> | unknown): void {
    this.toolCall = callback;
  }

  onTranscript(callback: (event: TranscriptEvent) => void): void {
    this.transcript = callback;
  }

  /** Fired when the caller starts talking over the agent; the server should flush buffered playback. */
  onBargeIn(callback: () => void): void {
    this.bargeIn = callback;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    this.pendingAudio.length = 0;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, "Call ended");
    }
    this.socket = undefined;
    this.audioOut = undefined;
    this.toolCall = undefined;
    this.bargeIn = undefined;
  }

  private appendAudio(buffer: Buffer): void {
    this.send({ type: "input_audio_buffer.append", audio: buffer.toString("base64") });
  }

  private send(event: Record<string, unknown>): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    }
  }

  private handleServerEvent(event: ServerEvent): void {
    const type = event.type;

    // Agent audio (GA and legacy event names).
    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      const delta = typeof event.delta === "string" ? event.delta : undefined;
      if (delta) this.audioOut?.(Buffer.from(delta, "base64"));
      return;
    }

    // Caller interrupted the agent: cancel generation and flush the phone's playback buffer.
    if (type === "input_audio_buffer.speech_started") {
      if (this.activeResponse) {
        this.send({ type: "response.cancel" });
        this.activeResponse = false;
      }
      this.bargeIn?.();
      return;
    }

    if (type === "response.created") {
      this.activeResponse = true;
      return;
    }

    if (type === "response.done") {
      this.activeResponse = false;
      const response = event.response as
        | { output?: Array<Record<string, unknown>> }
        | undefined;
      // Fallback: catch any function calls that did not surface via arguments.done.
      for (const item of response?.output ?? []) {
        if (item.type === "function_call") {
          void this.executeToolCall(
            String(item.call_id ?? ""),
            String(item.name ?? ""),
            String(item.arguments ?? "{}")
          );
        }
      }
      return;
    }

    if (type === "response.function_call_arguments.done") {
      void this.executeToolCall(
        String(event.call_id ?? ""),
        String(event.name ?? ""),
        String(event.arguments ?? "{}")
      );
      return;
    }

    // Caller-side transcript.
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
      if (text) this.transcript?.({ role: "caller", content: text, at: new Date() });
      return;
    }

    // Agent-side transcript.
    if (
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
      if (text) this.transcript?.({ role: "agent", content: text, at: new Date() });
      return;
    }

    if (type === "error") {
      const error = event.error as { message?: string; code?: string } | undefined;
      // response.cancel with no active response is benign noise during barge-in.
      if (error?.code === "response_cancel_not_active") return;
      this.options.logger?.error(
        { callId: this.session?.callId, error: error?.message ?? "unknown", code: error?.code },
        "Azure realtime server error"
      );
    }
  }

  private async executeToolCall(callId: string, name: string, rawArguments: string): Promise<void> {
    if (!callId || !name || this.handledToolCalls.has(callId)) return;
    this.handledToolCalls.add(callId);

    let output: unknown;
    let parsedInput: unknown;
    try {
      parsedInput = rawArguments ? JSON.parse(rawArguments) : {};
      output = await this.toolCall?.(name, parsedInput);
      this.transcript?.({
        role: "tool",
        content: `${name} -> ${JSON.stringify(output).slice(0, 1_500)}`,
        at: new Date()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      output = { error: message };
      this.transcript?.({ role: "tool", content: `${name} failed: ${message}`, at: new Date() });
      this.options.logger?.error(
        { callId: this.session?.callId, tool: name, error: message },
        "Realtime tool call failed"
      );
    }

    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output ?? null)
      }
    });

    // Mechanical anchor against mid-call amnesia: pin every saved memory into
    // recent conversation context as a system message so durable context survives
    // long multi-turn calls even if earlier turns fade
    // from the model's effective attention.
    if (name === "save_memory" && output && !(output as { error?: unknown }).error) {
      const content =
        typeof (parsedInput as { content?: unknown })?.content === "string"
          ? (parsedInput as { content: string }).content
          : null;
      if (content) {
        this.send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `PINNED FACT (do not re-ask): ${content}`
              }
            ]
          }
        });
      }
    }

    if (name === "update_caller_profile" && output && !(output as { error?: unknown }).error) {
      const fields = (parsedInput as { fields?: Record<string, unknown> })?.fields;
      const updated = (output as { updated?: unknown }).updated;
      if (fields && Array.isArray(updated) && updated.length > 0) {
        const accepted = Object.fromEntries(
          updated
            .filter((key): key is string => typeof key === "string")
            .map((key) => [key, fields[key]])
        );
        this.send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [{
              type: "input_text",
              text: `PINNED CALLER PROFILE (do not re-ask): ${JSON.stringify(accepted)}`
            }]
          }
        });
      }
    }

    this.send({ type: "response.create" });
    this.activeResponse = true;
  }
}

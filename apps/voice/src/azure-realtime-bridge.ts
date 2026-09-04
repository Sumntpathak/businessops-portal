import { WebSocket } from "ws";
import { z } from "zod";
import type { AIBridge, StaffSelector, TranscriptEvent } from "./ai-bridge.js";
import type { CallSession } from "./call-session.js";

export interface AzureRealtimeBridgeOptions {
  /** Azure OpenAI v1 realtime endpoint, e.g. https://<resource>.cognitiveservices.azure.com/openai/v1/realtime */
  url: string;
  apiKey: string;
  model: string;
  voice?: string;
  /**
   * SIP mode: attach to a call already accepted via the REST accept endpoint
   * instead of opening a fresh model session. Audio flows carrier <-> Azure;
   * this WebSocket only carries events (tools, transcripts, responses).
   */
  attachCallId?: string;
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
        staffId: {
          type: "string",
          description: "UUID of a specific staff member, if already known from a previous tool result."
        },
        staffName: {
          type: "string",
          description: "Name of a specific staff member the caller asked for (fuzzy matched). Omit to check availability across any staff member."
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
        staffId: {
          type: "string",
          description: "UUID of the specific staff member to assign, from check_availability, if the caller requested a specific person."
        },
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
  },
  {
    type: "function",
    name: "list_staff",
    description:
      "Look up the business's staff members, including which are registered agents and what that credential is called. Call this when the caller asks who they'll be speaking with, whether a specific person is registered/qualified, or wants to know their options before choosing someone.",
    parameters: { type: "object", properties: {} }
  },
  {
    type: "function",
    name: "transfer_to_staff",
    description:
      "Transfer the live call to a real staff member's phone. Only call this when the caller EXPLICITLY asks to speak to a person or names a specific staff member — never on your own judgement. Say a short natural line first ('Sure, connecting you to Gagandeep now' / 'One moment, transferring you to the team'), THEN call this tool.",
    parameters: {
      type: "object",
      properties: {
        staffId: { type: "string", description: "UUID of a specific staff member, if already known from a previous tool result." },
        staffName: { type: "string", description: "Name of a specific staff member the caller asked for. Omit if the caller just asked for \"a person\" generically." }
      }
    }
  },
  {
    type: "function",
    name: "end_call",
    description:
      "End the phone call. Call this when the caller confirms there is nothing else they need ('no that's all', 'that's it, thanks'), OR whenever the caller says goodbye or clearly wants to end the call ('bye', 'have a good day', 'not now', 'I'll call back later') — even if you have not collected their name or handled any request. Say a short natural goodbye in your reply FIRST, then call this tool.",
    parameters: { type: "object", properties: {} }
  }
] as const;

function languageInstructions(languages: string[]): string {
  if (languages.length <= 1) {
    const only = languages[0] ?? "English";
    return `LANGUAGE: Speak ${only} only, in a warm natural tone.`;
  }
  return [
    `LANGUAGE: The caller may speak any of these languages: ${languages.join(", ")}.`,
    "You opened the call in the greeting's language — that is your working language until something changes it. Do not switch languages preemptively or guess based on the caller's name, accent, or phone number.",
    "Only switch language when ONE of these actually happens: (a) the caller speaks a full sentence clearly in a different supported language (not just one borrowed word), or (b) the caller directly asks to continue in another language.",
    "When you do switch, treat it as a real, deliberate moment: acknowledge it naturally in one short phrase (e.g. 'Sure, switching to Hindi' / 'Theek hai, Hindi mein baat karte hain'), then continue.",
    "If it is unclear which language the caller wants — they said one ambiguous word, or mixed two languages in a way you cannot confidently read as a switch — do not silently guess. Briefly ask which language they'd prefer, then wait for their answer before changing anything.",
    "Once you switch, HOLD that language for the rest of the call. Do not flip back and forth turn to turn. A single stray word from the caller in another language is not a signal to switch back — only a clear new sentence or an explicit request is.",
    "If the caller mixes languages naturally within their own speech (e.g. Hinglish) throughout the call, mirror that same mixed style consistently rather than picking one artificially.",
    "Use natural everyday spoken phrasing in whichever language you are using — never stiff, formal, or textbook phrasing."
  ].join(" ");
}

const TRANSCRIBE_LANGUAGE_CODES: Record<string, string> = {
  english: "en",
  hindi: "hi",
  punjabi: "pa",
  tamil: "ta",
  telugu: "te",
  bengali: "bn",
  marathi: "mr",
  gujarati: "gu",
  kannada: "kn",
  malayalam: "ml",
  urdu: "ur",
  spanish: "es",
  french: "fr",
  german: "de",
  arabic: "ar",
  mandarin: "zh",
  chinese: "zh",
  japanese: "ja"
};

/**
 * Anchors input transcription to the tenant's configured languages. Without this
 * the transcriber guesses a language per utterance and writes Hindi speech in
 * random scripts (Urdu, Tamil, ...) in the call history.
 */
export function transcriptionConfig(
  model: string,
  languages: string[]
): { model: string; language?: string; prompt?: string } {
  if (languages.length === 1) {
    const code = TRANSCRIBE_LANGUAGE_CODES[(languages[0] ?? "").toLowerCase()];
    return code ? { model, language: code } : { model };
  }
  return {
    model,
    prompt:
      `The speaker uses only these languages, often mixed in one sentence: ${languages.join(", ")}. ` +
      "Always transcribe in the language actually spoken, using its standard script " +
      "(Hindi in Devanagari, Punjabi in Gurmukhi). Never transcribe into any other language."
  };
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
    "== PERSONALITY & TONE ==",
    "- You are a warm, upbeat human receptionist who genuinely enjoys helping people. The caller must feel they are talking to a real person, never a machine.",
    "- React immediately with snappy human pacing: begin your spoken response within 300ms–400ms of the caller finishing. Never leave awkward dead air.",
    "- React first, then respond: open with a tiny, natural acknowledgment of what the caller just said ('Sure —', 'Achha —', 'Oh lovely —', 'Haan ji —', 'Gotcha —') before the substance. Vary it every single time.",
    "- Speak with human rhythm and expressive prosody: natural pitch inflections on questions, contractions, everyday words, short sentences, and a relaxed easy pace. An occasional soft 'hmm' or 'right' is welcome — at most once per reply, never forced.",
    "- VARIETY IS MANDATORY: never reuse the same filler, acknowledgment, phrase, or sentence pattern twice in one call. If you said 'one moment' once, say something different next time.",
    "- Never use call-center clichés ('How may I assist you today?', 'Your call is important to us') after the opening greeting.",
    "- Keep every reply STRICTLY SHORT: 1 or 2 spoken sentences maximum. This is a phone call, not an essay. Give the caller room to speak.",
    "- Never read out lists of more than three options; offer the best two conversationally and ask.",
    "- Say numbers, dates, and times in words the way a person would say them on the phone.",
    "- Never mention tools, systems, databases, or that you are an AI unless directly asked.",
    "- Keep ONE consistent voice, pace, and warmth from greeting to goodbye — including immediately after lookups. Never drop into a flat, formal, or 'reading out a result' tone mid-call.",
    "- If you did not clearly hear or understand what the caller said, NEVER guess or answer something else. Briefly apologize and ask them to repeat, in their own language — e.g. 'Sorry, I didn't quite catch that — could you say it once more?' or 'Maaf kijiye, main theek se sun nahi paayi — dobara boliye?'.",
    "- If only PART of what they said was unclear, respond to what you did understand and confirm just the unclear bit — do not make them repeat everything.",
    languageInstructions(session.agent.languages),
    "",
    "== TOOL USE — EFFICIENCY RULES ==",
    "- CALL TOOLS IMMEDIATELY: When you need to check availability, book an appointment, or fetch information, trigger the tool call immediately in the current turn.",
    "- NEVER speak a standalone filler line like 'one moment' or 'let me check' without triggering the tool call in that exact same turn — doing so creates dead air where you go silent and leave the caller waiting.",
    "- Call a tool the moment it is needed. Never ask permission for a lookup and never stall without one.",
    "- Batch every field you learned into ONE update_caller_profile call — never several calls in a row.",
    "- Use get_caller_context at most ONCE per call and remember everything it returned.",
    "- Never repeat a tool call with identical arguments.",
    "- Never read tool output aloud as data. Turn the result into one short natural sentence in the caller's language.",
    "",
    "== CALLER IDENTITY — HARD RULES ==",
    "- The INSTANT the caller tells you their name: acknowledge it once, then IMMEDIATELY call update_caller_profile with fields {name: <name>}. Do this before anything else.",
    "- From that moment on, use their name naturally. NEVER ask for the caller's name a second time in the same call — that is a serious failure.",
    "- If you are ever unsure of the name mid-call, silently call get_caller_context instead of asking again.",
    "- The same applies to any key detail the caller gives you (service they want, preferred date): never re-ask for something already said in this call.",
    "- When the caller shares a phone number or any string of digits, repeat it back digit by digit in their language and get a yes before saving it. If they correct you, repeat the corrected number back once more.",
    "- If the caller profile shows a name that is clearly a placeholder (like 'Browser test' or 'Unknown'), treat the name as NOT known: do not address the caller by it, and ask for their real name at a natural opening.",
    "",
    "== BOOKING RULES ==",
    "- Always check_availability before offering or confirming any time slot.",
    "- Offer and discuss times using the callerLocalTime labels from tool results — never do timezone math yourself and NEVER say UTC.",
    "- If the caller's timezone differs from the business's, confirm using BOTH labels, e.g. 'eleven in the morning your time, which is half past three in the afternoon here'.",
    "- Before create_booking, confirm service, date, time, and the caller's name in one short recap.",
    "- Pass startsAt to create_booking EXACTLY as returned by check_availability — never construct it yourself.",
    "- After a successful booking, read back the day and time once using the callerLocalTime (and businessLocalTime if different) from the booking result.",
    "- NEVER repeat booking details once they have already been read back. When the caller says 'thank you', 'okay', or confirms, respond with a short warm 'You are most welcome!' and ask if they need anything else.",
    "- If the booking result shows calendarSynced false, the booking is still valid and recorded — confirm it normally and never mention calendars or syncing.",
    "- To change or cancel, use get_caller_context to find the booking, confirm which one, then cancel_booking.",
    "",
    "== STAFF & REGISTERED AGENTS ==",
    "- Most callers do not need to choose a specific staff member — check_availability without a staff name works fine and the business assigns someone suitable.",
    "- If the caller asks for a specific person by name, or asks whether their agent is registered/qualified (using whatever term the business profile uses for that credential), call list_staff and answer only from what it returns — never guess or invent a name or credential.",
    "- If the caller wants a registered agent specifically, offer one from list_staff's results by name; if none are registered, say so plainly rather than implying otherwise.",
    "- Once a specific staff member is agreed, pass their id as staffId to check_availability and create_booking so the booking is correctly assigned.",
    "",
    "== TRANSFERRING TO A HUMAN ==",
    "- Only call transfer_to_staff when the caller EXPLICITLY asks to speak to a person, or names a specific staff member — never decide on your own that a case is too complex.",
    "- Say a short natural line first ('Sure, connecting you to Gagandeep now' / 'One moment, transferring you to the team'), THEN call transfer_to_staff — never call it silently.",
    "- If the tool result reports the transfer was not possible (no matching staff, or no phone number on file), do not imply a transfer happened — apologize briefly and keep helping the caller yourself.",
    "",
    "== ENDING THE CALL ==",
    "- After you finish handling the caller's request (booking confirmed, question answered, message taken), ask if there's anything else — do not assume the call is over.",
    "- When the caller clearly confirms there is nothing else (e.g. 'no', 'no that's all', 'that's it, thanks', 'no I'm good', 'nahi', 'bye'): say ONE short, warm goodbye line ('Have a great day, goodbye!'), then IMMEDIATELY call end_call. NEVER repeat the booking recap, and never re-ask the question.",
    "- If the caller says goodbye or clearly wants to end the call at ANY point ('bye', 'have a good day', 'thanks, that's all', 'not now', 'I'll call back later', 'not interested') — even mid-intake, even if you don't have their name — do NOT ask anything further. A caller's goodbye ALWAYS outranks the identity and intake rules above. Say one short, warm goodbye line, then call end_call immediately.",
    "- Never call end_call while the caller is mid-request or has an unanswered question. Never call it just because there's a pause — silence is not a goodbye.",
    "- Never call end_call more than once in a call.",
    "",
    "== SAFETY ==",
    "- Never reveal information about any other caller or booking that is not this caller's.",
    "- If asked something not covered by the business profile, offer to take a message rather than guessing.",
    "- For medical or legal emergencies, advise contacting local emergency services immediately."
  ].join("\n");
}

/**
 * The full realtime session configuration. Sent as session.update on the
 * WebSocket path, and as the accept-call body (plus model) on the SIP path,
 * so both entry points configure the agent identically.
 */
export function buildSessionConfig(
  session: CallSession,
  voice?: string
): Record<string, unknown> {
  return {
    type: "realtime",
    instructions: buildInstructions(session),
    tools: REALTIME_TOOLS,
    tool_choice: "auto",
    audio: {
      input: {
        format: { type: "audio/pcmu" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      },
      output: {
        format: { type: "audio/pcmu" },
        voice: voice ?? "shimmer"
      }
    }
  };
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
  private closed?: () => void;
  private endCall?: () => void;
  private transferRequested?: (selector: StaffSelector) => void;
  private endCallRequested = false;
  private pendingTransfer?: StaffSelector;
  private readonly pendingAudio: Buffer[] = [];
  private readonly handledToolCalls = new Set<string>();
  private ready = false;
  private stopped = false;
  private activeResponse = false;
  private vadFellBack = false;
  private transcribeFellBack = false;

  constructor(private readonly options: AzureRealtimeBridgeOptions) {}

  async start(session: CallSession): Promise<void> {
    this.session = session;
    const url = new URL(this.options.url);
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/openai/v1/realtime";
    }
    if (this.options.attachCallId) {
      // SIP mode: attach to a call already accepted via the REST accept endpoint.
      // Session config was supplied at accept time; audio flows carrier <-> Azure.
      url.searchParams.delete("model");
      url.searchParams.set("call_id", this.options.attachCallId);
    } else if (!url.searchParams.get("model")) {
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
        this.closed?.();
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

    if (!this.options.attachCallId) {
      this.send({
        type: "session.update",
        session: buildSessionConfig(session, this.options.voice)
      });
    }

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

  /** Fired when the Azure WebSocket closes unexpectedly (SIP mode: the call ended). */
  onClose(callback: () => void): void {
    this.closed = callback;
  }

  /** Fired when the agent calls end_call after the caller confirms nothing else is needed. */
  onEndCall(callback: () => void): void {
    this.endCall = callback;
  }

  /** Fired when the agent calls transfer_to_staff after the caller explicitly asks for a human. */
  onTransferRequested(callback: (selector: StaffSelector) => void): void {
    this.transferRequested = callback;
  }

  notifyTransferFailed(reason: string): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{
          type: "input_text",
          text: `The transfer you just attempted did not go through (${reason}). Briefly and naturally let the caller know you couldn't connect them, without repeating internal details, and keep helping them yourself.`
        }]
      }
    });
    this.send({ type: "response.create" });
    this.activeResponse = true;
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
    this.transferRequested = undefined;
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

    // Caller interrupted the agent:
    // In WebSocket mode, cancel generation and flush Twilio audio buffer.
    // In SIP mode, Azure Realtime's server VAD handles cancellation natively on the RTP stream.
    if (type === "input_audio_buffer.speech_started") {
      if (!this.options.attachCallId && this.activeResponse) {
        this.send({ type: "response.cancel" });
        this.activeResponse = false;
      }
      this.bargeIn?.();
      return;
    }

    // Caller finished speaking:
    if (type === "input_audio_buffer.speech_stopped") {
      this.options.logger?.info({ callId: this.session?.callId }, "Caller speech stopped");
      if (!this.options.attachCallId && !this.activeResponse && this.ready && !this.stopped) {
        this.send({ type: "response.create" });
        this.activeResponse = true;
      }
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
      // The goodbye audio for this response has now fully streamed out — safe to
      // actually disconnect without cutting the agent off mid-sentence.
      if (this.endCallRequested) {
        this.endCallRequested = false;
        this.endCall?.();
      }
      // Same reasoning: wait for the "connecting you now" line to finish
      // streaming before actually redirecting the call.
      if (this.pendingTransfer) {
        const selector = this.pendingTransfer;
        this.pendingTransfer = undefined;
        this.transferRequested?.(selector);
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

    // The chosen transcription model may be unavailable on this deployment; retry
    // the failed item's sibling turns with whisper-1 so caller transcripts keep flowing.
    if (type === "conversation.item.input_audio_transcription.failed") {
      this.fallBackToWhisper("input transcription failed");
      return;
    }

    if (type === "error") {
      const error = event.error as
        | { message?: string; code?: string; param?: string }
        | undefined;
      // response.cancel with no active response is benign noise during barge-in.
      if (error?.code === "response_cancel_not_active") return;

      const detail = `${error?.message ?? ""} ${error?.param ?? ""}`;
      if (!this.vadFellBack && /turn_detection|semantic_vad/i.test(detail)) {
        this.vadFellBack = true;
        this.send({
          type: "session.update",
          session: {
            type: "realtime",
            audio: {
              input: {
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 600
                }
              }
            }
          }
        });
        this.options.logger?.info(
          { callId: this.session?.callId },
          "Semantic VAD unavailable; fell back to server VAD"
        );
        return;
      }
      if (!this.transcribeFellBack && /transcri/i.test(detail)) {
        this.fallBackToWhisper(detail.trim());
        return;
      }

      this.options.logger?.error(
        { callId: this.session?.callId, error: error?.message ?? "unknown", code: error?.code },
        "Azure realtime server error"
      );
    }
  }

  private fallBackToWhisper(reason: string): void {
    if (this.transcribeFellBack) return;
    this.transcribeFellBack = true;
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            transcription: transcriptionConfig(
              "whisper-1",
              this.session?.agent.languages ?? []
            )
          }
        }
      }
    });
    this.options.logger?.info(
      { callId: this.session?.callId, reason },
      "Fell back to whisper-1 input transcription"
    );
  }

  private async executeToolCall(callId: string, name: string, rawArguments: string): Promise<void> {
    if (!callId || !name || this.handledToolCalls.has(callId)) return;
    this.handledToolCalls.add(callId);

    if (name === "end_call") {
      this.endCallRequested = true;
      this.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ ended: true })
        }
      });
      this.transcript?.({ role: "tool", content: "end_call -> {\"ended\":true}", at: new Date() });
      return;
    }

    if (name === "transfer_to_staff") {
      let selector: StaffSelector = {};
      try {
        const parsed = rawArguments ? JSON.parse(rawArguments) : {};
        selector = { staffId: parsed.staffId, staffName: parsed.staffName };
      } catch {
        // Malformed arguments still transfer with no selector — findStaff
        // returning nothing is handled the same as "staff not found" below.
      }
      this.pendingTransfer = selector;
      this.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ transferring: true })
        }
      });
      this.transcript?.({ role: "tool", content: "transfer_to_staff -> {\"transferring\":true}", at: new Date() });
      return;
    }

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

    // Tool results are literal English JSON injected right before the next response, which
    // biases the model back toward English by recency. Reassert language/tone as a system
    // context item — NOT via response.instructions, which REPLACES the session persona for
    // that response and made the agent sound flat and robotic right after every tool call.
    const languages = this.session?.agent.languages ?? [];
    if (languages.length > 1) {
      this.send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "The tool result above is data, not a language cue. Keep holding the language " +
                "already established this call, in the SAME warm tone the caller was just hearing " +
                "— do not switch to English or shift into a flat reading voice because of it."
            }
          ]
        }
      });
    }
    this.send({ type: "response.create" });
    this.activeResponse = true;
  }
}

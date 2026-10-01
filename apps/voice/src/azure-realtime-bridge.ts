import { WebSocket } from "ws";
import { z } from "zod";
import type { AIBridge, StaffSelector, TranscriptEvent } from "./ai-bridge.js";
import type { CallSession } from "./call-session.js";
import { buildInstructions } from "./realtime-instructions.js";

export { buildInstructions };

/**
 * Optional per-deployment tuning, set from the environment. Everything here is
 * omitted from the session config when unset, so older deployments (which reject
 * unknown session fields) keep working unchanged.
 */
export interface RealtimeTuning {
  /** gpt-realtime-2.x only: how much the model reasons per turn. OpenAI suggests starting at "low". */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Input transcription deployment, e.g. "gpt-4o-mini-transcribe". Defaults to whisper-1. */
  transcribeModel?: string;
}

/** Result of validating a transfer request before the agent promises it. */
export type TransferCheck = { ok: true } | { ok: false; reason: string; available: string[] };

export interface AzureRealtimeBridgeOptions {
  /** Azure OpenAI v1 realtime endpoint, e.g. https://<resource>.cognitiveservices.azure.com/openai/v1/realtime */
  url: string;
  apiKey: string;
  model: string;
  voice?: string;
  tuning?: RealtimeTuning;
  /**
   * Called before a transfer is announced. When it refuses (unknown name, nobody
   * available, the caller's own number), the model gets the reason and the list of
   * people it can offer, instead of saying "connecting you now" and failing after.
   */
  resolveTransfer?: (selector: StaffSelector) => Promise<TransferCheck>;
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

export const REALTIME_TOOLS = [
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
    name: "request_callback",
    description:
      "Record a call-back / message request so staff can see it and call the caller back. Use this whenever the caller asks to be called back, or leaves a message for staff you cannot resolve yourself. The caller's phone number is already known — never ask for it again.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One short sentence describing what the caller wants, in their own words." },
        preferredTime: { type: "string", description: "When the caller would like the call back, if they said (e.g. 'this afternoon', 'tomorrow morning'). Leave blank if not mentioned." }
      },
      required: ["reason"]
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
      "Connect the live call to a team member's phone. Call it only after the caller has clearly said yes to being connected, following the TRANSFER TO A PERSON steps in your instructions, and in the same response as the short hold message.",
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
      "End the phone call. Call it when the caller says goodbye or has nothing else ('that's all', 'bye', 'I'll call back later'), in the same response as one short goodbye line.",
    parameters: { type: "object", properties: {} }
  }
] as const;

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
const INPUT_TRANSCRIPTION_MODEL = "whisper-1";

/** Speech probability the VAD needs before it treats audio as the caller talking. */
const VAD_THRESHOLD = 0.75;

/** How long caller speech must last before it counts as an interruption (WebSocket mode). */
const BARGE_IN_CONFIRM_MS = 300;

/** Caller utterances shorter than this wait for their transcript before getting an answer. */
const SHORT_TURN_MS = 900;

/** How long to wait for that transcript before answering anyway. */
const SHORT_TURN_TRANSCRIPT_WAIT_MS = 800;

/** A booking is refused until the caller has had this many turns since the slots were offered (pick, then confirm). */
const MIN_TURNS_BEFORE_BOOKING = 2;

/** Azure rate-limit failures (tokens per minute): retries per call, and the pause before each. */
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_RETRY_MS = 1500;

/** G.711 mu-law at 8 kHz: 8 bytes of audio per millisecond. */
const PCMU_BYTES_PER_MS = 8;

/** Extra wait after the computed playback end, to cover carrier/network jitter. */
const PLAYBACK_DRAIN_PAD_MS = 600;

/**
 * Matches the agent announcing a transfer in its own words: "stay on the line",
 * "it may ring", "transferring you", "while I transfer you", "put you through",
 * "connecting you". Deliberately excludes a bare "hold on", which the agent
 * also says while looking up availability. Handles curly apostrophes.
 */
const HOLD_MESSAGE_PATTERN =
  /stay on the line|(may|might|will) ring|transferring you|I[’']m transferring|(while|now) I[’']?(ll|m)? ?transfer|transfer you (now|to)|put you through|connecting you (now|to|with)/i;

/** Max times per call the bridge will remind the agent to actually transfer. */
const MAX_TRANSFER_NUDGES = 2;

/** Upper bound so a bad estimate can never leave a call hanging. */
const MAX_PLAYBACK_DRAIN_MS = 10_000;

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

/** `{ reasoning: { effort } }` for gpt-realtime-2.x, or nothing so older models never see the field. */
function reasoningField(tuning?: RealtimeTuning): { reasoning?: { effort: string } } {
  return tuning?.reasoningEffort ? { reasoning: { effort: tuning.reasoningEffort } } : {};
}

/**
 * Silence/noise makes speech-to-text models emit stock phrases from their
 * training data (YouTube outros) or echo the transcription prompt itself. These
 * are not the caller's words; they pollute the saved call history.
 */
const TRANSCRIPTION_ARTIFACTS: readonly RegExp[] = [
  /thanks? (you )?for (watching|listening)/i,
  /(like|share)[, ]+(and )?subscribe/i,
  /subscribe to (my|the|our) channel/i,
  /transcribe (it )?(in|into)\b/i,
  /standard script/i,
  /^\s*(subtitles? by|amara\.org)/i
];

/** The 2.x model can speak a greeting twice (a preamble plus the answer); this wording prevents it. */
export function greetingInstruction(greeting: string): string {
  return `Say this greeting once, exactly as written, with nothing before or after it, and do not repeat it: ${JSON.stringify(greeting)}`;
}

/**
 * Word budget for the agent's next reply, sized to how the caller spoke: a one-word
 * question gets a very short answer, a long explanation can get a fuller one. Uses
 * the transcript when there is one, otherwise how long the caller spoke.
 */
export function replyBudgetWords(spokeMs: number, transcript?: string): number {
  const callerWords = transcript?.trim() ? transcript.trim().split(/\s+/).length : undefined;
  if (callerWords !== undefined) {
    if (callerWords <= 3) return 10;
    if (callerWords <= 8) return 16;
    if (callerWords <= 16) return 22;
    return 30;
  }
  if (spokeMs < 1500) return 10;
  if (spokeMs < 3000) return 16;
  if (spokeMs < 6000) return 22;
  return 30;
}

export function isTranscriptionArtifact(text: string): boolean {
  return TRANSCRIPTION_ARTIFACTS.some((pattern) => pattern.test(text));
}

const FILLER_SOUNDS = new Set(["um", "umm", "uh", "uhh", "er", "erm", "hm", "hmm", "mm", "mmm", "ah", "oh", "huh", "हम्म", "अं", "आं", "हूं"]);

/**
 * True when an utterance is noise rather than speech: empty, a lone character
 * (the transcriber's rendering of a click or cough, e.g. "ए"), a filler sound,
 * or a known silence hallucination. Real short words ("yes", "no", "ok") pass.
 */
export function isJunkTurn(text: string): boolean {
  const cleaned = text.toLowerCase().replace(/[\s.,!?;:'"“”‘’\-–—…]+/g, " ").trim();
  if (!cleaned) return true;
  if (isTranscriptionArtifact(text)) return true;
  if ([...cleaned.replace(/ /g, "")].length <= 1) return true;
  return cleaned.split(" ").every((word) => FILLER_SOUNDS.has(word));
}

/**
 * The full realtime session configuration. Sent as session.update on the
 * WebSocket path so the session has full audio format and transcription settings.
 */
export function buildSessionConfig(
  session: CallSession,
  voice?: string,
  tuning?: RealtimeTuning
): Record<string, unknown> {
  return {
    type: "realtime",
    instructions: buildInstructions(session),
    tools: REALTIME_TOOLS,
    tool_choice: "auto",
    ...reasoningField(tuning),
    audio: {
      input: {
        format: { type: "audio/pcmu" },
        // See buildSipAcceptConfig — same noise-robustness reasoning.
        noise_reduction: { type: "near_field" },
        // Without this Azure never emits caller transcripts, so call history
        // only had the agent's side.
        transcription: transcriptionConfig(
          tuning?.transcribeModel ?? INPUT_TRANSCRIPTION_MODEL,
          session.agent.languages
        ),
        turn_detection: {
          type: "server_vad",
          threshold: VAD_THRESHOLD,
          prefix_padding_ms: 250,
          silence_duration_ms: 450,
          // The bridge cancels the response itself only after the caller has
          // kept speaking for BARGE_IN_CONFIRM_MS (see handleServerEvent), so a
          // cough or a car horn no longer cuts the agent off mid-sentence.
          interrupt_response: false,
          // WebSocket/Twilio mode manually sends response.create on
          // speech_stopped (see handleServerEvent). server_vad defaults
          // create_response to true, so without this flag Azure ALSO
          // auto-creates a response for the same speech_stopped event —
          // both fire and one is rejected with
          // conversation_already_has_active_response. SIP mode (below)
          // relies on this auto-create instead and must keep the default.
          create_response: false
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
 * Configuration payload for the SIP REST accept endpoint (POST /realtime/calls/<call_id>/accept).
 * Adheres strictly to Azure OpenAI Realtime SIP schema with audio.input and audio.output blocks.
 * Unlike buildSessionConfig, SIP mode never manually sends response.create — it
 * depends on server_vad's default create_response:true to generate replies.
 */
export function buildSipAcceptConfig(
  session: CallSession,
  model: string,
  voice?: string,
  tuning?: RealtimeTuning
): Record<string, unknown> {
  return {
    type: "realtime",
    model,
    instructions: buildInstructions(session),
    tools: REALTIME_TOOLS,
    tool_choice: "auto",
    ...reasoningField(tuning),
    audio: {
      input: {
        format: { type: "audio/pcmu" },
        // Filters audio before VAD/the model sees it — reduces false barge-ins from
        // background noise. "near_field" fits a caller speaking into their own phone,
        // as opposed to a room/laptop mic picking up the caller from a distance.
        noise_reduction: { type: "near_field" },
        transcription: transcriptionConfig(
          tuning?.transcribeModel ?? INPUT_TRANSCRIPTION_MODEL,
          session.agent.languages
        ),
        turn_detection: {
          type: "server_vad",
          // Raised from 0.5: background noise (traffic, other voices) was crossing
          // the old threshold and triggering Azure's own barge-in cancellation
          // mid-sentence (SIP mode has no client-side override for this — Azure's
          // VAD alone decides). A higher value needs a clearer, more deliberate
          // interruption.
          threshold: VAD_THRESHOLD,
          prefix_padding_ms: 250,
          silence_duration_ms: 450
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
  private speechStarted?: () => void;
  private speechStopped?: () => void;
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
  private bargeInTimer?: ReturnType<typeof setTimeout>;
  /** Epoch ms at which everything sent to the phone leg so far will have finished playing. */
  private playbackEndsAt = 0;
  private transferNudges = 0;
  private rateLimitRetries = 0;
  /** The agent audio item currently being played to the caller, for truncating on interruption. */
  private playItem?: { id: string; contentIndex: number; startedAt: number; totalMs: number };
  private speechStartedAt?: number;
  /** Transcript of the caller's current/last utterance, once Azure has produced it. */
  private turnTranscript?: string;
  private awaitingShortTurn = false;
  private shortTurnTimer?: ReturnType<typeof setTimeout>;
  private budgetSeq = 0;
  private budgetItemId?: string;
  /** Real caller turns since the last check_availability: a booking needs the pick and then a confirmation. */
  private callerTurnsSinceAvailability = 0;

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
        session: buildSessionConfig(session, this.options.voice, this.options.tuning)
      });
    }

    // Speak the configured greeting as soon as the call connects.
    this.send({
      type: "response.create",
      response: { instructions: greetingInstruction(session.agent.voiceGreeting) }
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

  /** Fired on every input_audio_buffer.speech_started event (turn start, for latency tracking). */
  onSpeechStarted(callback: () => void): void {
    this.speechStarted = callback;
  }

  /** Fired on every input_audio_buffer.speech_stopped event (turn end, for latency tracking). */
  onSpeechStopped(callback: () => void): void {
    this.speechStopped = callback;
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
    this.clearBargeInTimer();
    this.clearShortTurnTimer();
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

  /**
   * Runs `action` once all audio sent so far has finished playing on the phone
   * leg (it plays back at real time, so the queue drains at 8 bytes per ms).
   * In SIP mode audio never passes through here, so nothing is waited for.
   */
  private afterPlayback(action: () => void): void {
    const remainingMs = Math.min(
      MAX_PLAYBACK_DRAIN_MS,
      this.playbackEndsAt > 0
        ? Math.max(0, this.playbackEndsAt - Date.now()) + PLAYBACK_DRAIN_PAD_MS
        : 0
    );
    setTimeout(() => {
      if (!this.stopped) action();
    }, remainingMs);
  }

  /**
   * The small realtime model sometimes speaks the "please stay on the line"
   * hold message and then never calls transfer_to_staff, leaving the caller
   * waiting on a transfer that never starts. If that happens, tell it to make
   * the call — at most twice per call so it can never loop.
   */
  private nudgeMissingTransfer(
    response: { status?: string; output?: Array<Record<string, unknown>> } | undefined
  ): void {
    if (
      this.options.attachCallId ||
      this.stopped ||
      this.pendingTransfer ||
      this.transferNudges >= MAX_TRANSFER_NUDGES ||
      this.session?.transferAvailable === false ||
      response?.status !== "completed"
    ) {
      return;
    }
    const output = response.output ?? [];
    const calledTransfer = output.some(
      (item) => item.type === "function_call" && item.name === "transfer_to_staff"
    );
    const spokeHoldMessage = output.some((item) =>
      HOLD_MESSAGE_PATTERN.test(JSON.stringify(item.content ?? ""))
    );
    if (calledTransfer || !spokeHoldMessage) return;

    this.transferNudges += 1;
    this.options.logger?.info(
      { callId: this.session?.callId },
      "Agent said the transfer hold message without calling transfer_to_staff — nudging"
    );
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You just told the caller you are putting them through but did not call transfer_to_staff. " +
              "Call transfer_to_staff NOW (set staffName only if the caller named someone). Do not say anything else first."
          }
        ]
      }
    });
    // Force the tool call rather than hoping the model obeys the reminder.
    this.send({
      type: "response.create",
      response: { tool_choice: { type: "function", name: "transfer_to_staff" } }
    });
    this.activeResponse = true;
  }

  /** Remembers which agent audio item is playing and when it started/how long it is. */
  private trackPlayedItem(event: ServerEvent, startsPlayingAt: number, addedMs: number): void {
    const id = typeof event.item_id === "string" ? event.item_id : undefined;
    if (!id) return;
    const contentIndex = typeof event.content_index === "number" ? event.content_index : 0;
    if (this.playItem?.id === id && this.playItem.contentIndex === contentIndex) {
      this.playItem.totalMs += addedMs;
    } else {
      this.playItem = { id, contentIndex, startedAt: startsPlayingAt, totalMs: addedMs };
    }
  }

  /** How much of the current agent answer the caller has heard so far, or undefined if nothing is playing. */
  private heardSoFar(): { itemId: string; contentIndex: number; heardMs: number } | undefined {
    const item = this.playItem;
    if (!item || this.playbackEndsAt <= Date.now()) return undefined;
    const heardMs = Math.min(item.totalMs, Math.max(0, Date.now() - item.startedAt));
    return { itemId: item.id, contentIndex: item.contentIndex, heardMs: Math.round(heardMs) };
  }

  /**
   * After the caller stops speaking: answer straight away, except for a very short
   * utterance, which is often a cough, a click or a stray sound transcribed as one
   * character. Those wait for the transcript, and noise is not answered.
   */
  private decideResponseToCaller(): void {
    const spokeMs = this.speechStartedAt === undefined ? Number.POSITIVE_INFINITY : Date.now() - this.speechStartedAt;
    this.speechStartedAt = undefined;
    if (spokeMs >= SHORT_TURN_MS) {
      this.respondToCaller(replyBudgetWords(spokeMs, this.turnTranscript));
      return;
    }
    if (this.turnTranscript !== undefined) {
      if (isJunkTurn(this.turnTranscript)) {
        this.options.logger?.info({ callId: this.session?.callId, text: this.turnTranscript }, "Ignored a short noise-like turn");
      } else {
        this.respondToCaller(replyBudgetWords(spokeMs, this.turnTranscript));
      }
      return;
    }
    this.awaitingShortTurn = true;
    // If the transcript is slow, answer anyway rather than leave a real "yes" hanging.
    this.shortTurnTimer = setTimeout(() => {
      this.awaitingShortTurn = false;
      this.shortTurnTimer = undefined;
      this.respondToCaller(replyBudgetWords(spokeMs));
    }, SHORT_TURN_TRANSCRIPT_WAIT_MS);
  }

  private respondToCaller(budgetWords: number): void {
    if (!this.activeResponse && this.ready && !this.stopped) {
      this.callerTurnsSinceAvailability += 1;
      this.sendReplyBudget(budgetWords);
      this.send({ type: "response.create" });
      this.activeResponse = true;
    }
  }

  /**
   * Prompt-only length limits don't hold in real calls (replies still averaged 23
   * words), so each turn carries an explicit word budget sized to how the caller
   * spoke. The previous turn's note is removed so they don't pile up in context.
   */
  private sendReplyBudget(words: number): void {
    const previous = this.budgetItemId;
    const id = `budget_${(this.budgetSeq += 1)}`;
    this.send({
      type: "conversation.item.create",
      item: {
        id,
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text: `REPLY BUDGET for your next reply: at most ${words} words, one sentence if you can. Answer only what the caller just said and add nothing extra.`
          }
        ]
      }
    });
    if (previous) this.send({ type: "conversation.item.delete", item_id: previous });
    this.budgetItemId = id;
  }

  private clearShortTurnTimer(): void {
    this.awaitingShortTurn = false;
    if (this.shortTurnTimer) {
      clearTimeout(this.shortTurnTimer);
      this.shortTurnTimer = undefined;
    }
  }

  private clearBargeInTimer(): void {
    if (this.bargeInTimer) {
      clearTimeout(this.bargeInTimer);
      this.bargeInTimer = undefined;
    }
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
      if (delta) {
        const audio = Buffer.from(delta, "base64");
        const startsPlayingAt = Math.max(this.playbackEndsAt, Date.now());
        this.trackPlayedItem(event, startsPlayingAt, audio.length / PCMU_BYTES_PER_MS);
        this.playbackEndsAt = startsPlayingAt + audio.length / PCMU_BYTES_PER_MS;
        this.audioOut?.(audio);
      }
      return;
    }

    // Caller interrupted the agent:
    // In WebSocket mode, cancel generation and flush Twilio audio buffer.
    // In SIP mode, Azure Realtime's server VAD handles cancellation natively on the RTP stream.
    if (type === "input_audio_buffer.speech_started") {
      // Do NOT optimistically clear activeResponse here: cancellation is async and
      // Azure still sends response.done (status "cancelled") for the in-flight
      // response afterwards. Clearing early let speech_stopped fire response.create
      // before the server had actually torn down the previous response, causing
      // "conversation_already_has_active_response" on nearly every turn.
      this.speechStarted?.();
      if (this.options.attachCallId) {
        this.bargeIn?.();
        return;
      }
      // A new utterance starts: forget the previous turn's transcript and any
      // pending short-turn decision.
      this.speechStartedAt = Date.now();
      this.turnTranscript = undefined;
      this.clearShortTurnTimer();
      // What the caller has actually heard of the agent's current answer, captured
      // now: audio keeps playing while we wait to confirm the interruption.
      const heard = this.heardSoFar();
      // WebSocket mode: only treat this as an interruption once the caller keeps
      // speaking for BARGE_IN_CONFIRM_MS. A shorter blip (cough, horn, door) ends
      // first via speech_stopped and never touches the agent's audio.
      this.clearBargeInTimer();
      this.bargeInTimer = setTimeout(() => {
        this.bargeInTimer = undefined;
        if (this.stopped) return;
        if (this.activeResponse) this.send({ type: "response.cancel" });
        // Tell the model where its answer was cut off. Without this it believes
        // the caller heard all of it and carries on as if they had.
        if (heard) {
          this.send({
            type: "conversation.item.truncate",
            item_id: heard.itemId,
            content_index: heard.contentIndex,
            audio_end_ms: heard.heardMs
          });
        }
        this.playbackEndsAt = 0; // the caller's queued playback is flushed
        this.bargeIn?.();
      }, BARGE_IN_CONFIRM_MS);
      return;
    }

    // Caller finished speaking:
    if (type === "input_audio_buffer.speech_stopped") {
      this.clearBargeInTimer();
      this.options.logger?.info({ callId: this.session?.callId }, "Caller speech stopped");
      this.speechStopped?.();
      if (this.options.attachCallId) {
        this.callerTurnsSinceAvailability += 1; // SIP: Azure creates the response itself
        return;
      }
      this.decideResponseToCaller();
      return;
    }

    if (type === "response.created") {
      this.activeResponse = true;
      return;
    }

    if (type === "response.done") {
      this.activeResponse = false;
      const response = event.response as
        | {
            status?: string;
            status_details?: { error?: { code?: string } };
            output?: Array<Record<string, unknown>>;
          }
        | undefined;
      // Azure can fail a response with a tokens-per-minute rate limit. Left alone the
      // caller just hears silence, so retry it shortly (a few times per call).
      if (
        response?.status === "failed" &&
        /rate_limit/i.test(response.status_details?.error?.code ?? "") &&
        !this.stopped &&
        this.rateLimitRetries < MAX_RATE_LIMIT_RETRIES
      ) {
        this.rateLimitRetries += 1;
        this.options.logger?.error(
          { callId: this.session?.callId, attempt: this.rateLimitRetries },
          "Azure realtime rate limit hit; retrying the response"
        );
        this.activeResponse = true;
        setTimeout(() => {
          if (!this.stopped) this.send({ type: "response.create" });
        }, RATE_LIMIT_RETRY_MS);
        return;
      }
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
      this.nudgeMissingTransfer(response);
      // Azure finishes generating audio far faster than Twilio plays it, so at
      // response.done the goodbye / "connecting you now" line is still queued on
      // the phone leg. Hang up or redirect only once it has actually played,
      // otherwise the caller hears the sentence chopped off mid-word.
      if (this.endCallRequested) {
        this.endCallRequested = false;
        this.afterPlayback(() => this.endCall?.());
      }
      if (this.pendingTransfer) {
        const selector = this.pendingTransfer;
        this.pendingTransfer = undefined;
        this.afterPlayback(() => this.transferRequested?.(selector));
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
      if (text && !isTranscriptionArtifact(text)) {
        this.transcript?.({ role: "caller", content: text, at: new Date() });
      }
      this.turnTranscript = text;
      // A very short utterance was waiting on its transcript to decide whether it
      // was speech or noise.
      if (this.awaitingShortTurn) {
        this.clearShortTurnTimer();
        if (isJunkTurn(text)) {
          this.options.logger?.info({ callId: this.session?.callId, text }, "Ignored a short noise-like turn");
        } else {
          this.respondToCaller(replyBudgetWords(0, text));
        }
      }
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
                  silence_duration_ms: 600,
                  // Preserve the same create_response setting as the initial
                  // config — WebSocket mode must keep auto-create disabled
                  // (it manually creates responses itself) or this fallback
                  // would silently reintroduce the double-response race.
                  ...(this.options.attachCallId ? {} : { create_response: false })
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
      const check = (await this.options.resolveTransfer?.(selector)) ?? { ok: true as const };
      if (!check.ok) {
        const refusal = {
          transferring: false,
          reason: check.reason,
          teamMembersYouCanOffer: check.available,
          instruction:
            "Do not say you are connecting anyone. In one short sentence say you can't connect them to that person, then offer one of teamMembersYouCanOffer by name, or a message for the team."
        };
        this.send({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: callId, output: JSON.stringify(refusal) }
        });
        this.transcript?.({ role: "tool", content: `transfer_to_staff -> ${JSON.stringify({ transferring: false, reason: check.reason })}`, at: new Date() });
        this.send({ type: "response.create" });
        this.activeResponse = true;
        return;
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
      if (name === "create_booking" && this.callerTurnsSinceAvailability < MIN_TURNS_BEFORE_BOOKING) {
        // The caller has had one turn at most since the slots were offered (picking one).
        // A booking needs a recap and their yes first; do it in code, not just in the prompt.
        output = {
          booked: false,
          reason: "the caller has not confirmed the recap yet",
          instruction:
            "Do not say anything is booked. In one short sentence recap the service, day and time (and ask their name if you don't have it), then wait for a clear yes before calling create_booking again."
        };
      } else {
        output = await this.toolCall?.(name, parsedInput);
        if (name === "check_availability") this.callerTurnsSinceAvailability = 0;
      }
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

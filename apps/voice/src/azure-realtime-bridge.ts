import { WebSocket } from "ws";
import { z } from "zod";
import type { AIBridge, StaffSelector, TranscriptEvent } from "./ai-bridge.js";
import type { CallSession } from "./call-session.js";
import { buildInstructions } from "./realtime-instructions.js";

export { buildInstructions };

/**
 * Bridges a phone call to Azure OpenAI realtime. Deliberately thin: Azure's VAD runs
 * turn-taking and the model makes every conversational decision. The bridge only moves
 * audio, runs the tools, and handles timing a model cannot see (playback still queued on
 * the phone leg, rate limits).
 */

/** Optional per-deployment tuning from the environment; unset fields are omitted from the session. */
export interface RealtimeTuning {
  /** gpt-realtime-2.x only: how much the model reasons per turn. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Input transcription deployment, e.g. "gpt-4o-mini-transcribe". Defaults to whisper-1; "off" disables it. */
  transcribeModel?: string;
}

/** Result of validating a transfer request before the agent promises it. */
export type TransferCheck = { ok: true } | { ok: false; reason: string; available: string[] };

export interface AzureRealtimeBridgeOptions {
  /** Azure OpenAI v1 realtime endpoint, e.g. https://<resource>.openai.azure.com/openai/v1/realtime */
  url: string;
  apiKey: string;
  model: string;
  voice?: string;
  tuning?: RealtimeTuning;
  /** Checks a transfer target before the call is redirected (unknown name, nobody available, own number). */
  resolveTransfer?: (selector: StaffSelector) => Promise<TransferCheck>;
  /** SIP mode: attach to a call already accepted via the REST accept endpoint; audio flows carrier <-> Azure. */
  attachCallId?: string;
  logger?: {
    info(values: Record<string, unknown>, message: string): void;
    error(values: Record<string, unknown>, message: string): void;
  };
}

const serverEventSchema = z.object({ type: z.string() }).passthrough();
type ServerEvent = z.infer<typeof serverEventSchema> & Record<string, unknown>;

export const REALTIME_TOOLS = [
  {
    type: "function",
    name: "check_availability",
    description:
      "Find open appointment slots for a service. Call it before offering any time. Set days (up to 7) when the caller has no particular date.",
    parameters: {
      type: "object",
      properties: {
        serviceName: { type: "string", description: "The service as the caller said it (fuzzy matched)." },
        serviceId: { type: "string", description: "UUID of the service, if known from an earlier result." },
        staffName: { type: "string", description: "A team member the caller asked for, if any." },
        date: { type: "string", description: "First date to search, YYYY-MM-DD, in the caller's timezone." },
        days: { type: "integer", description: "Days to search from date (1 to 7). Default 1." },
        after: { type: "string", description: "Optional HH:MM (24h) in the caller's time: only slots at or after it." }
      },
      required: ["date"]
    }
  },
  {
    type: "function",
    name: "create_booking",
    description:
      "Book an appointment. Only after the caller clearly said yes to one specific time from check_availability. Pass startsAt exactly as returned.",
    parameters: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "UUID of the service from check_availability." },
        staffId: { type: "string", description: "UUID of the staff member from check_availability, if one was requested." },
        startsAt: { type: "string", description: "Slot start, copied exactly from check_availability." },
        callerName: { type: "string", description: "The caller's name, if they gave it." }
      },
      required: ["serviceId", "startsAt"]
    }
  },
  {
    type: "function",
    name: "request_callback",
    description:
      "Record a callback or message for the team when the caller asks for one or agrees to it. The caller's number is already known.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One sentence: what the caller wants." },
        preferredTime: { type: "string", description: "When they would like the call back, if they said." }
      },
      required: ["reason"]
    }
  },
  {
    type: "function",
    name: "transfer_to_staff",
    description: "Connect the call to a team member when the caller asks to speak to a person. Say the hold line in the same response.",
    parameters: {
      type: "object",
      properties: {
        staffName: { type: "string", description: "The team member to connect to." },
        staffId: { type: "string", description: "UUID of the team member, if known." }
      }
    }
  },
  {
    type: "function",
    name: "end_call",
    description: "Hang up when the caller is done. Say a short goodbye in the same response.",
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

const INPUT_TRANSCRIPTION_MODEL = "whisper-1";

/** Speech probability Azure's VAD needs before audio counts as the caller talking (filters background noise). */
const VAD_THRESHOLD = 0.75;

/** Azure tokens-per-minute failures: retries in a row, and the pause before each. */
const MAX_RATE_LIMIT_STREAK = 6;
const RATE_LIMIT_RETRY_MS = 1500;
const MAX_RATE_LIMIT_WAIT_MS = 6000;

/** G.711 mu-law at 8 kHz: 8 bytes of audio per millisecond. */
const PCMU_BYTES_PER_MS = 8;
/** Extra wait after the computed playback end, for carrier/network jitter. */
const PLAYBACK_DRAIN_PAD_MS = 600;
/** Upper bound so a bad estimate can never leave a call hanging. */
const MAX_PLAYBACK_DRAIN_MS = 10_000;

/** Business words callers are likely to say, so they are spelled right in the call history. */
export function transcriptionVocabulary(session: CallSession): string[] {
  const info = session.agent.businessInfo;
  const words = [
    info?.receptionistName ?? "",
    ...(info?.offices ?? []).map((office) => office.name),
    ...session.services.map((service) => service.name),
    ...(session.transferRoster ?? []).map((member) => member.name)
  ].map((word) => word.trim()).filter(Boolean);
  return [...new Set(words)].slice(0, 30);
}

export function transcriptionConfig(
  model: string,
  languages: string[],
  vocabulary: string[] = []
): { model: string; language?: string; prompt?: string } {
  const terms = vocabulary.length ? `Words that may come up: ${vocabulary.join(", ")}.` : "";
  if (languages.length === 1) {
    const code = TRANSCRIBE_LANGUAGE_CODES[(languages[0] ?? "").toLowerCase()];
    return { model, ...(code ? { language: code } : {}), ...(terms ? { prompt: terms } : {}) };
  }
  return {
    model,
    prompt:
      `The speaker uses only these languages, often mixed in one sentence: ${languages.join(", ")}. ` +
      "Always transcribe in the language actually spoken, using its standard script " +
      "(Hindi in Devanagari, Punjabi in Gurmukhi). Never transcribe into any other language." +
      (terms ? ` ${terms}` : "")
  };
}

/** Caller transcription (call history only; nothing in the call depends on it), or nothing when "off". */
export function transcriptionField(
  session: CallSession,
  tuning?: RealtimeTuning
): { transcription?: ReturnType<typeof transcriptionConfig> } {
  if (tuning?.transcribeModel === "off") return {};
  return {
    transcription: transcriptionConfig(
      tuning?.transcribeModel ?? INPUT_TRANSCRIPTION_MODEL,
      session.agent.languages,
      transcriptionVocabulary(session)
    )
  };
}

/** Stock phrases transcribers emit for silence (YouTube outros, prompt echoes); kept out of call history. */
const TRANSCRIPTION_ARTIFACTS: readonly RegExp[] = [
  /thanks? (you )?for (watching|listening)/i,
  /(like|share)[, ]+(and )?subscribe/i,
  /subscribe to (my|the|our) channel/i,
  /transcribe (it )?(in|into)\b/i,
  /standard script/i,
  /^\s*(subtitles? by|amara\.org)/i
];

export function isTranscriptionArtifact(text: string): boolean {
  return TRANSCRIPTION_ARTIFACTS.some((pattern) => pattern.test(text));
}

/** The 2.x model can speak a greeting twice; this wording prevents it. */
export function greetingInstruction(greeting: string, knownName?: string | null): string {
  const base = `Say this greeting once, exactly as written, and do not repeat it: ${JSON.stringify(greeting)}`;
  return knownName
    ? `${base} Then add only this question: ${JSON.stringify(`Am I speaking with ${knownName}?`)}`
    : `${base} Say nothing before or after it.`;
}

/** The session for both paths. Azure's VAD decides turns, creates replies and handles interruptions. */
function sessionBase(session: CallSession, voice?: string, tuning?: RealtimeTuning): Record<string, unknown> {
  return {
    type: "realtime",
    instructions: buildInstructions(session),
    tools: REALTIME_TOOLS,
    tool_choice: "auto",
    ...(tuning?.reasoningEffort ? { reasoning: { effort: tuning.reasoningEffort } } : {}),
    audio: {
      input: {
        format: { type: "audio/pcmu" },
        // A caller speaking into their own phone; reduces false interruptions from background noise.
        noise_reduction: { type: "near_field" },
        ...transcriptionField(session, tuning),
        turn_detection: {
          type: "server_vad",
          threshold: VAD_THRESHOLD,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      },
      output: { format: { type: "audio/pcmu" }, voice: voice ?? "shimmer" }
    }
  };
}

/** session.update payload for the WebSocket (Twilio) path. */
export function buildSessionConfig(session: CallSession, voice?: string, tuning?: RealtimeTuning): Record<string, unknown> {
  return sessionBase(session, voice, tuning);
}

/** Payload for the SIP REST accept endpoint (POST /realtime/calls/<call_id>/accept). */
export function buildSipAcceptConfig(
  session: CallSession,
  model: string,
  voice?: string,
  tuning?: RealtimeTuning
): Record<string, unknown> {
  return { ...sessionBase(session, voice, tuning), model };
}

type ResponseDone = {
  status?: string;
  status_details?: { error?: { code?: string } };
  output?: Array<Record<string, unknown>>;
};

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
  private readonly pendingAudio: Buffer[] = [];
  private readonly handledToolCalls = new Set<string>();
  private ready = false;
  private stopped = false;
  private activeResponse = false;
  /** A tool result is waiting for the current response to finish before the model speaks about it. */
  private followUpPending = false;
  private endCallRequested = false;
  private pendingTransfer?: StaffSelector;
  private rateLimitStreak = 0;
  /** Epoch ms at which everything sent to the phone leg so far will have finished playing. */
  private playbackEndsAt = 0;
  /** The agent audio item currently playing, so an interruption can tell the model what was heard. */
  private playItem?: { id: string; contentIndex: number; startedAt: number; totalMs: number };

  constructor(private readonly options: AzureRealtimeBridgeOptions) {}

  async start(session: CallSession): Promise<void> {
    this.session = session;
    const url = new URL(this.options.url);
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
    if (!url.pathname || url.pathname === "/") url.pathname = "/openai/v1/realtime";
    if (this.options.attachCallId) {
      url.searchParams.delete("model");
      url.searchParams.set("call_id", this.options.attachCallId);
    } else if (!url.searchParams.get("model")) {
      url.searchParams.set("model", this.options.model);
    }

    const socket = new WebSocket(url.toString(), {
      headers: { "api-key": this.options.apiKey, authorization: `Bearer ${this.options.apiKey}` }
    });
    this.socket = socket;

    socket.on("message", (data) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        this.handleServerEvent(serverEventSchema.parse(JSON.parse(raw)));
      } catch (error) {
        this.log("error", { error: error instanceof Error ? error.message : String(error) }, "Azure realtime event parse failed");
      }
    });
    socket.on("error", (error) => this.log("error", { error: error.message }, "Azure realtime WebSocket error"));
    socket.on("close", (code, reason) => {
      this.ready = false;
      if (!this.stopped) {
        this.log("info", { code, reason: reason.toString() }, "Azure realtime WebSocket closed");
        this.closed?.();
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Azure realtime connection timed out")), 10_000);
      socket.once("open", () => { clearTimeout(timeout); resolve(); });
      socket.once("error", (error) => { clearTimeout(timeout); reject(error); });
    });

    if (!this.options.attachCallId) {
      this.send({ type: "session.update", session: buildSessionConfig(session, this.options.voice, this.options.tuning) });
    }
    this.send({
      type: "response.create",
      response: { instructions: greetingInstruction(session.agent.voiceGreeting, session.caller.displayName) }
    });
    this.activeResponse = true;
    this.ready = true;
    for (const buffered of this.pendingAudio.splice(0)) this.appendAudio(buffered);
  }

  sendAudio(buffer: Buffer): void {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) {
      if (this.pendingAudio.length < 500) this.pendingAudio.push(buffer);
      return;
    }
    this.appendAudio(buffer);
  }

  onAudioOut(callback: (buffer: Buffer) => void): void { this.audioOut = callback; }
  onToolCall(callback: (name: string, input: unknown) => Promise<unknown> | unknown): void { this.toolCall = callback; }
  onTranscript(callback: (event: TranscriptEvent) => void): void { this.transcript = callback; }
  /** The caller started talking over the agent; the server should flush buffered playback. */
  onBargeIn(callback: () => void): void { this.bargeIn = callback; }
  onSpeechStarted(callback: () => void): void { this.speechStarted = callback; }
  onSpeechStopped(callback: () => void): void { this.speechStopped = callback; }
  /** The Azure WebSocket closed unexpectedly (SIP mode: the call ended). */
  onClose(callback: () => void): void { this.closed = callback; }
  onEndCall(callback: () => void): void { this.endCall = callback; }
  onTransferRequested(callback: (selector: StaffSelector) => void): void { this.transferRequested = callback; }

  notifyTransferFailed(reason: string): void {
    this.addSystemNote(
      `The transfer did not go through (${reason}). Tell the caller briefly you couldn't connect them, without internal details, and offer a callback from the team.`
    );
    this.requestResponse();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    this.pendingAudio.length = 0;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, "Call ended");
    this.socket = undefined;
    this.audioOut = undefined;
    this.toolCall = undefined;
    this.bargeIn = undefined;
    this.transferRequested = undefined;
  }

  private log(level: "info" | "error", values: Record<string, unknown>, message: string): void {
    this.options.logger?.[level]({ callId: this.session?.callId, ...values }, message);
  }

  private send(event: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  private appendAudio(buffer: Buffer): void {
    this.send({ type: "input_audio_buffer.append", audio: buffer.toString("base64") });
  }

  private addSystemNote(text: string): void {
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "system", content: [{ type: "input_text", text }] }
    });
  }

  /** Asks the model to speak now, or as soon as the response in progress finishes (only one may be active). */
  private requestResponse(): void {
    if (this.stopped) return;
    if (this.activeResponse) {
      this.followUpPending = true;
      return;
    }
    this.send({ type: "response.create" });
    this.activeResponse = true;
  }

  /** Runs `action` once all audio sent so far has played on the phone leg (it plays in real time). */
  private afterPlayback(action: () => void): void {
    const remainingMs = this.playbackEndsAt > 0
      ? Math.min(MAX_PLAYBACK_DRAIN_MS, Math.max(0, this.playbackEndsAt - Date.now()) + PLAYBACK_DRAIN_PAD_MS)
      : 0;
    setTimeout(() => { if (!this.stopped) action(); }, remainingMs);
  }

  private handleServerEvent(event: ServerEvent): void {
    switch (event.type) {
      case "response.output_audio.delta":
      case "response.audio.delta":
        this.onAgentAudio(event);
        return;
      case "input_audio_buffer.speech_started":
        this.onCallerStartedSpeaking();
        return;
      case "input_audio_buffer.speech_stopped":
        this.speechStopped?.();
        return;
      case "response.created":
        this.activeResponse = true;
        return;
      case "response.done":
        this.onResponseDone(event.response as ResponseDone | undefined);
        return;
      case "response.function_call_arguments.done":
        void this.executeToolCall(String(event.call_id ?? ""), String(event.name ?? ""), String(event.arguments ?? "{}"));
        return;
      case "conversation.item.input_audio_transcription.completed": {
        const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
        if (text && !isTranscriptionArtifact(text)) this.transcript?.({ role: "caller", content: text, at: new Date() });
        return;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
        if (text) this.transcript?.({ role: "agent", content: text, at: new Date() });
        return;
      }
      case "error":
        this.onServerError(event.error as { message?: string; code?: string } | undefined);
        return;
      default:
        return;
    }
  }

  private onAgentAudio(event: ServerEvent): void {
    const delta = typeof event.delta === "string" ? event.delta : undefined;
    if (!delta) return;
    const audio = Buffer.from(delta, "base64");
    const durationMs = audio.length / PCMU_BYTES_PER_MS;
    const startsPlayingAt = Math.max(this.playbackEndsAt, Date.now());
    const id = typeof event.item_id === "string" ? event.item_id : undefined;
    const contentIndex = typeof event.content_index === "number" ? event.content_index : 0;
    if (id && this.playItem?.id === id && this.playItem.contentIndex === contentIndex) {
      this.playItem.totalMs += durationMs;
    } else if (id) {
      this.playItem = { id, contentIndex, startedAt: startsPlayingAt, totalMs: durationMs };
    }
    this.playbackEndsAt = startsPlayingAt + durationMs;
    this.audioOut?.(audio);
  }

  /**
   * Azure cancels its own reply when the caller talks over it. The phone leg still holds
   * queued audio, so flush it, and tell the model how much the caller actually heard.
   */
  private onCallerStartedSpeaking(): void {
    this.speechStarted?.();
    const item = this.playItem;
    if (!this.options.attachCallId && item && this.playbackEndsAt > Date.now()) {
      const heardMs = Math.round(Math.min(item.totalMs, Math.max(0, Date.now() - item.startedAt)));
      this.send({ type: "conversation.item.truncate", item_id: item.id, content_index: item.contentIndex, audio_end_ms: heardMs });
    }
    this.playbackEndsAt = 0;
    this.bargeIn?.();
  }

  private onResponseDone(response: ResponseDone | undefined): void {
    this.activeResponse = false;
    if (response?.status === "completed") this.rateLimitStreak = 0;

    // Rate-limited replies leave the caller in silence: retry with a growing pause.
    if (
      response?.status === "failed" &&
      /rate_limit/i.test(response.status_details?.error?.code ?? "") &&
      !this.stopped &&
      this.rateLimitStreak < MAX_RATE_LIMIT_STREAK
    ) {
      this.rateLimitStreak += 1;
      const waitMs = Math.min(MAX_RATE_LIMIT_WAIT_MS, RATE_LIMIT_RETRY_MS * this.rateLimitStreak);
      this.log("error", { attempt: this.rateLimitStreak, waitMs }, "Azure realtime rate limit hit; retrying the response");
      this.followUpPending = false;
      this.activeResponse = true;
      setTimeout(() => { if (!this.stopped) this.send({ type: "response.create" }); }, waitMs);
      return;
    }

    // Catch function calls that did not surface via arguments.done.
    for (const item of response?.output ?? []) {
      if (item.type === "function_call") {
        void this.executeToolCall(String(item.call_id ?? ""), String(item.name ?? ""), String(item.arguments ?? "{}"));
      }
    }

    if (this.followUpPending) {
      this.followUpPending = false;
      this.requestResponse();
    }

    // Hang up or redirect only once the goodbye / hold line has actually played to the caller.
    if (this.endCallRequested) {
      this.endCallRequested = false;
      this.afterPlayback(() => this.endCall?.());
    }
    if (this.pendingTransfer) {
      const selector = this.pendingTransfer;
      this.pendingTransfer = undefined;
      this.afterPlayback(() => this.transferRequested?.(selector));
    }
  }

  private onServerError(error: { message?: string; code?: string } | undefined): void {
    if (error?.code === "response_cancel_not_active") return;
    // Our tool follow-up raced Azure's own reply to the caller: speak it once that reply is done.
    if (error?.code === "conversation_already_has_active_response") {
      this.activeResponse = true;
      this.followUpPending = true;
      return;
    }
    this.log("error", { error: error?.message ?? "unknown", code: error?.code }, "Azure realtime server error");
  }

  private sendToolOutput(callId: string, output: unknown): void {
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output ?? null) }
    });
  }

  private async executeToolCall(callId: string, name: string, rawArguments: string): Promise<void> {
    if (!callId || !name || this.handledToolCalls.has(callId)) return;
    this.handledToolCalls.add(callId);

    let input: Record<string, unknown> = {};
    try {
      input = rawArguments ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
    } catch {
      input = {};
    }

    if (name === "end_call") {
      this.endCallRequested = true;
      this.sendToolOutput(callId, { ended: true });
      this.transcript?.({ role: "tool", content: "end_call", at: new Date() });
      return;
    }

    if (name === "transfer_to_staff") {
      const selector: StaffSelector = {
        staffId: typeof input.staffId === "string" ? input.staffId : undefined,
        staffName: typeof input.staffName === "string" ? input.staffName : undefined
      };
      const check = (await this.options.resolveTransfer?.(selector)) ?? { ok: true as const };
      if (!check.ok) {
        this.sendToolOutput(callId, {
          transferring: false,
          reason: check.reason,
          teamMembersYouCanOffer: check.available,
          instruction: "Do not say you are connecting anyone. Offer one of teamMembersYouCanOffer, or a callback."
        });
        this.transcript?.({ role: "tool", content: `transfer_to_staff -> refused: ${check.reason}`, at: new Date() });
        this.requestResponse();
        return;
      }
      this.sendToolOutput(callId, { transferring: true });
      this.transcript?.({ role: "tool", content: "transfer_to_staff -> transferring", at: new Date() });
      if (this.activeResponse) {
        this.pendingTransfer = selector; // redirected once the hold line has played
      } else {
        // The check outlasted the reply that called the tool; its hold line is already queued.
        this.afterPlayback(() => this.transferRequested?.(selector));
      }
      return;
    }

    let output: unknown;
    try {
      output = await this.toolCall?.(name, input);
      this.transcript?.({ role: "tool", content: `${name} -> ${JSON.stringify(output).slice(0, 1_500)}`, at: new Date() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      output = { error: message };
      this.transcript?.({ role: "tool", content: `${name} failed: ${message}`, at: new Date() });
      this.log("error", { tool: name, error: message }, "Realtime tool call failed");
    }
    this.sendToolOutput(callId, output);
    this.requestResponse();
  }
}

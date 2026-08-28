import {
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity
} from "@google/genai";
import type {
  FunctionCall,
  FunctionDeclaration,
  LiveServerMessage,
  Session
} from "@google/genai";
import type { AIBridge, StaffSelector, TranscriptEvent } from "./ai-bridge.js";
import type { CallSession } from "./call-session.js";
import { buildInstructions, languageHintCodes } from "./instructions.js";
import {
  base64PcmToInt16,
  computeRms,
  int16ToBase64Pcm,
  pcmToTwilioMulaw,
  twilioMulawToPcm
} from "./audio/mulaw-pcm.js";
import { VoiceLatencyTracker } from "./latency-tracker.js";

/** Gemini Live streams PCM16 in at 16kHz and out at 24kHz. */
const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;

/**
 * Grace period after `turnComplete` before actually hanging up.
 */
const END_CALL_DRAIN_MS = 800;

/**
 * Silence-timeout: if the caller says nothing for 20s after the agent
 * finishes a closing question ("anything else?"), end the call cleanly.
 */
const SILENCE_HANGUP_MS = 20_000;

/**
 * Matches the agent's closing "anything else?" question in English or Hinglish/Hindi phrasing.
 */
export const CLOSING_QUESTION_PATTERN =
  /anything else|kuch aur|कुछ और|kuch and chahiye|else (?:i|we) can help/i;

export type BridgeState =
  | "READY"
  | "USER_SPEAKING"
  | "WAITING_FOR_MODEL"
  | "TOOL_REQUESTED"
  | "TOOL_EXECUTING"
  | "TOOL_RESULT_SENT"
  | "MODEL_RESPONDING"
  | "TURN_COMPLETE";

export interface GeminiLiveBridgeOptions {
  project?: string;
  location?: string;
  model: string;
  voice?: string;
  apiKey?: string;
  vadSensitivity?: "strict" | "unspecified" | "relaxed";
  credentials?: Record<string, unknown>;
  logger?: {
    info(values: Record<string, unknown>, message: string): void;
    error(values: Record<string, unknown>, message: string): void;
    warn?(values: Record<string, unknown>, message: string): void;
    debug?(values: Record<string, unknown>, message: string): void;
  };
}

export const REALTIME_TOOLS: FunctionDeclaration[] = [
  {
    name: "check_availability",
    description:
      "Look up open appointment slots for a service on a given date. Always call this before promising or booking any time. Returns ISO timestamps for each free slot.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "UUID of the service, if already known from a previous tool result." },
        serviceName: { type: "string", description: "Name of the service as the caller said it (fuzzy matched)." },
        staffId: { type: "string", description: "UUID of a specific staff member, if already known from a previous tool result." },
        staffName: { type: "string", description: "Name of a specific staff member the caller asked for (fuzzy matched). Omit to check availability across any staff member." },
        date: { type: "string", description: "Requested date in YYYY-MM-DD, in the caller's local timezone shown in instructions." }
      },
      required: ["date"]
    }
  },
  {
    name: "create_booking",
    description:
      "Book a confirmed appointment. Only call after check_availability returned the slot and the caller clearly agreed to it. Pass startsAt EXACTLY as returned by check_availability.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "UUID of the service from check_availability." },
        staffId: { type: "string", description: "UUID of the specific staff member to assign, from check_availability, if the caller requested a specific person." },
        startsAt: { type: "string", description: "Slot start time, copied verbatim from a check_availability slot (ISO 8601 with offset)." },
        callerName: { type: "string", description: "Caller's name if they shared it." }
      },
      required: ["serviceId", "startsAt"]
    }
  },
  {
    name: "cancel_booking",
    description:
      "Cancel one of this caller's confirmed upcoming bookings. Get the bookingId from get_caller_context first and confirm with the caller before cancelling.",
    parametersJsonSchema: {
      type: "object",
      properties: { bookingId: { type: "string", description: "UUID of the booking to cancel." } },
      required: ["bookingId"]
    }
  },
  {
    name: "save_memory",
    description:
      "Save a durable contextual fact or preference that does not fit a caller profile field (for example, 'Prefers WhatsApp follow-up').",
    parametersJsonSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fact", "preference", "summary"] },
        content: { type: "string", description: "One short sentence describing the fact or preference." }
      },
      required: ["content"]
    }
  },
  {
    name: "update_caller_profile",
    description:
      "Save structured caller details immediately. Use only the keys listed in CALLER PROFILE; name is always allowed. Valid fields save even if another field is rejected.",
    parametersJsonSchema: {
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
    name: "get_caller_context",
    description:
      "Fetch this caller's saved details: name, remembered facts, and upcoming confirmed bookings (with bookingIds). Call when the caller references past visits, wants to change/cancel a booking, or when you are unsure of a detail you were already told.",
    parametersJsonSchema: { type: "object", properties: {} }
  },
  {
    name: "list_staff",
    description:
      "Look up the business's staff members, including which are registered agents and what that credential is called. Call this when the caller asks who they'll be speaking with, whether a specific person is registered/qualified, or wants to know their options before choosing someone.",
    parametersJsonSchema: { type: "object", properties: {} }
  },
  {
    name: "transfer_to_staff",
    description:
      "Transfer the live call to a real staff member's phone. Only call this when the caller EXPLICITLY asks to speak to a person or names a specific staff member — never on your own judgement. Say a short natural line first ('Sure, connecting you to Gagandeep now' / 'One moment, transferring you to the team'), THEN call this tool.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        staffId: { type: "string", description: "UUID of a specific staff member, if already known from a previous tool result." },
        staffName: { type: "string", description: "Name of a specific staff member the caller asked for. Omit if the caller just asked for \"a person\" generically." }
      }
    }
  },
  {
    name: "end_call",
    description:
      "End the phone call. Call this when the caller confirms there is nothing else they need ('no that's all', 'that's it, thanks'), OR whenever the caller says goodbye or clearly wants to end the call ('bye', 'have a good day', 'not now', 'I'll call back later') — even if you have not collected their name or handled any request. Say a short natural goodbye in your reply FIRST, then call this tool.",
    parametersJsonSchema: { type: "object", properties: {} }
  }
];

function resolveEndSensitivity(sensitivity?: "strict" | "unspecified" | "relaxed"): EndSensitivity {
  if (sensitivity === "relaxed") {
    return EndSensitivity.END_SENSITIVITY_LOW;
  }
  return EndSensitivity.END_SENSITIVITY_HIGH;
}

/**
 * Bridges a Twilio G.711 mu-law media stream to Gemini Live (Vertex AI / Google AI Studio),
 * with a deterministic state machine, zero-PII latency tracking, and robust function call lifecycle.
 */
export class GeminiLiveBridge implements AIBridge {
  private readonly client: GoogleGenAI;
  private session?: Session;
  private callSession?: CallSession;
  private latencyTracker?: VoiceLatencyTracker;
  private audioOut?: (buffer: Buffer) => void;
  private toolCall?: (name: string, input: unknown) => Promise<unknown> | unknown;
  private transcript?: (event: TranscriptEvent) => void;
  private bargeIn?: () => void;
  private closed?: () => void;
  private endCall?: () => void;
  private turnComplete?: () => void;
  private stateChange?: (from: BridgeState, to: BridgeState) => void;
  private transferRequested?: (selector: StaffSelector) => void;
  private endCallRequested = false;
  private pendingTransfer?: StaffSelector;
  private readonly pendingAudio: Buffer[] = [];
  private readonly handledToolCalls = new Set<string>();
  private readonly activeToolCalls = new Set<string>();
  private ready = false;
  private stopped = false;
  private silenceTimer?: NodeJS.Timeout;
  private currentAgentTurnText = "";
  private currentCallerTurnText = "";
  private isUserSpeaking = false;
  private state: BridgeState = "READY";
  private lastEventTime = Date.now();
  private lastEventName = "NONE";
  /** Consecutive silence frames to cut off background line noise and force instant VAD endpointing */
  private silenceFrameCount = 0;
  /** Monotonic timestamp when bridge.start() was called — used for elapsed-time logging */
  private callStartMs = 0;

  constructor(private readonly options: GeminiLiveBridgeOptions) {
    if (options.apiKey) {
      this.client = new GoogleGenAI({ apiKey: options.apiKey });
    } else {
      this.client = new GoogleGenAI({
        vertexai: true,
        project: options.project ?? "savr-457c4",
        location: options.location ?? "global",
        ...(options.credentials ? { googleAuthOptions: { credentials: options.credentials } } : {})
      });
    }
  }

  public getState(): BridgeState {
    return this.state;
  }

  public getPendingToolCount(): number {
    return this.activeToolCalls.size;
  }

  public getLastEvent(): { name: string; timestamp: number } {
    return { name: this.lastEventName, timestamp: this.lastEventTime };
  }

  public isSessionReady(): boolean {
    return this.ready && !this.stopped && this.state === "READY" && this.activeToolCalls.size === 0;
  }

  public onStateChange(callback: (from: BridgeState, to: BridgeState) => void): void {
    this.stateChange = callback;
  }

  private transitionTo(newState: BridgeState): void {
    const oldState = this.state;
    if (oldState === newState) return;
    this.state = newState;
    this.stateChange?.(oldState, newState);
  }

  private recordEvent(name: string): void {
    this.lastEventTime = Date.now();
    this.lastEventName = name;
    const elapsed = this.callStartMs ? this.lastEventTime - this.callStartMs : 0;
    this.options.logger?.info(
      { callId: this.callSession?.callId, event: name, state: this.state, elapsedMs: elapsed },
      `[TIMING] ${name} @ +${elapsed}ms (state=${this.state})`
    );
  }

  async start(session: CallSession): Promise<void> {
    this.callSession = session;
    this.callStartMs = Date.now();
    this.latencyTracker = new VoiceLatencyTracker(session.callId, this.options.logger);
    this.transitionTo("READY");

    const hints = languageHintCodes(session.agent.languages);
    const transcriptionConfig = hints.length ? { languageHints: { languageCodes: hints } } : {};
    const endSensitivity = resolveEndSensitivity(this.options.vadSensitivity);

    const connectPromise = this.client.live.connect({
      model: this.options.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: buildInstructions(session) }] },
        tools: [{ functionDeclarations: REALTIME_TOOLS }],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: this.options.voice ?? "Kore" } }
        },
        inputAudioTranscription: transcriptionConfig,
        outputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: {
            endOfSpeechSensitivity: endSensitivity,
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH
          }
        }
      },
      callbacks: {
        onopen: () => {
          this.recordEvent("WEBSOCKET_OPEN");
          this.options.logger?.info({ callId: this.callSession?.callId }, "Gemini Live WebSocket open");
        },
        onmessage: (message: LiveServerMessage) => this.handleServerMessage(message),
        onerror: (event) => {
          this.recordEvent("WEBSOCKET_ERROR");
          this.options.logger?.error(
            { callId: this.callSession?.callId, error: String(event?.message ?? event) },
            "Gemini Live WebSocket error"
          );
        },
        onclose: (event) => {
          this.recordEvent(`WEBSOCKET_CLOSE:code=${event?.code}:reason=${event?.reason}`);
          this.ready = false;
          this.activeToolCalls.clear();
          this.transitionTo("READY");
          if (!this.stopped) {
            this.options.logger?.info(
              { callId: this.callSession?.callId, reason: event?.reason, code: event?.code },
              "Gemini Live WebSocket closed"
            );
            this.closed?.();
          }
        }
      }
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Gemini Live connection timed out")), 10_000)
    );
    this.session = await Promise.race([connectPromise, timeout]);

    // Send greeting turn
    this.recordEvent("GREETING_START");
    this.transitionTo("WAITING_FOR_MODEL");
    this.session.sendClientContent({
      turns: [
        {
          role: "user",
          parts: [
            {
              text:
                "Say aloud immediately to the caller in a warm, welcoming, natural human tone: " +
                JSON.stringify(session.agent.voiceGreeting)
            }
          ]
        }
      ],
      turnComplete: true
    });

    this.ready = true;
    for (const buffered of this.pendingAudio.splice(0)) {
      this.forwardAudio(buffered);
    }
  }

  sendAudio(buffer: Buffer): void {
    if (!this.ready || !this.session) {
      if (this.pendingAudio.length < 500) this.pendingAudio.push(buffer);
      return;
    }
    this.forwardAudio(buffer);
  }

  sendUserText(text: string): void {
    if (!this.session) return;
    this.recordEvent("USER_TEXT_SENT");
    this.transitionTo("WAITING_FOR_MODEL");
    this.session.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true
    });
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

  onBargeIn(callback: () => void): void {
    this.bargeIn = callback;
  }

  onClose(callback: () => void): void {
    this.closed = callback;
  }

  onEndCall(callback: () => void): void {
    this.endCall = callback;
  }

  onTurnComplete(callback: () => void): void {
    this.turnComplete = callback;
  }

  onTransferRequested(callback: (selector: StaffSelector) => void): void {
    this.transferRequested = callback;
  }

  notifyTransferFailed(reason: string): void {
    this.session?.sendClientContent({
      turns: [{
        role: "user",
        parts: [{
          text: `[SYSTEM: The transfer you just attempted did not go through (${reason}). Briefly and naturally let the caller know you couldn't connect them, without repeating internal details, and keep helping them yourself.]`
        }]
      }],
      turnComplete: true
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    this.pendingAudio.length = 0;
    this.activeToolCalls.clear();
    this.clearSilenceTimer();
    this.session?.close();
    this.session = undefined;
    this.audioOut = undefined;
    this.toolCall = undefined;
    this.bargeIn = undefined;
    this.turnComplete = undefined;
    this.transferRequested = undefined;
    this.transitionTo("READY");
  }

  private forwardAudio(buffer: Buffer): void {
    const pcm = twilioMulawToPcm(buffer, INPUT_SAMPLE_RATE);
    const rms = computeRms(pcm);

    // Completely ignore and drop all incoming audio while the AI agent is speaking (MODEL_RESPONDING).
    // This prevents other voices in the room, background noise, or line static from interrupting the AI.
    if (this.state === "MODEL_RESPONDING") {
      return;
    }

    const SPEECH_THRESHOLD_RMS = 45;

    if (rms >= SPEECH_THRESHOLD_RMS) {
      this.silenceFrameCount = 0;
      if (!this.isUserSpeaking) {
        this.isUserSpeaking = true;
        this.recordEvent(`USER_SPEECH_STARTED:rms=${Math.round(rms)}`);
        this.transitionTo("USER_SPEAKING");
        this.latencyTracker?.onUserSpeechStarted();
      }
    } else {
      this.silenceFrameCount += 1;
      // If the user was speaking and has now paused for > 6 frames (120ms of silence),
      // stop sending ambient line static to Gemini so Gemini's VAD instantly detects
      // the end of speech without a multi-second timeout.
      if (this.isUserSpeaking && this.silenceFrameCount > 6) {
        return;
      }
      // If user has not started speaking yet and audio is ambient noise (< 45 RMS), gate it out.
      if (!this.isUserSpeaking && rms < SPEECH_THRESHOLD_RMS) {
        return;
      }
    }

    this.session?.sendRealtimeInput({
      audio: { data: int16ToBase64Pcm(pcm), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` }
    });
  }

  private handleServerMessage(message: LiveServerMessage): void {
    // Don't log SERVER_MESSAGE_RECEIVED — it fires on every audio chunk (~50/sec)
    this.lastEventTime = Date.now();
    const content = message.serverContent;

    // 1. Handle Interruption (Barge-in)
    if (content?.interrupted) {
      this.recordEvent("INTERRUPTED");
      this.options.logger?.info(
        { callId: this.callSession?.callId },
        "Gemini Live reported interrupted (barge-in) — flushing playback"
      );
      this.activeToolCalls.clear();
      this.latencyTracker?.onBargeIn();
      this.bargeIn?.();
      this.clearSilenceTimer();
      this.currentAgentTurnText = "";
      this.isUserSpeaking = false;
      this.transitionTo("READY");
      return;
    }

    // 2. Explicitly route Model Turn Parts (audio vs text vs thought)
    let sentAudio = false;
    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        sentAudio = true;
        this.recordEvent("AUDIO_CHUNK_RECEIVED");
        this.isUserSpeaking = false;
        this.transitionTo("MODEL_RESPONDING");
        this.latencyTracker?.onFirstAudioChunk();
        this.audioOut?.(pcmToTwilioMulaw(base64PcmToInt16(part.inlineData.data), OUTPUT_SAMPLE_RATE));
      } else if (part.text) {
        this.recordEvent("TEXT_PART_RECEIVED");
        this.latencyTracker?.onFirstLlmToken();
      }
      // Note: part.thought is internal CoT reasoning — safely ignored from audio output.
    }

    // Direct data message audio fallback
    if (!sentAudio && message.data) {
      this.recordEvent("DIRECT_AUDIO_RECEIVED");
      this.isUserSpeaking = false;
      this.transitionTo("MODEL_RESPONDING");
      this.latencyTracker?.onFirstAudioChunk();
      this.audioOut?.(pcmToTwilioMulaw(base64PcmToInt16(message.data), OUTPUT_SAMPLE_RATE));
    }

    // 3. Handle Input (Caller) Transcription
    const inputText = content?.inputTranscription?.text?.trim();
    if (inputText) {
      this.recordEvent("INPUT_TRANSCRIPTION_RECEIVED");
      this.latencyTracker?.onCallerTranscriptReceived();
      this.currentCallerTurnText += (this.currentCallerTurnText ? " " : "") + inputText;
      this.clearSilenceTimer();
    }

    // 4. Handle Output (Agent) Transcription
    const outputText = content?.outputTranscription?.text?.trim();
    if (outputText) {
      this.recordEvent("OUTPUT_TRANSCRIPTION_RECEIVED");
      this.latencyTracker?.onFirstLlmToken();
      if (this.currentCallerTurnText.trim()) {
        this.transcript?.({ role: "caller", content: this.currentCallerTurnText.trim(), at: new Date() });
        this.currentCallerTurnText = "";
      }
      this.currentAgentTurnText += (this.currentAgentTurnText ? " " : "") + outputText;
    }

    // 5. Collect and Execute Function Calls (checking both message.toolCall and modelTurn parts)
    const functionCalls: FunctionCall[] = [
      ...(message.toolCall?.functionCalls ?? [])
    ];
    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.functionCall) {
        functionCalls.push(part.functionCall);
      }
    }

    if (functionCalls.length > 0) {
      this.recordEvent("FUNCTION_CALL_RECEIVED");
      this.transitionTo("TOOL_REQUESTED");
      if (this.currentCallerTurnText.trim()) {
        this.transcript?.({ role: "caller", content: this.currentCallerTurnText.trim(), at: new Date() });
        this.currentCallerTurnText = "";
      }
      for (const call of functionCalls) {
        const callId = call.id ?? "";
        if (callId && !this.handledToolCalls.has(callId)) {
          this.activeToolCalls.add(callId);
          void this.executeToolCall(call);
        }
      }
    }

    // 6. Handle Turn Complete
    if (content?.turnComplete) {
      this.recordEvent("TURN_COMPLETE_RECEIVED");
      this.isUserSpeaking = false;

      // If tool calls are still executing or awaiting their post-tool spoken response,
      // do NOT conclude the turn prematurely.
      if (this.activeToolCalls.size > 0 || this.state === "TOOL_EXECUTING" || this.state === "TOOL_RESULT_SENT") {
        return;
      }

      if (this.currentCallerTurnText.trim()) {
        this.transcript?.({ role: "caller", content: this.currentCallerTurnText.trim(), at: new Date() });
        this.currentCallerTurnText = "";
      }
      if (this.currentAgentTurnText.trim()) {
        this.transcript?.({ role: "agent", content: this.currentAgentTurnText.trim(), at: new Date() });
      }

      this.transitionTo("TURN_COMPLETE");
      this.turnComplete?.();
      this.transitionTo("READY");

      if (this.endCallRequested) {
        this.endCallRequested = false;
        this.clearSilenceTimer();
        setTimeout(() => this.endCall?.(), END_CALL_DRAIN_MS);
      } else if (this.pendingTransfer) {
        const selector = this.pendingTransfer;
        this.pendingTransfer = undefined;
        this.clearSilenceTimer();
        setTimeout(() => this.transferRequested?.(selector), END_CALL_DRAIN_MS);
      } else {
        if (CLOSING_QUESTION_PATTERN.test(this.currentAgentTurnText)) {
          this.armSilenceTimer();
        }
        this.currentAgentTurnText = "";
      }
    }
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
  }

  private armSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.endCallRequested || this.pendingTransfer || this.stopped) return;
      this.options.logger?.info(
        { callId: this.callSession?.callId },
        "Caller silent after closing question — ending call cleanly"
      );
      this.endCall?.();
    }, SILENCE_HANGUP_MS);
  }

  private async executeToolCall(call: FunctionCall): Promise<void> {
    const callId = call.id ?? "";
    const name = call.name ?? "";
    if (!callId || !name || this.handledToolCalls.has(callId)) return;
    this.handledToolCalls.add(callId);

    this.recordEvent(`TOOL_START:${name}`);
    this.transitionTo("TOOL_EXECUTING");

    if (name === "end_call") {
      this.endCallRequested = true;
      this.activeToolCalls.delete(callId);
      this.session?.sendToolResponse({
        functionResponses: [{ id: callId, name, response: { output: { ended: true } } }]
      });
      this.transcript?.({ role: "tool", content: 'end_call -> {"ended":true}', at: new Date() });
      this.recordEvent("TOOL_RESPONSE_SENT:end_call");
      this.transitionTo("MODEL_RESPONDING");
      return;
    }

    if (name === "transfer_to_staff") {
      const args = (call.args ?? {}) as StaffSelector;
      this.pendingTransfer = { staffId: args.staffId, staffName: args.staffName };
      this.activeToolCalls.delete(callId);
      this.session?.sendToolResponse({
        functionResponses: [{ id: callId, name, response: { output: { transferring: true } } }]
      });
      this.transcript?.({ role: "tool", content: 'transfer_to_staff -> {"transferring":true}', at: new Date() });
      this.recordEvent("TOOL_RESPONSE_SENT:transfer_to_staff");
      this.transitionTo("MODEL_RESPONDING");
      return;
    }

    let output: unknown;
    this.latencyTracker?.onToolStart();
    try {
      // Execute the registered ToolExecutor
      output = await this.toolCall?.(name, call.args ?? {});
      this.latencyTracker?.onToolEnd();
      this.transcript?.({
        role: "tool",
        content: `${name} -> ${JSON.stringify(output).slice(0, 1_500)}`,
        at: new Date()
      });
    } catch (error) {
      this.latencyTracker?.onToolEnd();
      const message = error instanceof Error ? error.message : "Tool execution failed";
      output = { error: message };
      this.transcript?.({ role: "tool", content: `${name} failed: ${message}`, at: new Date() });
      this.options.logger?.error(
        { callId: this.callSession?.callId, tool: name, error: message },
        "Gemini Live tool call failed"
      );
    } finally {
      this.activeToolCalls.delete(callId);
    }

    this.recordEvent(`TOOL_RESPONSE_SENT:${name}`);
    this.transitionTo("TOOL_RESULT_SENT");
    this.session?.sendToolResponse({
      functionResponses: [{ id: callId, name, response: { output: output ?? {} } }]
    });
    this.transitionTo("MODEL_RESPONDING");
  }
}

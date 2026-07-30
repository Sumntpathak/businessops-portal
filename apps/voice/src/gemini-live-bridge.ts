import { EndSensitivity, GoogleGenAI, Modality } from "@google/genai";
import type {
  FunctionCall,
  FunctionDeclaration,
  LiveServerMessage,
  Session
} from "@google/genai";
import type { AIBridge, StaffSelector, TranscriptEvent } from "./ai-bridge.js";
import type { CallSession } from "./call-session.js";
import { buildInstructions } from "./azure-realtime-bridge.js";
import {
  base64PcmToInt16,
  int16ToBase64Pcm,
  pcmToTwilioMulaw,
  twilioMulawToPcm
} from "./audio/mulaw-pcm.js";

/** Gemini Live streams PCM16 in at 16kHz and out at 24kHz. */
const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;

/**
 * BCP-47 codes for Gemini Live's transcription languageHints. Hindi maps to
 * hi-IN specifically (not the bare "hi") per direct request — this business's
 * callers are Indian, and India is the intended locale for these languages.
 * Anything not listed falls back to auto-detect (no hints sent).
 */
const TRANSCRIBE_LANGUAGE_CODES: Record<string, string> = {
  english: "en-IN",
  hindi: "hi-IN",
  punjabi: "pa-IN",
  tamil: "ta-IN",
  telugu: "te-IN",
  bengali: "bn-IN",
  marathi: "mr-IN",
  gujarati: "gu-IN",
  kannada: "kn-IN",
  malayalam: "ml-IN",
  urdu: "ur-IN",
  spanish: "es-ES",
  french: "fr-FR",
  german: "de-DE",
  arabic: "ar-SA",
  mandarin: "zh-CN",
  chinese: "zh-CN",
  japanese: "ja-JP"
};

/**
 * Anchors transcription to the tenant's configured languages, same intent as
 * transcriptionConfig() in azure-realtime-bridge.ts — without hints the
 * transcriber guesses per utterance and can write Hindi speech in the wrong
 * script or drift to an unrelated language mid-call.
 */
function languageHintCodes(languages: string[]): string[] {
  return languages
    .map((language) => TRANSCRIBE_LANGUAGE_CODES[language.toLowerCase()])
    .filter((code): code is string => Boolean(code));
}

/**
 * Grace period after `turnComplete` before actually hanging up. Gemini's own
 * turnComplete already accounts for its internal realtime-playback wait (see
 * LiveServerContent docs), but that covers Gemini's model of playback, not the
 * downstream Twilio leg's actual buffered audio reaching the phone line.
 */
const END_CALL_DRAIN_MS = 800;

/**
 * Silence-timeout: if the caller says nothing for this long after the agent
 * finishes a turn, prompt once ("anything else?"). If still silent after
 * SILENCE_HANGUP_MS more, end the call. Model-driven end_call already covers
 * the caller saying goodbye; this covers the caller just going quiet and
 * never responding, which end_call alone has no way to detect.
 */
const SILENCE_PROMPT_MS = 2_000;
const SILENCE_HANGUP_MS = 3_000;

/**
 * Matches the agent's closing "anything else?" question (agent.md's ENDING
 * THE CALL rule) in English or Hinglish/Hindi phrasing, so the silence timer
 * only arms once the conversation is actually winding down — not after every
 * ordinary mid-call turn, which would misfire on normal thinking pauses.
 */
export const CLOSING_QUESTION_PATTERN =
  /anything else|kuch aur|कुछ और|kuch and chahiye|else i can help|help you with today/i;

export interface GeminiLiveBridgeOptions {
  project: string;
  location: string;
  model: string;
  voice?: string;
  /**
   * Parsed GCP service-account JSON (the JWTInput shape: client_email,
   * private_key, etc). Used when the credentials are supplied inline via an
   * env var rather than a file path — e.g. on hosts without secret-file
   * support, where GOOGLE_APPLICATION_CREDENTIALS can't point at a mounted
   * file. When omitted, falls back to standard Application Default
   * Credentials (GOOGLE_APPLICATION_CREDENTIALS file path, workload identity, etc).
   */
  credentials?: Record<string, unknown>;
  logger?: {
    info(values: Record<string, unknown>, message: string): void;
    error(values: Record<string, unknown>, message: string): void;
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
        kind: { type: "string", enum: ["fact", "preference"] },
        content: { type: "string", description: "One short sentence describing the fact or preference." }
      },
      required: ["kind", "content"]
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

/**
 * Bridges a Twilio G.711 mu-law media stream to Gemini Live (Vertex AI),
 * which does STT+LLM+TTS+tool-calling in one bidirectional WebSocket. Audio
 * is transcoded mulaw8k <-> pcm16 at Gemini's expected rates (16k in / 24k
 * out). Tool calls are delegated to the ToolExecutor registered via
 * onToolCall, mirroring AzureRealtimeBridge's contract.
 */
export class GeminiLiveBridge implements AIBridge {
  private readonly client: GoogleGenAI;
  private session?: Session;
  private callSession?: CallSession;
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
  private silenceTimer?: NodeJS.Timeout;
  private currentAgentTurnText = "";

  constructor(private readonly options: GeminiLiveBridgeOptions) {
    this.client = new GoogleGenAI({
      vertexai: true,
      project: options.project,
      location: options.location,
      ...(options.credentials ? { googleAuthOptions: { credentials: options.credentials } } : {})
    });
  }

  async start(session: CallSession): Promise<void> {
    this.callSession = session;

    const hints = languageHintCodes(session.agent.languages);
    const transcriptionConfig = hints.length ? { languageHints: { languageCodes: hints } } : {};

    // client.live.connect() resolves only once the session is genuinely ready
    // (after setupComplete) — no separate onopen-driven promise needed.
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
        // Gemini Live defaults to END_SENSITIVITY_HIGH ("ends speech more
        // often" per the SDK's own docs) — the likely cause of reported
        // mid-sentence audio cutoffs and getting stuck around tool-call
        // pauses. LOW makes end-of-speech detection less trigger-happy.
        realtimeInputConfig: {
          automaticActivityDetection: {
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW
          }
        }
      },
      callbacks: {
        onopen: () => {
          this.options.logger?.info({ callId: this.callSession?.callId }, "Gemini Live WebSocket open");
        },
        onmessage: (message: LiveServerMessage) => this.handleServerMessage(message),
        onerror: (event) => {
          this.options.logger?.error(
            { callId: this.callSession?.callId, error: String(event?.message ?? event) },
            "Gemini Live WebSocket error"
          );
        },
        onclose: (event) => {
          this.ready = false;
          if (!this.stopped) {
            this.options.logger?.info(
              { callId: this.callSession?.callId, reason: event?.reason },
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

    this.session.sendClientContent({
      turns: [
        {
          role: "user",
          parts: [
            {
              text:
                "Greet the caller now with exactly this greeting, spoken naturally: " +
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

  /** Fired when the Gemini Live WebSocket closes unexpectedly. */
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
    this.clearSilenceTimer();
    this.session?.close();
    this.session = undefined;
    this.audioOut = undefined;
    this.toolCall = undefined;
    this.bargeIn = undefined;
    this.transferRequested = undefined;
  }

  private forwardAudio(buffer: Buffer): void {
    const pcm = twilioMulawToPcm(buffer, INPUT_SAMPLE_RATE);
    this.session?.sendRealtimeInput({
      audio: { data: int16ToBase64Pcm(pcm), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` }
    });
  }

  private handleServerMessage(message: LiveServerMessage): void {
    const content = message.serverContent;

    if (content?.interrupted) {
      this.options.logger?.info(
        { callId: this.callSession?.callId },
        "Gemini Live reported interrupted (barge-in) — flushing playback"
      );
      this.bargeIn?.();
      this.clearSilenceTimer();
    }

    const audioBase64 = message.data;
    if (audioBase64) {
      this.audioOut?.(pcmToTwilioMulaw(base64PcmToInt16(audioBase64), OUTPUT_SAMPLE_RATE));
    }

    const inputText = content?.inputTranscription?.text?.trim();
    if (inputText) {
      this.transcript?.({ role: "caller", content: inputText, at: new Date() });
      this.clearSilenceTimer();
    }

    const outputText = content?.outputTranscription?.text?.trim();
    if (outputText) {
      this.transcript?.({ role: "agent", content: outputText, at: new Date() });
      this.currentAgentTurnText += ` ${outputText}`;
    }

    for (const call of message.toolCall?.functionCalls ?? []) {
      void this.executeToolCall(call);
    }

    // Gemini's own turnComplete already waits for its modeled realtime playback
    // to finish (see LiveServerContent docs); add a short drain margin for the
    // downstream Twilio leg before actually disconnecting.
    if (content?.turnComplete && this.endCallRequested) {
      this.endCallRequested = false;
      this.clearSilenceTimer();
      setTimeout(() => this.endCall?.(), END_CALL_DRAIN_MS);
    } else if (content?.turnComplete && this.pendingTransfer) {
      // Same reasoning as end_call: wait for the "connecting you now" line to
      // finish streaming before actually redirecting the call.
      const selector = this.pendingTransfer;
      this.pendingTransfer = undefined;
      this.clearSilenceTimer();
      setTimeout(() => this.transferRequested?.(selector), END_CALL_DRAIN_MS);
    } else if (content?.turnComplete) {
      // Only start watching for silence once the agent has asked its closing
      // "anything else?" question (per agent.md's ENDING THE CALL rule) —
      // arming this after every turn would fire during completely normal
      // mid-conversation thinking pauses, not just an abandoned call.
      if (CLOSING_QUESTION_PATTERN.test(this.currentAgentTurnText)) {
        this.armSilenceTimer();
      }
      this.currentAgentTurnText = "";
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
        "Caller silent after agent turn — prompting once"
      );
      this.session?.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "[SYSTEM: The caller has gone silent. Briefly check if they are still there or need anything else.]" }] }],
        turnComplete: true
      });
      this.silenceTimer = setTimeout(() => {
        if (this.endCallRequested || this.pendingTransfer || this.stopped) return;
        this.options.logger?.info(
          { callId: this.callSession?.callId },
          "Caller still silent after prompt — ending call"
        );
        this.endCall?.();
      }, SILENCE_HANGUP_MS);
    }, SILENCE_PROMPT_MS);
  }

  private async executeToolCall(call: FunctionCall): Promise<void> {
    const callId = call.id ?? "";
    const name = call.name ?? "";
    if (!callId || !name || this.handledToolCalls.has(callId)) return;
    this.handledToolCalls.add(callId);

    if (name === "end_call") {
      this.endCallRequested = true;
      this.session?.sendToolResponse({
        functionResponses: [{ id: callId, name, response: { output: { ended: true } } }]
      });
      this.transcript?.({ role: "tool", content: 'end_call -> {"ended":true}', at: new Date() });
      return;
    }

    if (name === "transfer_to_staff") {
      const args = (call.args ?? {}) as StaffSelector;
      this.pendingTransfer = { staffId: args.staffId, staffName: args.staffName };
      this.session?.sendToolResponse({
        functionResponses: [{ id: callId, name, response: { output: { transferring: true } } }]
      });
      this.transcript?.({ role: "tool", content: 'transfer_to_staff -> {"transferring":true}', at: new Date() });
      return;
    }

    let output: unknown;
    try {
      output = await this.toolCall?.(name, call.args ?? {});
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
        { callId: this.callSession?.callId, tool: name, error: message },
        "Gemini Live tool call failed"
      );
    }

    this.session?.sendToolResponse({
      functionResponses: [{ id: callId, name, response: { output: output ?? null } }]
    });
  }
}

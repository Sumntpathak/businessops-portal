import { GoogleGenAI, Modality } from "@google/genai";
import type {
  FunctionCall,
  FunctionDeclaration,
  LiveServerMessage,
  Session
} from "@google/genai";
import type { AIBridge, TranscriptEvent } from "./ai-bridge.js";
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
 * Grace period after `turnComplete` before actually hanging up. Gemini's own
 * turnComplete already accounts for its internal realtime-playback wait (see
 * LiveServerContent docs), but that covers Gemini's model of playback, not the
 * downstream Twilio leg's actual buffered audio reaching the phone line.
 */
const END_CALL_DRAIN_MS = 800;

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
  private endCallRequested = false;
  private readonly pendingAudio: Buffer[] = [];
  private readonly handledToolCalls = new Set<string>();
  private ready = false;
  private stopped = false;

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

    this.session = await new Promise<Session>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Gemini Live connection timed out")), 10_000);
      let opened: Session | undefined;

      this.client.live
        .connect({
          model: this.options.model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: { parts: [{ text: buildInstructions(session) }] },
            tools: [{ functionDeclarations: REALTIME_TOOLS }],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: this.options.voice ?? "Puck" } }
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // Barge-in ("start of activity interrupts") is the SDK default; left
            // implicit here rather than importing ActivityHandling for one value.
            realtimeInputConfig: {
              automaticActivityDetection: {}
            }
          },
          callbacks: {
            onopen: () => {
              clearTimeout(timeout);
              if (opened) resolve(opened);
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
        })
        .then((connected) => {
          opened = connected;
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });

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

  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    this.pendingAudio.length = 0;
    this.session?.close();
    this.session = undefined;
    this.audioOut = undefined;
    this.toolCall = undefined;
    this.bargeIn = undefined;
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
      this.bargeIn?.();
    }

    const audioBase64 = message.data;
    if (audioBase64) {
      this.audioOut?.(pcmToTwilioMulaw(base64PcmToInt16(audioBase64), OUTPUT_SAMPLE_RATE));
    }

    const inputText = content?.inputTranscription?.text?.trim();
    if (inputText) this.transcript?.({ role: "caller", content: inputText, at: new Date() });

    const outputText = content?.outputTranscription?.text?.trim();
    if (outputText) this.transcript?.({ role: "agent", content: outputText, at: new Date() });

    for (const call of message.toolCall?.functionCalls ?? []) {
      void this.executeToolCall(call);
    }

    // Gemini's own turnComplete already waits for its modeled realtime playback
    // to finish (see LiveServerContent docs); add a short drain margin for the
    // downstream Twilio leg before actually disconnecting.
    if (content?.turnComplete && this.endCallRequested) {
      this.endCallRequested = false;
      setTimeout(() => this.endCall?.(), END_CALL_DRAIN_MS);
    }
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

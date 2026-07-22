import type { CallSession } from "./call-session.js";

export interface TranscriptEvent {
  role: "caller" | "agent" | "system" | "tool";
  content: string;
  at: Date;
}

export interface AIBridge {
  start(session: CallSession): Promise<void>;
  sendAudio(buffer: Buffer): void;
  onAudioOut(callback: (buffer: Buffer) => void): void;
  onToolCall(
    callback: (name: string, input: unknown) => Promise<unknown> | unknown
  ): void;
  onTranscript(callback: (event: TranscriptEvent) => void): void;
  /** Fired when the caller talks over the agent so the channel can flush queued audio. */
  onBargeIn(callback: () => void): void;
  /** Fired when the agent calls end_call after the caller confirms nothing else is needed. */
  onEndCall(callback: () => void): void;
  stop(): Promise<void>;
}

export class StubAIBridge implements AIBridge {
  private audioOut?: (buffer: Buffer) => void;
  private toolCall?: (name: string, input: unknown) => Promise<unknown> | unknown;
  private transcript?: (event: TranscriptEvent) => void;
  private heardTimer?: NodeJS.Timeout;
  private started = false;
  private bargeIn?: () => void;
  private endCall?: () => void;

  // FABLE-TODO: Replace with an Azure gpt-realtime-mini WebSocket bridge using g711_ulaw passthrough, agent.md instructions, and function-calling.
  async start(_session: CallSession): Promise<void> {
    this.started = true;
  }

  sendAudio(_buffer: Buffer): void {
    if (!this.started || this.heardTimer) return;
    this.heardTimer = setTimeout(() => {
      this.transcript?.({
        role: "caller",
        content: "STUB: heard audio",
        at: new Date()
      });
    }, 2_000);
  }

  onAudioOut(callback: (buffer: Buffer) => void): void {
    this.audioOut = callback;
  }

  onToolCall(
    callback: (name: string, input: unknown) => Promise<unknown> | unknown
  ): void {
    this.toolCall = callback;
  }

  onTranscript(callback: (event: TranscriptEvent) => void): void {
    this.transcript = callback;
  }

  onBargeIn(callback: () => void): void {
    this.bargeIn = callback;
  }

  onEndCall(callback: () => void): void {
    this.endCall = callback;
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.heardTimer) clearTimeout(this.heardTimer);
    this.heardTimer = undefined;
    this.audioOut = undefined;
    this.toolCall = undefined;
    this.bargeIn = undefined;
    this.endCall = undefined;
  }
}

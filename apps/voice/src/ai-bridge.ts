import type { CallSession } from "./call-session.js";

export interface TranscriptEvent {
  role: "caller" | "agent" | "system" | "tool";
  content: string;
  at: Date;
}

export interface StaffSelector {
  staffId?: string;
  staffName?: string;
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
  /**
   * Fired when the agent calls transfer_to_staff after the caller explicitly
   * asks for a human. Unlike onEndCall, the call must stay alive — the
   * channel is responsible for redirecting it to the staff member's phone.
   */
  onTransferRequested(callback: (selector: StaffSelector) => void): void;
  /**
   * Reports that a requested transfer could not go through (no matching
   * staff phone on file, or the Twilio redirect itself failed) after the
   * model already committed to transferring. Without this the caller is
   * silently left on the same AI session with no explanation, and the model
   * has no way to know the transfer didn't happen — it will keep treating
   * its own earlier tool results as still valid instead of re-checking.
   */
  notifyTransferFailed(reason: string): void;
  stop(): Promise<void>;
}

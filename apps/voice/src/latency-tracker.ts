export interface VoiceLatencyMetrics {
  callId: string;
  turn: number;
  endpointing_ms?: number;
  stt_ms?: number;
  backend_ms?: number;
  tool_ms?: number;
  llm_first_token_ms?: number;
  tts_first_audio_ms?: number;
  total_first_response_ms: number;
}

export interface LoggerLike {
  info(values: Record<string, unknown>, message: string): void;
  warn?(values: Record<string, unknown>, message: string): void;
  error?(values: Record<string, unknown>, message: string): void;
}

/**
 * Tracks granular conversational turn latency from caller end-of-speech
 * to the first byte of AI-generated audio reaching the telephony layer.
 * Strictly avoids logging PII.
 */
export class VoiceLatencyTracker {
  private turnCounter = 0;
  private currentTurnNumber = 0;
  private turnStartTime = 0;
  private userSpeechEndTime = 0;
  private firstTokenTime = 0;
  private firstAudioTime = 0;
  private sttTime = 0;
  private toolStartTime = 0;
  private toolDurationMs = 0;
  private turnCompleted = false;

  constructor(
    private readonly callId: string,
    private readonly logger?: LoggerLike
  ) {}

  /**
   * Called when incoming user speech begins or is detected.
   */
  onUserSpeechStarted(): void {
    this.turnCompleted = false;
    this.turnCounter += 1;
    this.currentTurnNumber = this.turnCounter;
    this.turnStartTime = performance.now();
    this.userSpeechEndTime = 0;
    this.firstTokenTime = 0;
    this.firstAudioTime = 0;
    this.sttTime = 0;
    this.toolStartTime = 0;
    this.toolDurationMs = 0;
  }

  /**
   * Called when user speech ends (VAD endpoint detected).
   */
  onUserSpeechEnded(timestamp?: number): void {
    const now = timestamp ?? performance.now();
    this.userSpeechEndTime = now;
    if (!this.turnStartTime) {
      this.turnStartTime = now;
    }
  }

  /**
   * Called when caller transcript is finalized / received.
   */
  onCallerTranscriptReceived(): void {
    if (!this.userSpeechEndTime) {
      this.userSpeechEndTime = performance.now();
    }
    this.sttTime = performance.now();
  }

  /**
   * Called when a tool call starts executing.
   */
  onToolStart(): void {
    this.toolStartTime = performance.now();
  }

  /**
   * Called when a tool call finishes executing.
   */
  onToolEnd(): void {
    if (this.toolStartTime > 0) {
      this.toolDurationMs += performance.now() - this.toolStartTime;
      this.toolStartTime = 0;
    }
  }

  /**
   * Called when the first token / text part arrives from the LLM.
   */
  onFirstLlmToken(): void {
    if (!this.firstTokenTime) {
      this.firstTokenTime = performance.now();
    }
  }

  /**
   * Called when the first audio chunk arrives from the TTS / model.
   * Emits the structured VOICE_LATENCY log entry once per turn.
   */
  onFirstAudioChunk(): VoiceLatencyMetrics | null {
    if (this.turnCompleted) return null;
    this.firstAudioTime = performance.now();
    this.turnCompleted = true;

    const baseTime = this.userSpeechEndTime || this.turnStartTime || this.firstAudioTime;
    const totalFirstResponseMs = Math.max(0, Math.round(this.firstAudioTime - baseTime));

    const endpointingMs =
      this.userSpeechEndTime && this.turnStartTime
        ? Math.max(0, Math.round(this.userSpeechEndTime - this.turnStartTime))
        : undefined;

    const sttMs =
      this.sttTime && this.userSpeechEndTime
        ? Math.max(0, Math.round(this.sttTime - this.userSpeechEndTime))
        : undefined;

    const llmFirstTokenMs =
      this.firstTokenTime && this.userSpeechEndTime
        ? Math.max(0, Math.round(this.firstTokenTime - this.userSpeechEndTime))
        : undefined;

    const ttsFirstAudioMs =
      this.firstAudioTime && (this.firstTokenTime || this.userSpeechEndTime)
        ? Math.max(
            0,
            Math.round(this.firstAudioTime - (this.firstTokenTime || this.userSpeechEndTime))
          )
        : undefined;

    const toolMs = this.toolDurationMs > 0 ? Math.round(this.toolDurationMs) : undefined;
    const backendMs = Math.max(0, Math.round(totalFirstResponseMs - (toolMs ?? 0)));

    const metrics: VoiceLatencyMetrics = {
      callId: this.callId,
      turn: this.currentTurnNumber,
      ...(endpointingMs !== undefined ? { endpointing_ms: endpointingMs } : {}),
      ...(sttMs !== undefined ? { stt_ms: sttMs } : {}),
      backend_ms: backendMs,
      ...(toolMs !== undefined ? { tool_ms: toolMs } : {}),
      ...(llmFirstTokenMs !== undefined ? { llm_first_token_ms: llmFirstTokenMs } : {}),
      ...(ttsFirstAudioMs !== undefined ? { tts_first_audio_ms: ttsFirstAudioMs } : {}),
      total_first_response_ms: totalFirstResponseMs
    };

    this.logger?.info(
      {
        voice_latency: metrics
      },
      `VOICE_LATENCY [Turn ${metrics.turn}] total_first_response_ms=${metrics.total_first_response_ms}ms tool_ms=${metrics.tool_ms ?? 0}ms`
    );

    return metrics;
  }

  /**
   * Handles barge-in / cancellation mid-turn.
   */
  onBargeIn(): void {
    if (!this.turnCompleted && this.turnStartTime > 0) {
      const elapsed = Math.round(performance.now() - this.turnStartTime);
      this.logger?.info(
        {
          callId: this.callId,
          turn: this.currentTurnNumber,
          interrupted_after_ms: elapsed
        },
        `VOICE_LATENCY [Turn ${this.currentTurnNumber}] Interrupted by caller after ${elapsed}ms`
      );
    }
    this.turnCompleted = true;
  }
}

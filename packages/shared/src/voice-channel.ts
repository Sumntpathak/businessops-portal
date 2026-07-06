export interface VoiceWebhookRequest {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, string>;
}

export type StreamEvent =
  | { type: "start"; callSid: string; meta?: Record<string, unknown> }
  | { type: "media"; callSid: string; audio: Buffer; meta?: Record<string, unknown> }
  | { type: "stop"; callSid: string; meta?: Record<string, unknown> }
  | { type: "dtmf"; callSid: string; digits: string; meta?: Record<string, unknown> };

export interface VoiceChannelAdapter {
  verifyWebhook(request: VoiceWebhookRequest): boolean;
  answerInstructions(wsUrl: string): string;
  parseStreamEvent(raw: string | Buffer): StreamEvent;
  encodeAudioOut(pcmOrUlaw: Buffer): unknown;
  hangup(callSid: string): Promise<void>;
}

import type {
  StreamEvent,
  VoiceChannelAdapter,
  VoiceWebhookRequest
} from "@recepto/shared";

export class WhatsAppAdapter implements VoiceChannelAdapter {
  // FABLE-TODO: Verify future WhatsApp Calling webhook signatures.
  verifyWebhook(_request: VoiceWebhookRequest): boolean {
    throw new Error("NotImplemented: WhatsApp Calling webhook verification");
  }

  // FABLE-TODO: Return WhatsApp Calling answer instructions when the provider API is available.
  answerInstructions(_wsUrl: string): string {
    throw new Error("NotImplemented: WhatsApp Calling answer instructions");
  }

  // FABLE-TODO: Normalize future WhatsApp Calling media stream events.
  parseStreamEvent(_raw: string | Buffer): StreamEvent {
    throw new Error("NotImplemented: WhatsApp Calling stream parsing");
  }

  // FABLE-TODO: Encode audio for the future WhatsApp Calling media protocol.
  encodeAudioOut(_pcmOrUlaw: Buffer): unknown {
    throw new Error("NotImplemented: WhatsApp Calling audio encoding");
  }

  // FABLE-TODO: End a future WhatsApp Calling call through its provider API.
  async hangup(_callSid: string): Promise<void> {
    throw new Error("NotImplemented: WhatsApp Calling hangup");
  }
}

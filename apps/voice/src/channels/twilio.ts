import twilio from "twilio";
import { z } from "zod";
import type {
  StreamEvent,
  VoiceChannelAdapter,
  VoiceWebhookRequest
} from "@recepto/shared";

const startSchema = z.object({
  event: z.literal("start"),
  streamSid: z.string().min(1),
  start: z.object({
    callSid: z.string().min(1),
    customParameters: z.record(z.string()).optional()
  })
});
const mediaSchema = z.object({
  event: z.literal("media"),
  streamSid: z.string().min(1),
  media: z.object({ payload: z.string().min(1) })
});
const stopSchema = z.object({
  event: z.literal("stop"),
  streamSid: z.string().min(1),
  stop: z.object({ callSid: z.string().min(1) })
});
const dtmfSchema = z.object({
  event: z.literal("dtmf"),
  streamSid: z.string().min(1),
  dtmf: z.object({ digit: z.string().min(1).max(1) })
});

type Validator = (
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
) => boolean;

export interface TwilioAdapterOptions {
  accountSid: string;
  authToken: string;
  validator?: Validator;
  hangup?: (callSid: string) => Promise<void>;
}

export class TwilioAdapter implements VoiceChannelAdapter {
  private readonly validator: Validator;
  private readonly hangupCall: (callSid: string) => Promise<void>;
  private readonly client: ReturnType<typeof twilio>;
  private streamSid?: string;
  private callSid?: string;

  constructor(private readonly options: TwilioAdapterOptions) {
    this.validator = options.validator ?? twilio.validateRequest;
    this.client = twilio(options.accountSid, options.authToken);
    this.hangupCall = options.hangup ?? (async (callSid) => {
      await this.client.calls(callSid).update({ status: "completed" });
    });
  }

  /**
   * Verifies the X-Twilio-Signature header. `authTokenOverride` lets callers verify
   * against a specific tenant's own Twilio Auth Token instead of the adapter's default
   * (the platform account), since each tenant may have connected their own Twilio account.
   */
  verifyWebhook(request: VoiceWebhookRequest, authTokenOverride?: string): boolean {
    const signatureHeader = request.headers["x-twilio-signature"];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;
    if (!signature) return false;

    try {
      return this.validator(
        authTokenOverride ?? this.options.authToken,
        signature,
        request.url,
        request.body
      );
    } catch {
      return false;
    }
  }

  answerInstructions(wsUrl: string): string {
    const response = new twilio.twiml.VoiceResponse();
    response.connect().stream({ url: wsUrl });
    return response.toString();
  }

  unavailableInstructions(message: string): string {
    const response = new twilio.twiml.VoiceResponse();
    response.say({ voice: "alice" }, message);
    response.hangup();
    return response.toString();
  }

  /** Ends the call cleanly with no message — for a transfer that already concluded normally. */
  hangupInstructions(): string {
    const response = new twilio.twiml.VoiceResponse();
    response.hangup();
    return response.toString();
  }

  /**
   * TwiML that connects the live call to a staff member's phone. Twilio's
   * `<Dial record="...">` has no documented automatic consent beep (unlike
   * `<Record>`'s `playBeep`), so when recording is enabled we say an explicit
   * consent line ourselves rather than relying on a Twilio default.
   */
  transferInstructions(
    staffPhoneE164: string,
    options: { record: boolean; actionUrl: string; recordingStatusCallbackUrl?: string }
  ): string {
    const response = new twilio.twiml.VoiceResponse();
    if (options.record) {
      response.say(
        { voice: "alice" },
        "This call may be recorded for quality and compliance purposes."
      );
    }
    response
      .dial({
        action: options.actionUrl,
        method: "POST",
        record: options.record ? "record-from-answer-dual" : "do-not-record",
        recordingStatusCallback: options.recordingStatusCallbackUrl,
        recordingStatusCallbackMethod: options.recordingStatusCallbackUrl ? "POST" : undefined
      })
      .number(staffPhoneE164);
    return response.toString();
  }

  /** Redirects an in-progress call to new TwiML (e.g. transferInstructions). */
  async transferCall(callSid: string, redirectUrl: string): Promise<void> {
    await this.client.calls(callSid).update({ url: redirectUrl, method: "POST" });
  }

  parseStreamEvent(raw: string | Buffer): StreamEvent {
    const value = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw) as unknown;
    const event = z.object({ event: z.string() }).parse(value).event;

    if (event === "start") {
      const parsed = startSchema.parse(value);
      this.streamSid = parsed.streamSid;
      this.callSid = parsed.start.callSid;
      return {
        type: "start",
        callSid: parsed.start.callSid,
        meta: {
          streamSid: parsed.streamSid,
          customParameters: parsed.start.customParameters ?? {}
        }
      };
    }

    if (event === "media") {
      const parsed = mediaSchema.parse(value);
      if (!this.callSid) throw new Error("Twilio media arrived before start");
      return {
        type: "media",
        callSid: this.callSid,
        audio: Buffer.from(parsed.media.payload, "base64"),
        meta: { streamSid: parsed.streamSid }
      };
    }

    if (event === "dtmf") {
      const parsed = dtmfSchema.parse(value);
      if (!this.callSid) throw new Error("Twilio DTMF arrived before start");
      return {
        type: "dtmf",
        callSid: this.callSid,
        digits: parsed.dtmf.digit,
        meta: { streamSid: parsed.streamSid }
      };
    }

    if (event === "stop") {
      const parsed = stopSchema.parse(value);
      this.streamSid = parsed.streamSid;
      this.callSid = parsed.stop.callSid;
      return {
        type: "stop",
        callSid: parsed.stop.callSid,
        meta: { streamSid: parsed.streamSid }
      };
    }

    throw new Error("Unsupported Twilio stream event: " + event);
  }

  encodeAudioOut(pcmOrUlaw: Buffer): unknown {
    if (!this.streamSid) throw new Error("Twilio stream has not started");
    return {
      event: "media",
      streamSid: this.streamSid,
      media: { payload: pcmOrUlaw.toString("base64") }
    };
  }

  encodeClear(): unknown {
    if (!this.streamSid) throw new Error("Twilio stream has not started");
    return { event: "clear", streamSid: this.streamSid };
  }

  async hangup(callSid: string): Promise<void> {
    await this.hangupCall(callSid);
  }
}

import crypto from "node:crypto";
import { z } from "zod";

/** Max allowed clock skew between the webhook timestamp and now. */
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export const incomingCallEventSchema = z.object({
  object: z.literal("event"),
  id: z.string().min(1),
  type: z.string().min(1),
  data: z
    .object({
      call_id: z.string().min(1),
      sip_headers: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .default([])
    })
    .optional()
});

export type IncomingCallEvent = z.infer<typeof incomingCallEventSchema>;

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Verifies a Standard Webhooks signature (used by the Azure OpenAI Webhook
 * Service): HMAC-SHA256 of "{id}.{timestamp}.{body}" with the base64 secret.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string
): boolean {
  const id = headerValue(headers, "webhook-id");
  const timestamp = headerValue(headers, "webhook-timestamp");
  const signatureHeader = headerValue(headers, "webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const skew = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (skew > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;

  const signedContent = `${id}.${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", key)
    .update(signedContent)
    .digest();

  // Header holds space-separated "v1,<base64sig>" entries; any match passes.
  for (const candidate of signatureHeader.split(" ")) {
    const [version, encoded] = candidate.split(",", 2);
    if (version !== "v1" || !encoded) continue;
    let provided: Buffer;
    try {
      provided = Buffer.from(encoded, "base64");
    } catch {
      continue;
    }
    if (
      provided.length === expected.length &&
      crypto.timingSafeEqual(provided, expected)
    ) {
      return true;
    }
  }
  return false;
}

/** Extracts "+18005551212" from a SIP header value like "sip:+18005551212@host". */
export function phoneFromSipHeader(value: string | undefined): string | null {
  if (!value) return null;
  const match = /(?:sips?:)?(\+[1-9]\d{7,14})@/.exec(value) ?? /(\+[1-9]\d{7,14})/.exec(value);
  return match?.[1] ?? null;
}

export function sipHeader(
  event: IncomingCallEvent,
  name: string
): string | undefined {
  return event.data?.sip_headers.find(
    (header) => header.name.toLowerCase() === name.toLowerCase()
  )?.value;
}

export interface AzureSipClientOptions {
  /** The realtime endpoint from env, e.g. https://<res>.cognitiveservices.azure.com/openai/v1/realtime */
  realtimeUrl: string;
  apiKey: string;
}

/** REST control plane for SIP calls: accept, reject, refer, hang up. */
export class AzureSipClient {
  private readonly baseUrl: string;

  constructor(private readonly options: AzureSipClientOptions) {
    const origin = new URL(options.realtimeUrl).origin;
    this.baseUrl = origin + "/openai/v1/realtime/calls/";
  }

  private async post(
    callId: string,
    action: string,
    body?: Record<string, unknown>
  ): Promise<void> {
    const response = await fetch(
      this.baseUrl + encodeURIComponent(callId) + "/" + action,
      {
        method: "POST",
        headers: {
          "api-key": this.options.apiKey,
          "Content-Type": "application/json"
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      }
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Azure SIP ${action} failed with HTTP ${response.status}: ${detail.slice(0, 300)}`
      );
    }
  }

  /** Accepts the inbound call with the full realtime session configuration. */
  async accept(callId: string, sessionConfig: Record<string, unknown>): Promise<void> {
    await this.post(callId, "accept", sessionConfig);
  }

  /** Declines the call; statusCode is the SIP response sent to the carrier. */
  async reject(callId: string, statusCode?: number): Promise<void> {
    await this.post(callId, "reject", statusCode ? { status_code: statusCode } : {});
  }

  /** Transfers the call, e.g. to "tel:+14155550123". */
  async refer(callId: string, targetUri: string): Promise<void> {
    await this.post(callId, "refer", { target_uri: targetUri });
  }

  async hangup(callId: string): Promise<void> {
    await this.post(callId, "hangup");
  }
}

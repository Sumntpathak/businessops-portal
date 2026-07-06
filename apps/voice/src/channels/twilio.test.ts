import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TwilioAdapter } from "./twilio.js";

const options = {
  accountSid: "AC11111111111111111111111111111111",
  authToken: "test-token",
  validator: (_token: string, signature: string, url: string, params: Record<string, string>) =>
    signature === "valid" && url.endsWith("/twilio/incoming") && params.CallSid === "CA123",
  hangup: async (_callSid: string) => undefined
};

describe("TwilioAdapter", () => {
  it("verifies a form webhook against the exact URL and parsed parameters", () => {
    const adapter = new TwilioAdapter(options);
    assert.equal(adapter.verifyWebhook({
      url: "https://voice.example.com/twilio/incoming",
      headers: { "x-twilio-signature": "valid" },
      body: { CallSid: "CA123" }
    }), true);
    assert.equal(adapter.verifyWebhook({
      url: "https://voice.example.com/twilio/incoming",
      headers: {},
      body: { CallSid: "CA123" }
    }), false);
  });

  it("produces bidirectional Connect Stream TwiML", () => {
    const xml = new TwilioAdapter(options).answerInstructions(
      "wss://voice.example.com/media/018f5f86-9cf1-7f4d-81d2-6f11a3e841f3"
    );
    assert.match(xml, /<Connect>/);
    assert.match(xml, /<Stream url="wss:\/\/voice\.example\.com\/media\//);
  });

  it("normalizes start, media, dtmf, and stop events and frames outbound audio", () => {
    const adapter = new TwilioAdapter(options);
    assert.deepEqual(adapter.parseStreamEvent(JSON.stringify({
      event: "start",
      streamSid: "MZ123",
      start: { callSid: "CA123", customParameters: { source: "test" } }
    })), {
      type: "start",
      callSid: "CA123",
      meta: { streamSid: "MZ123", customParameters: { source: "test" } }
    });
    assert.deepEqual(adapter.parseStreamEvent(JSON.stringify({
      event: "media",
      streamSid: "MZ123",
      media: { payload: Buffer.from("audio").toString("base64") }
    })), {
      type: "media",
      callSid: "CA123",
      audio: Buffer.from("audio"),
      meta: { streamSid: "MZ123" }
    });
    assert.equal(adapter.parseStreamEvent(JSON.stringify({
      event: "dtmf", streamSid: "MZ123", dtmf: { digit: "7" }
    })).digits, "7");
    assert.equal(adapter.parseStreamEvent(JSON.stringify({
      event: "stop", streamSid: "MZ123", stop: { callSid: "CA123" }
    })).type, "stop");
    assert.deepEqual(adapter.encodeAudioOut(Buffer.from("reply")), {
      event: "media",
      streamSid: "MZ123",
      media: { payload: Buffer.from("reply").toString("base64") }
    });
  });
});

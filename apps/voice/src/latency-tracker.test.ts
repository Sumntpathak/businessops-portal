import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VoiceLatencyTracker } from "./latency-tracker.js";

describe("VoiceLatencyTracker", () => {
  it("tracks turn timings and calculates total_first_response_ms", async () => {
    const logs: Array<{ values: Record<string, unknown>; message: string }> = [];
    const mockLogger = {
      info(values: Record<string, unknown>, message: string) {
        logs.push({ values, message });
      }
    };

    const tracker = new VoiceLatencyTracker("test-call-123", mockLogger);

    tracker.onUserSpeechStarted();
    tracker.onUserSpeechEnded();
    tracker.onCallerTranscriptReceived();
    tracker.onToolStart();
    await new Promise((resolve) => setTimeout(resolve, 20));
    tracker.onToolEnd();
    tracker.onFirstLlmToken();
    const metrics = tracker.onFirstAudioChunk();

    assert.ok(metrics !== null, "metrics should be emitted");
    assert.equal(metrics.callId, "test-call-123");
    assert.equal(metrics.turn, 1);
    assert.ok(typeof metrics.total_first_response_ms === "number");
    assert.ok(metrics.total_first_response_ms >= 0);
    assert.ok(typeof metrics.backend_ms === "number");
    assert.ok(metrics.tool_ms !== undefined && metrics.tool_ms >= 15);

    // Verify structured log emission
    assert.equal(logs.length, 1);
    assert.ok(logs[0]?.message.includes("VOICE_LATENCY [Turn 1]"));
    assert.ok(logs[0]?.values.voice_latency);
  });

  it("handles barge-in interruption cleanly", () => {
    const logs: Array<{ values: Record<string, unknown>; message: string }> = [];
    const mockLogger = {
      info(values: Record<string, unknown>, message: string) {
        logs.push({ values, message });
      }
    };

    const tracker = new VoiceLatencyTracker("test-call-bargein", mockLogger);
    tracker.onUserSpeechStarted();
    tracker.onBargeIn();

    assert.equal(logs.length, 1);
    assert.ok(logs[0]?.message.includes("Interrupted by caller"));
  });

  it("does not log PII (caller name, phone, transcript content)", () => {
    const logs: Array<{ values: Record<string, unknown>; message: string }> = [];
    const mockLogger = {
      info(values: Record<string, unknown>, message: string) {
        logs.push({ values, message });
      }
    };

    const tracker = new VoiceLatencyTracker("call-no-pii", mockLogger);
    tracker.onUserSpeechStarted();
    tracker.onUserSpeechEnded();
    tracker.onFirstAudioChunk();

    const loggedString = JSON.stringify(logs);
    assert.ok(!loggedString.includes("John Doe"));
    assert.ok(!loggedString.includes("+1555"));
  });
});

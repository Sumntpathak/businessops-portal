import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  AzureRealtimeBridge,
  buildSessionConfig,
  buildSipAcceptConfig,
  isJunkTurn,
  isTranscriptionArtifact
} from "./azure-realtime-bridge.js";
import type { CallSession } from "./call-session.js";

const session: CallSession = {
  callId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f3",
  providerCallSid: "CA123",
  tenantId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f4",
  timezone: "Australia/Melbourne",
  caller: {
    id: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f5",
    phoneE164: "+919876543210",
    displayName: "Sumant",
    country: "India",
    timezone: "Asia/Kolkata",
    profile: { service_interest: "Student visa" },
    stage: "interested"
  },
  intakeFields: [
    { id: "f1", key: "service_interest", label: "Service interest", type: "text", options: [], priority: "key", sort: 10, active: true },
    { id: "f2", key: "target_date", label: "Target date", type: "text", options: [], priority: "key", sort: 20, active: true }
  ],
  agent: { agentMd: "# Holistic", voiceGreeting: "Hello", languageMode: "english", languages: ["English"] },
  services: [{ name: "Consultation", durationMinutes: 30, price: "110.00" }],
  memories: [],
  startedAt: "2026-07-06T04:00:00.000Z"
};

describe("buildSessionConfig", () => {
  it("formats session parameters with type realtime and audio input/output blocks", () => {
    const config = buildSessionConfig(session, "alloy");
    assert.equal(config.type, "realtime");
    assert.deepEqual(config.audio, {
      input: {
        format: { type: "audio/pcmu" },
        noise_reduction: { type: "near_field" },
        transcription: { model: "whisper-1", language: "en" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.75,
          prefix_padding_ms: 250,
          silence_duration_ms: 450,
          interrupt_response: false,
          create_response: false
        }
      },
      output: {
        format: { type: "audio/pcmu" },
        voice: "alloy"
      }
    });
    assert.equal(config.tool_choice, "auto");
    assert.ok(Array.isArray(config.tools) && config.tools.length > 0);
  });

  it("disables Azure's auto-created response since this mode manually creates one on speech_stopped", () => {
    const config = buildSessionConfig(session, "alloy") as {
      audio: { input: { turn_detection: { create_response: boolean } } };
    };
    assert.equal(config.audio.input.turn_detection.create_response, false);
  });
});

describe("buildSipAcceptConfig", () => {
  it("formats SIP accept payload with Azure SIP audio.input and audio.output blocks", () => {
    const config = buildSipAcceptConfig(session, "gpt-realtime-mini", "shimmer");
    assert.equal(config.type, "realtime");
    assert.equal(config.model, "gpt-realtime-mini");
    assert.deepEqual(config.audio, {
      input: {
        format: { type: "audio/pcmu" },
        noise_reduction: { type: "near_field" },
        transcription: { model: "whisper-1", language: "en" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.75,
          prefix_padding_ms: 250,
          silence_duration_ms: 450
        }
      },
      output: {
        format: { type: "audio/pcmu" },
        voice: "shimmer"
      }
    });
    assert.equal(config.tool_choice, "auto");
    assert.ok(Array.isArray(config.tools) && config.tools.length > 0);
  });
});

describe("gpt-realtime-2.x tuning", () => {
  const audioInput = (config: Record<string, unknown>) =>
    (config.audio as { input: { transcription: { model: string } } }).input;

  it("omits reasoning and keeps whisper-1 when no tuning is given, so older deployments are unaffected", () => {
    for (const config of [buildSessionConfig(session, "alloy"), buildSipAcceptConfig(session, "m", "alloy")]) {
      assert.equal("reasoning" in config, false);
      assert.equal(audioInput(config).transcription.model, "whisper-1");
    }
  });

  it("adds reasoning.effort and the chosen transcription model to both session paths", () => {
    const tuning = { reasoningEffort: "low" as const, transcribeModel: "gpt-4o-mini-transcribe" };
    for (const config of [buildSessionConfig(session, "alloy", tuning), buildSipAcceptConfig(session, "m", "alloy", tuning)]) {
      assert.deepEqual(config.reasoning, { effort: "low" });
      assert.equal(audioInput(config).transcription.model, "gpt-4o-mini-transcribe");
    }
  });
});

describe("isTranscriptionArtifact", () => {
  it("flags stock silence hallucinations and prompt echoes", () => {
    for (const text of [
      "Thanks for watching",
      "Thank you for watching!",
      "Please like, share and subscribe to my channel.",
      "Always transcribe in the language actually spoken, using its standard script.",
      "Never transcribe into any other language."
    ]) {
      assert.equal(isTranscriptionArtifact(text), true, text);
    }
  });

  it("keeps genuine caller speech, including a plain thank you", () => {
    for (const text of ["Thank you.", "I want to book a consultation", "Can I speak to a human?", "My name is Ritika"]) {
      assert.equal(isTranscriptionArtifact(text), false, text);
    }
  });
});

function bridgeWithFakeSocket(sessionOverride: Partial<CallSession> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const bridge = new AzureRealtimeBridge({ url: "https://x.openai.azure.com/openai/v1/realtime", apiKey: "k", model: "m" });
  const internals = bridge as unknown as Record<string, unknown>;
  internals.socket = { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) };
  internals.session = { ...session, ...sessionOverride };
  const handle = (event: Record<string, unknown>) =>
    (internals.handleServerEvent as (e: unknown) => void).call(bridge, event);
  return { bridge, internals, sent, handle };
}

const holdMessageResponse = (extra: Array<Record<string, unknown>> = []) => ({
  type: "response.done",
  response: {
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ transcript: "Sure, I'll put you through now. Please stay on the line." }]
      },
      ...extra
    ]
  }
});

describe("transfer nudge", () => {
  it("reminds the agent to call transfer_to_staff when it only spoke the hold message", () => {
    const { sent, handle } = bridgeWithFakeSocket();
    handle(holdMessageResponse());
    assert.ok(sent.some((e) => e.type === "response.create"));
    const nudge = JSON.stringify(sent.find((e) => e.type === "conversation.item.create"));
    assert.match(nudge, /did not call transfer_to_staff/);
    const forced = sent.find((e) => e.type === "response.create") as { response?: { tool_choice?: unknown } };
    assert.deepEqual(forced.response?.tool_choice, { type: "function", name: "transfer_to_staff" });
  });

  it("catches the transfer promise however the agent words it", () => {
    for (const line of [
      "Sure, I’ll connect you to someone who can assist with that. Please hold on while I transfer you. It might ring for a few seconds.",
      "Understood, I’m starting the transfer now. Please hold on, and it’ll ring shortly. I’m transferring you to Lara now.",
      "Sure, I'll put you through to one of our consultants now."
    ]) {
      const { sent, handle } = bridgeWithFakeSocket();
      handle({
        type: "response.done",
        response: { status: "completed", output: [{ type: "message", content: [{ transcript: line }] }] }
      });
      assert.ok(sent.some((e) => e.type === "response.create"), `should nudge for: ${line}`);
    }
  });

  it("does not nudge for a plain hold-on while checking availability", () => {
    const { sent, handle } = bridgeWithFakeSocket();
    handle({
      type: "response.done",
      response: {
        status: "completed",
        output: [{ type: "message", content: [{ transcript: "Sure, hold on a second while I check the calendar." }] }]
      }
    });
    assert.equal(sent.length, 0);
  });

  it("does not nudge when the transfer tool was called, transfer is unavailable, or after two nudges", () => {
    const called = bridgeWithFakeSocket();
    called.handle(holdMessageResponse([{ type: "function_call", name: "transfer_to_staff", call_id: "c1", arguments: "{}" }]));
    assert.equal(called.sent.filter((e) => e.type === "response.create").length, 0);

    const unavailable = bridgeWithFakeSocket({ transferAvailable: false });
    unavailable.handle(holdMessageResponse());
    assert.equal(unavailable.sent.length, 0);

    const capped = bridgeWithFakeSocket();
    for (let i = 0; i < 4; i += 1) capped.handle(holdMessageResponse());
    assert.equal(capped.sent.filter((e) => e.type === "response.create").length, 2);
  });
});

describe("transfer waits for the agent line to finish playing", () => {
  it("redirects only after the queued audio has played out", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { bridge, internals, handle } = bridgeWithFakeSocket();
      let transferred = false;
      bridge.onTransferRequested(() => {
        transferred = true;
      });
      // 8000 bytes of mu-law at 8 kHz = exactly 1000 ms of speech.
      handle({ type: "response.output_audio.delta", delta: Buffer.alloc(8000).toString("base64") });
      internals.pendingTransfer = {};
      handle({ type: "response.done", response: { status: "completed", output: [] } });

      mock.timers.tick(1000);
      assert.equal(transferred, false, "still playing the last 600 ms of padding");
      mock.timers.tick(600);
      assert.equal(transferred, true);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("isJunkTurn", () => {
  it("treats empty text, lone characters, filler sounds and silence hallucinations as noise", () => {
    for (const text of ["", " . ", "ए", "आ", "uh", "Um...", "hmm", "हम्म", "Thanks for watching"]) {
      assert.equal(isJunkTurn(text), true, JSON.stringify(text));
    }
  });

  it("keeps real short words and sentences", () => {
    for (const text of ["yes", "No", "ok", "hi", "haan", "वह", "Can I speak to someone?"]) {
      assert.equal(isJunkTurn(text), false, text);
    }
  });
});

describe("interruptions tell the model what the caller actually heard", () => {
  const audioDelta = (ms: number) => ({
    type: "response.output_audio.delta",
    item_id: "item_1",
    content_index: 0,
    delta: Buffer.alloc(ms * 8).toString("base64")
  });

  it("truncates the playing item at the point the caller interrupted", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { sent, handle } = bridgeWithFakeSocket();
      handle(audioDelta(2000));
      mock.timers.tick(700);
      handle({ type: "input_audio_buffer.speech_started" });
      mock.timers.tick(300);
      const truncate = sent.find((e) => e.type === "conversation.item.truncate");
      assert.deepEqual(truncate, { type: "conversation.item.truncate", item_id: "item_1", content_index: 0, audio_end_ms: 700 });
    } finally {
      mock.timers.reset();
    }
  });

  it("does not truncate when the agent is not speaking", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { sent, handle } = bridgeWithFakeSocket();
      handle({ type: "input_audio_buffer.speech_started" });
      mock.timers.tick(300);
      assert.equal(sent.some((e) => e.type === "conversation.item.truncate"), false);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("very short caller turns", () => {
  const started = () => {
    const fake = bridgeWithFakeSocket();
    fake.internals.ready = true;
    return fake;
  };
  const responses = (sent: Array<Record<string, unknown>>) => sent.filter((e) => e.type === "response.create").length;
  const transcript = (text: string) => ({ type: "conversation.item.input_audio_transcription.completed", transcript: text });

  it("does not answer a short noise-like turn", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { sent, handle } = started();
      handle({ type: "input_audio_buffer.speech_started" });
      mock.timers.tick(400);
      handle({ type: "input_audio_buffer.speech_stopped" });
      assert.equal(responses(sent), 0, "waits for the transcript first");
      handle(transcript("ए"));
      mock.timers.tick(2000);
      assert.equal(responses(sent), 0, "noise is never answered");
    } finally {
      mock.timers.reset();
    }
  });

  it("answers a short real turn as soon as its transcript arrives", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { sent, handle } = started();
      handle({ type: "input_audio_buffer.speech_started" });
      mock.timers.tick(400);
      handle({ type: "input_audio_buffer.speech_stopped" });
      handle(transcript("Yes"));
      assert.equal(responses(sent), 1);
    } finally {
      mock.timers.reset();
    }
  });

  it("answers anyway when the transcript is slow, and answers long turns immediately", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const slow = started();
      slow.handle({ type: "input_audio_buffer.speech_started" });
      mock.timers.tick(400);
      slow.handle({ type: "input_audio_buffer.speech_stopped" });
      mock.timers.tick(800);
      assert.equal(responses(slow.sent), 1);

      const long = started();
      long.handle({ type: "input_audio_buffer.speech_started" });
      mock.timers.tick(1500);
      long.handle({ type: "input_audio_buffer.speech_stopped" });
      assert.equal(responses(long.sent), 1);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("rate-limited responses", () => {
  const rateLimited = {
    type: "response.done",
    response: { status: "failed", status_details: { type: "failed", error: { code: "inference_rate_limit_exceeded" } }, output: [] }
  };

  it("retries a response that Azure failed with a rate limit, at most three times", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { sent, handle } = bridgeWithFakeSocket();
      for (let i = 0; i < 5; i += 1) {
        handle(rateLimited);
        mock.timers.tick(1500);
      }
      assert.equal(sent.filter((e) => e.type === "response.create").length, 3);
    } finally {
      mock.timers.reset();
    }
  });
});

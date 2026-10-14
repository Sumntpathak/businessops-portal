import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  AzureRealtimeBridge,
  buildSessionConfig,
  buildSipAcceptConfig,
  greetingInstruction,
  isTranscriptionArtifact,
  REALTIME_TOOLS,
  transcriptionConfig,
  transcriptionVocabulary,
  type AzureRealtimeBridgeOptions
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
    profile: {},
    stage: "interested"
  },
  intakeFields: [],
  agent: { agentMd: "# Holistic", voiceGreeting: "Hello", languageMode: "english", languages: ["English"] },
  services: [{ name: "Consultation", durationMinutes: 30, price: "110.00" }],
  memories: [],
  history: { upcomingBookings: [], pendingCallbacks: [], lastCallAt: null },
  startedAt: "2026-07-06T04:00:00.000Z"
};

type Input = { turn_detection: Record<string, unknown>; transcription?: { model: string }; format: unknown };
const inputOf = (config: Record<string, unknown>) => (config.audio as { input: Input }).input;

function bridgeWithFakeSocket(options: Partial<AzureRealtimeBridgeOptions> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const bridge = new AzureRealtimeBridge({ url: "https://x.openai.azure.com/openai/v1/realtime", apiKey: "k", model: "m", ...options });
  const internals = bridge as unknown as Record<string, unknown>;
  internals.socket = { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) };
  internals.session = session;
  const handle = (event: Record<string, unknown>) =>
    (internals.handleServerEvent as (e: unknown) => void).call(bridge, event);
  const callTool = async (name: string, args: Record<string, unknown> = {}, callId = `call_${name}`) => {
    handle({ type: "response.function_call_arguments.done", call_id: callId, name, arguments: JSON.stringify(args) });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  const creates = () => sent.filter((e) => e.type === "response.create").length;
  return { bridge, internals, sent, handle, callTool, creates };
}

const audioDelta = (ms: number) => ({
  type: "response.output_audio.delta",
  item_id: "item_1",
  content_index: 0,
  delta: Buffer.alloc(ms * 8).toString("base64")
});

describe("session config", () => {
  it("lets Azure run turn-taking: server VAD with its default reply and interruption handling", () => {
    const input = inputOf(buildSessionConfig(session));
    assert.equal(input.turn_detection.type, "server_vad");
    assert.equal(input.turn_detection.threshold, 0.55);
    assert.equal(input.turn_detection.silence_duration_ms, 1000);
    assert.equal("create_response" in input.turn_detection, false);
    assert.equal("interrupt_response" in input.turn_detection, false);
    assert.deepEqual(input.format, { type: "audio/pcmu" });
  });

  it("uses the same session on the SIP path, plus the model", () => {
    const sip = buildSipAcceptConfig(session, "gpt-realtime-mini");
    assert.equal(sip.model, "gpt-realtime-mini");
    assert.deepEqual(inputOf(sip), inputOf(buildSessionConfig(session)));
  });

  it("adds reasoning effort only when set, and transcription unless switched off", () => {
    assert.equal("reasoning" in buildSessionConfig(session), false);
    assert.deepEqual(buildSessionConfig(session, undefined, { reasoningEffort: "low" }).reasoning, { effort: "low" });
    assert.equal(inputOf(buildSessionConfig(session)).transcription?.model, "whisper-1");
    assert.equal(inputOf(buildSessionConfig(session, undefined, { transcribeModel: "gpt-4o-mini-transcribe" })).transcription?.model, "gpt-4o-mini-transcribe");
    assert.equal("transcription" in inputOf(buildSessionConfig(session, undefined, { transcribeModel: "off" })), false);
    assert.equal("transcription" in inputOf(buildSipAcceptConfig(session, "m", undefined, { transcribeModel: "off" })), false);
  });

  it("offers only the booking, callback, save-details, transfer and hang-up tools", () => {
    assert.deepEqual(REALTIME_TOOLS.map((tool) => tool.name), ["check_availability", "create_booking", "request_callback", "update_caller_profile", "transfer_to_staff", "end_call"]);
  });

  it("requires a fields object when saving caller details", () => {
    const tool = REALTIME_TOOLS.find((entry) => entry.name === "update_caller_profile");
    assert.deepEqual(tool?.parameters.required, ["fields", "callerLanguage"]);
  });
});

describe("greeting", () => {
  it("asks a known caller to confirm their name and says nothing extra to a new caller", () => {
    assert.match(greetingInstruction("Hello", "Sumant"), /Am I speaking with Sumant\?/);
    assert.match(greetingInstruction("Hello", null), /Say nothing before or after it/);
  });
});

describe("interruptions", () => {
  it("flushes the phone leg and tells the model how much the caller heard", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { bridge, sent, handle } = bridgeWithFakeSocket();
      let flushed = false;
      bridge.onBargeIn(() => { flushed = true; });
      handle(audioDelta(2000));
      mock.timers.tick(700);
      handle({ type: "input_audio_buffer.speech_started" });
      assert.equal(flushed, true);
      assert.deepEqual(sent.find((e) => e.type === "conversation.item.truncate"), {
        type: "conversation.item.truncate", item_id: "item_1", content_index: 0, audio_end_ms: 700
      });
      assert.equal(sent.some((e) => e.type === "response.cancel"), false, "Azure cancels its own reply");
    } finally {
      mock.timers.reset();
    }
  });

  it("does not truncate when nothing is playing", () => {
    const { sent, handle } = bridgeWithFakeSocket();
    handle({ type: "input_audio_buffer.speech_started" });
    assert.equal(sent.some((e) => e.type === "conversation.item.truncate"), false);
  });
});

describe("tool results", () => {
  it("returns the result and asks for one reply", async () => {
    const { bridge, sent, callTool, creates } = bridgeWithFakeSocket();
    bridge.onToolCall(() => ({ slots: [] }));
    await callTool("check_availability", { date: "2026-10-05" });
    assert.ok(sent.some((e) => e.type === "conversation.item.create" && (e.item as { type: string }).type === "function_call_output"));
    assert.equal(creates(), 1);
  });

  it("waits for a reply in progress to finish instead of colliding with it", async () => {
    const { bridge, handle, callTool, creates } = bridgeWithFakeSocket();
    bridge.onToolCall(() => ({ recorded: true }));
    handle({ type: "response.created" });
    await callTool("request_callback", { reason: "visa" });
    assert.equal(creates(), 0);
    handle({ type: "response.done", response: { status: "completed", output: [] } });
    assert.equal(creates(), 1);
  });

  it("retries the follow-up when Azure says a reply is already active", async () => {
    const { bridge, handle, callTool, creates } = bridgeWithFakeSocket();
    bridge.onToolCall(() => ({ slots: [] }));
    await callTool("check_availability", { date: "2026-10-05" });
    handle({ type: "error", error: { code: "conversation_already_has_active_response" } });
    handle({ type: "response.done", response: { status: "completed", output: [] } });
    assert.equal(creates(), 2);
  });

  it("does not speak twice when a detail is saved during a reply that already spoke", async () => {
    const { bridge, handle, callTool, creates } = bridgeWithFakeSocket();
    bridge.onToolCall(() => ({ updated: ["name"], rejected: [] }));
    handle({ type: "response.created" });
    await callTool("update_caller_profile", { fields: { name: "Ravi" } });
    handle({ type: "response.done", response: { status: "completed", output: [{ type: "message" }, { type: "function_call" }] } });
    assert.equal(creates(), 0);
  });

  it("speaks after a save when the reply that saved it said nothing", async () => {
    const { bridge, handle, callTool, creates } = bridgeWithFakeSocket();
    bridge.onToolCall(() => ({ updated: ["name"], rejected: [] }));
    handle({ type: "response.created" });
    await callTool("update_caller_profile", { fields: { name: "Ravi" } });
    handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call" }] } });
    assert.equal(creates(), 1);
  });

  it("does not speak again when a save finishes after a spoken reply has ended", async () => {
    const { bridge, handle, callTool, creates } = bridgeWithFakeSocket();
    bridge.onToolCall(() => ({ updated: ["enquiry"], rejected: [] }));
    handle({ type: "response.created" });
    handle({ type: "response.done", response: { status: "completed", output: [{ type: "message" }] } });
    await callTool("update_caller_profile", { fields: { enquiry: "partner visa" } });
    assert.equal(creates(), 0);
  });

  it("asks for exactly one reply when a silent save and another tool share a reply", async () => {
    const { bridge, handle, callTool, creates } = bridgeWithFakeSocket();
    bridge.onToolCall((name) => (name === "update_caller_profile" ? { updated: ["name"], rejected: [] } : { slots: [] }));
    handle({ type: "response.created" });
    await callTool("update_caller_profile", { fields: { name: "Ravi" } }, "c1");
    await callTool("check_availability", { date: "2026-10-20" }, "c2");
    handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call" }, { type: "function_call" }] } });
    assert.equal(creates(), 1);
    handle({ type: "response.done", response: { status: "completed", output: [{ type: "message" }] } });
    assert.equal(creates(), 1, "no extra reply after the follow-up");
  });

  it("only says goodbye when a silent save comes with end_call", async () => {
    const { bridge, sent, handle, callTool, creates } = bridgeWithFakeSocket();
    bridge.onToolCall(() => ({ updated: ["name"], rejected: [] }));
    handle({ type: "response.created" });
    await callTool("update_caller_profile", { fields: { name: "Ravi" } }, "c1");
    await callTool("end_call", {}, "c2");
    handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call" }, { type: "function_call" }] } });
    assert.equal(creates(), 1);
    assert.deepEqual(sent.filter((e) => e.type === "response.create").at(-1), { type: "response.create", response: { tool_choice: "none" } });
  });

  it("tells the model where the call has got to, once per step", async () => {
    const { bridge, sent, callTool } = bridgeWithFakeSocket();
    bridge.onToolCall((name) => (name === "update_caller_profile" ? { updated: ["name"], rejected: [] } : { slots: [] }));
    const notes = () => sent.filter((e) => JSON.stringify(e).includes("Call progress")).length;
    await callTool("update_caller_profile", { fields: { name: "Ravi" } }, "c1");
    assert.equal(notes(), 1);
    await callTool("update_caller_profile", { fields: { name: "Ravi" } }, "c2");
    assert.equal(notes(), 1, "same step, no repeat");
    await callTool("check_availability", { date: "2026-10-20" }, "c3");
    assert.equal(notes(), 2);
    assert.ok(sent.some((e) => JSON.stringify(e).includes("team confirms payment")));
  });

  it("returns a tool error to the model instead of failing the call", async () => {
    const { bridge, sent, callTool } = bridgeWithFakeSocket();
    bridge.onToolCall(() => { throw new Error("calendar down"); });
    await callTool("create_booking", { serviceId: "s", startsAt: "x" });
    const output = sent.find((e) => (e.item as { type?: string } | undefined)?.type === "function_call_output");
    assert.match(String((output?.item as { output: string }).output), /calendar down/);
  });
});

describe("transfer", () => {
  it("refuses an unknown person with the people it can offer, and does not redirect", async () => {
    const { bridge, sent, callTool, creates } = bridgeWithFakeSocket({
      resolveTransfer: async () => ({ ok: false, reason: 'no team member matching "Ramlal"', available: ["Gundeep Malhotra"] })
    });
    let transferred = false;
    bridge.onTransferRequested(() => { transferred = true; });
    await callTool("transfer_to_staff", { staffName: "Ramlal" });
    const output = JSON.parse(String((sent.find((e) => (e.item as { type?: string } | undefined)?.type === "function_call_output")?.item as { output: string }).output));
    assert.equal(output.transferring, false);
    assert.deepEqual(output.teamMembersYouCanOffer, ["Gundeep Malhotra"]);
    assert.equal(creates(), 1);
    assert.equal(transferred, false);
  });

  it("blocks the transfer when the caller's own words say no, even if the model went ahead", async () => {
    let checked = false;
    const { bridge, sent, callTool, creates } = bridgeWithFakeSocket({ resolveTransfer: async () => { checked = true; return { ok: true }; } });
    let transferred = false;
    bridge.onTransferRequested(() => { transferred = true; });
    await callTool("transfer_to_staff", { staffName: "Gundeep Malhotra", callerWords: "not now" });
    const output = JSON.parse(String((sent.find((e) => (e.item as { type?: string } | undefined)?.type === "function_call_output")?.item as { output: string }).output));
    assert.equal(output.transferring, false);
    assert.match(output.reason, /not now/);
    assert.equal(checked, false);
    assert.equal(transferred, false);
    assert.equal(creates(), 1);
  });

  it("redirects only after the hold line has played", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { bridge, handle, callTool } = bridgeWithFakeSocket({ resolveTransfer: async () => ({ ok: true }) });
      let target: unknown;
      bridge.onTransferRequested((selector) => { target = selector; });
      handle({ type: "response.created" });
      handle(audioDelta(1000));
      await callTool("transfer_to_staff", { staffName: "Gundeep Malhotra" });
      handle({ type: "response.done", response: { status: "completed", output: [] } });
      mock.timers.tick(1000);
      assert.equal(target, undefined, "padding still running");
      mock.timers.tick(600);
      assert.deepEqual(target, { staffId: undefined, staffName: "Gundeep Malhotra" });
    } finally {
      mock.timers.reset();
    }
  });

  it("still redirects when the reply finished before the staff check came back", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { bridge, callTool } = bridgeWithFakeSocket({ resolveTransfer: async () => ({ ok: true }) });
      let transferred = false;
      bridge.onTransferRequested(() => { transferred = true; });
      await callTool("transfer_to_staff", { staffName: "Gundeep Malhotra" });
      mock.timers.tick(0);
      assert.equal(transferred, true);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("ending the call", () => {
  it("hangs up after the goodbye has played", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { bridge, handle, callTool } = bridgeWithFakeSocket();
      let ended = false;
      bridge.onEndCall(() => { ended = true; });
      handle({ type: "response.created" });
      handle(audioDelta(500));
      await callTool("end_call");
      handle({ type: "response.done", response: { status: "completed", output: [{ type: "message" }, { type: "function_call" }] } });
      mock.timers.tick(1099);
      assert.equal(ended, false);
      mock.timers.tick(1);
      assert.equal(ended, true);
    } finally {
      mock.timers.reset();
    }
  });

  it("asks for a spoken goodbye first when end_call came without one", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { bridge, sent, handle, callTool, creates } = bridgeWithFakeSocket();
      let ended = false;
      bridge.onEndCall(() => { ended = true; });
      handle({ type: "response.created" });
      await callTool("end_call");
      handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call" }] } });
      mock.timers.tick(5000);
      assert.equal(ended, false);
      assert.equal(creates(), 1);
      assert.deepEqual(sent.at(-1), { type: "response.create", response: { tool_choice: "none" } });
      handle({ type: "response.done", response: { status: "completed", output: [{ type: "message" }] } });
      mock.timers.tick(0);
      assert.equal(ended, true);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("rate limits", () => {
  const rateLimited = { type: "response.done", response: { status: "failed", status_details: { error: { code: "rate_limit_exceeded" } }, output: [] } };

  it("retries with a growing pause, up to six in a row, and resets after a success", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { handle, creates } = bridgeWithFakeSocket();
      handle(rateLimited);
      mock.timers.tick(1500);
      assert.equal(creates(), 1);
      for (let i = 0; i < 6; i += 1) { handle(rateLimited); mock.timers.tick(6000); }
      assert.equal(creates(), 6, "stops after six");
      handle({ type: "response.done", response: { status: "completed", output: [] } });
      handle(rateLimited);
      mock.timers.tick(1500);
      assert.equal(creates(), 7);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("call history", () => {
  it("keeps transcriber silence hallucinations out", () => {
    assert.equal(isTranscriptionArtifact("Thanks for watching!"), true);
    assert.equal(isTranscriptionArtifact("Thank you very much"), false);
  });

  it("primes the transcriber with business words and the caller's languages", () => {
    const vocab = transcriptionVocabulary({
      ...session,
      transferRoster: [{ name: "Gundeep Malhotra", handles: "" }],
      agent: { ...session.agent, businessInfo: { receptionistName: "Riya", receptionistGender: "female", about: "", email: "", website: "", offices: [{ name: "Carnegie", address: "", phone: "", notes: "" }], faqs: [], outOfScope: "" } }
    });
    assert.deepEqual(vocab, ["Riya", "Carnegie", "Consultation", "Gundeep Malhotra"]);
    assert.match(transcriptionConfig("m", ["English", "Hindi"], vocab).prompt ?? "", /Hindi in Devanagari/);
    assert.deepEqual(transcriptionConfig("m", ["English"]), { model: "m", language: "en" });
  });
});

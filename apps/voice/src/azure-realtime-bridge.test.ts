import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  AzureRealtimeBridge,
  buildInstructions,
  buildSessionConfig,
  buildSipAcceptConfig
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

describe("realtime caller profile instructions", () => {
  it("shows caller-local geo and distinguishes filled from missing intake fields", () => {
    const instructions = buildInstructions(session);
    assert.match(instructions, /Asia\/Kolkata/);
    assert.match(instructions, /service_interest.*Student visa/);
    assert.match(instructions, /target_date.*not yet known/);
    assert.match(instructions, /at most TWO missing key-priority fields/);
  });

  it("uses structured profile capture for names instead of freeform memory", () => {
    const instructions = buildInstructions(session);
    assert.match(instructions, /update_caller_profile with fields \{name:/);
    assert.doesNotMatch(instructions, /save_memory with kind 'fact'.*Caller name/);
  });

  it("instructs greeting a returning caller by name before asking anything else", () => {
    const instructions = buildInstructions(session);
    assert.match(instructions, /RETURNING CALLER/);
    assert.match(instructions, /Greet them by name warmly right after your opening greeting/);
    assert.match(instructions, /NEVER ask a returning caller for their name/);
  });

  it("lists service prices upfront and requires stating them before booking tools", () => {
    const instructions = buildInstructions(session);
    assert.match(instructions, /SERVICES & PRICING/);
    assert.match(instructions, /Consultation \(30 min\): 110\.00 dollars/);
    assert.match(instructions, /Once the caller wants to book a specific service, mention its price before checking times/);
    assert.match(instructions, /If the caller asks what something costs, answer straight away/);
    assert.match(instructions, /Never call check_availability or create_booking before the caller has heard the price/);
  });

  it("forbids claiming a booking without create_booking, inventing facts, and answering noise", () => {
    const instructions = buildInstructions(session);
    assert.match(instructions, /NEVER say a booking is booked, confirmed, locked in, or done unless create_booking has returned success/);
    assert.match(instructions, /exact service passed to create_booking/);
    assert.match(instructions, /Never state a fact the BUSINESS PROFILE or SERVICES above does not contain/);
    assert.match(instructions, /Background noise, coughs, or a few unintelligible syllables are NOT a request/);
    assert.match(instructions, /save it only after they confirm/);
    assert.match(instructions, /ONE consistent gender for the whole call/);
  });

  it("briefs the caller (and asks who/why once) before transferring", () => {
    const instructions = buildInstructions(session);
    assert.match(instructions, /TRANSFER FLOW/);
    assert.match(instructions, /is there a particular consultant you'd like, or shall I put you through to whoever's available/);
    assert.match(instructions, /never ask for appointment details, never ask a second question/);
    assert.match(instructions, /Please stay on the line/);
    assert.match(instructions, /WITHOUT calling transfer_to_staff in the same response is a failure/);
    assert.match(instructions, /Do not invent a consultant's name/);
  });

  it("tells the agent not to promise a transfer when no staff phone exists", () => {
    const unavailable = buildInstructions({ ...session, transferAvailable: false });
    assert.match(unavailable, /LIVE TRANSFER IS NOT AVAILABLE/);
    assert.match(unavailable, /NEVER call transfer_to_staff/);
    assert.doesNotMatch(buildInstructions({ ...session, transferAvailable: true }), /LIVE TRANSFER IS NOT AVAILABLE/);
    assert.doesNotMatch(buildInstructions(session), /LIVE TRANSFER IS NOT AVAILABLE/);
  });

  it("offers a consultation at most once and never re-pitches after a decline", () => {
    const instructions = buildInstructions(session);
    assert.match(instructions, /Offer a consultation at most ONCE per call/);
    assert.match(instructions, /Never ask again, never re-pitch the price/);
  });

  it("gives office hours and the live open/closed status so the agent can explain after-hours", () => {
    const instructions = buildInstructions({
      ...session,
      businessHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        opens: "09:00:00",
        closes: "17:00:00",
        closed: weekday === 0
      }))
    });
    assert.match(instructions, /== OFFICE HOURS/);
    assert.match(instructions, /Monday: 9 AM to 5 PM/);
    assert.match(instructions, /Sunday: closed/);
    assert.match(instructions, /RIGHT NOW: The office/);
    assert.match(instructions, /Never just say 'nothing's available' without the reason/);
  });

  it("tells the agent not to invent a price when a service has none set", () => {
    const instructions = buildInstructions({
      ...session,
      services: [{ name: "Mystery Service", durationMinutes: 30, price: null }]
    });
    assert.match(instructions, /Mystery Service \(30 min\): price not set — do not guess a number/);
  });

  it("instructs asking the caller's language preference upfront, then holding it for the rest of the call", () => {
    const instructions = buildInstructions({
      ...session,
      agent: { ...session.agent, languages: ["English", "Hindi", "Spanish"] }
    });
    assert.match(instructions, /English, Hindi, Spanish/);
    assert.match(instructions, /ask ONE short, natural question about which language they'd prefer/);
    assert.match(instructions, /HOLD it for the rest of the call/);
  });

  it("locks to a single language when only one is configured", () => {
    const instructions = buildInstructions({
      ...session,
      agent: { ...session.agent, languages: ["French"] }
    });
    assert.match(instructions, /Speak French only/);
  });

  it("instructs ending the call only after the caller confirms nothing else is needed", () => {
    const instructions = buildInstructions(session);
    assert.match(instructions, /then call end_call/);
    assert.match(instructions, /Never call end_call while the caller is mid-request/);
    assert.match(instructions, /Never call end_call more than once/);
  });

  it("instructs hanging up immediately when the caller says goodbye, even without a name", () => {
    const instructions = buildInstructions(session);
    assert.match(instructions, /says goodbye or clearly wants to end the call at ANY point/);
    assert.match(instructions, /even if you don't have their name/);
    assert.match(instructions, /goodbye ALWAYS outranks the identity and intake rules/);
  });
});

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

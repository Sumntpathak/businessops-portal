import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { AzureRealtimeBridge, replyBudgetWords, type AzureRealtimeBridgeOptions } from "./azure-realtime-bridge.js";
import type { CallSession } from "./call-session.js";

const session: CallSession = {
  callId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f3",
  providerCallSid: "CA123",
  tenantId: "018f5f86-9cf1-7f4d-81d2-6f11a3e841f4",
  timezone: "Australia/Melbourne",
  caller: { id: "c1", phoneE164: "+61400000000", displayName: null, country: "Australia", timezone: "Australia/Melbourne", profile: {}, stage: "new" },
  intakeFields: [],
  agent: { agentMd: "# Test", voiceGreeting: "Hello", languageMode: "english", languages: ["English"] },
  services: [],
  memories: [],
  startedAt: "2026-07-06T04:00:00.000Z"
};

function fakeBridge(options: Partial<AzureRealtimeBridgeOptions> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const bridge = new AzureRealtimeBridge({ url: "https://x.openai.azure.com/openai/v1/realtime", apiKey: "k", model: "m", ...options });
  const internals = bridge as unknown as Record<string, unknown>;
  internals.socket = { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) };
  internals.session = session;
  internals.ready = true;
  const handle = (event: Record<string, unknown>) => (internals.handleServerEvent as (e: unknown) => void).call(bridge, event);
  return { bridge, internals, sent, handle };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const done = { type: "response.done", response: { status: "completed", output: [] } };

describe("replyBudgetWords", () => {
  it("sizes the budget to how the caller spoke", () => {
    assert.equal(replyBudgetWords(0, "Fees?"), 10);
    assert.equal(replyBudgetWords(0, "How much is a consultation please"), 16);
    assert.equal(replyBudgetWords(0, "I would like to know about the student visa consultation please"), 22);
    assert.equal(
      replyBudgetWords(0, "I have been trying to work out whether I should apply for the partner visa or the student visa first because my situation is a bit complicated"),
      30
    );
    assert.equal(replyBudgetWords(800), 10, "short speech, no transcript");
    assert.equal(replyBudgetWords(2000), 16);
    assert.equal(replyBudgetWords(8000), 30);
  });

  it("gives every reply a budget note and removes the previous one", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { sent, handle } = fakeBridge();
      for (let turn = 0; turn < 2; turn += 1) {
        handle({ type: "input_audio_buffer.speech_started" });
        mock.timers.tick(1500);
        handle({ type: "input_audio_buffer.speech_stopped" });
        handle(done);
      }
      const notes = sent.filter((e) => e.type === "conversation.item.create" && JSON.stringify(e).includes("REPLY BUDGET"));
      assert.equal(notes.length, 2);
      assert.equal(sent.filter((e) => e.type === "conversation.item.delete").length, 1);
      assert.equal(sent.filter((e) => e.type === "response.create").length, 2);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("transfer is validated before it is promised", () => {
  const transferCall = {
    type: "response.function_call_arguments.done",
    call_id: "c1",
    name: "transfer_to_staff",
    arguments: JSON.stringify({ staffName: "Ramlal" })
  };

  it("refuses an unknown person with a reason and the people it can offer, and does not transfer", async () => {
    let transferred = false;
    const { bridge, sent, handle } = fakeBridge({
      resolveTransfer: async () => ({ ok: false, reason: 'there is no team member matching "Ramlal"', available: ["Gundeep Malhotra"] })
    });
    bridge.onTransferRequested(() => {
      transferred = true;
    });
    handle(transferCall);
    await flush();
    const output = JSON.stringify(sent.find((e) => JSON.stringify(e).includes("function_call_output")));
    assert.match(output, /transferring\\":false/);
    assert.match(output, /Gundeep Malhotra/);
    assert.ok(sent.some((e) => e.type === "response.create"), "the model is asked to answer the caller");
    handle(done);
    await flush();
    assert.equal(transferred, false);
  });

  it("goes ahead when the person is valid", async () => {
    const { internals, sent, handle } = fakeBridge({ resolveTransfer: async () => ({ ok: true }) });
    handle(transferCall);
    await flush();
    assert.match(JSON.stringify(sent), /transferring\\":true/);
    assert.ok(internals.pendingTransfer, "transfer is queued for after the hold message");
  });
});

describe("booking needs a recap and a yes", () => {
  const book = {
    type: "response.function_call_arguments.done",
    call_id: "b1",
    name: "create_booking",
    arguments: JSON.stringify({ serviceId: "s", startsAt: "2026-10-02T00:30:00.000+00:00" })
  };
  const callerTurn = (handle: (e: Record<string, unknown>) => void) => {
    handle({ type: "input_audio_buffer.speech_started" });
    mock.timers.tick(1500);
    handle({ type: "input_audio_buffer.speech_stopped" });
    handle(done);
  };

  it("refuses create_booking until the caller has had two turns since availability was checked", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    try {
      const { bridge, sent, handle } = fakeBridge();
      const executed: string[] = [];
      bridge.onToolCall((name) => {
        executed.push(name);
        return { ok: true };
      });

      handle({ type: "response.function_call_arguments.done", call_id: "a1", name: "check_availability", arguments: '{"date":"2026-10-02"}' });
      await flush();
      assert.deepEqual(executed, ["check_availability"]);
      handle(done); // the model finishes offering the slots

      callerTurn(handle); // the caller picks a slot
      handle(book);
      await flush();
      assert.deepEqual(executed, ["check_availability"], "refused after only the pick");
      assert.match(JSON.stringify(sent), /not confirmed the recap/);
      handle(done); // the model finishes its recap before the caller speaks again

      callerTurn(handle); // the caller confirms
      handle({ ...book, call_id: "b2" });
      await flush();
      assert.deepEqual(executed, ["check_availability", "create_booking"], "allowed after the confirmation");
    } finally {
      mock.timers.reset();
    }
  });
});

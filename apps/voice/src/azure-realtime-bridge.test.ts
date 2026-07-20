import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInstructions } from "./azure-realtime-bridge.js";
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

  it("instructs holding the opening language until the caller clearly switches, then holding the new one", () => {
    const instructions = buildInstructions({
      ...session,
      agent: { ...session.agent, languages: ["English", "Hindi", "Spanish"] }
    });
    assert.match(instructions, /English, Hindi, Spanish/);
    assert.match(instructions, /Do not switch languages preemptively/);
    assert.match(instructions, /HOLD that language for the rest of the call/);
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

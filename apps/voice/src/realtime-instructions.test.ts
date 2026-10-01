import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInstructions } from "./realtime-instructions.js";
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

describe("realtime instructions: structure and context", () => {
  it("uses labelled sections and embeds the business profile, services and call context", () => {
    const text = buildInstructions({ ...session, agent: { ...session.agent, agentMd: "# Holistic AGENT-MD-MARKER" } });
    for (const heading of ["# ROLE", "# BUSINESS PROFILE", "# SERVICES & PRICING", "# TONE", "# LENGTH", "# TURN-TAKING", "# PREAMBLES", "# LANGUAGE", "# UNCLEAR AUDIO", "# BOOKING", "# TOOLS", "# TRANSFER TO A PERSON"]) {
      assert.ok(text.includes(heading), heading);
    }
    assert.match(text, /AGENT-MD-MARKER/);
    assert.match(text, /Consultation \(30 min\): 110\.00 dollars/);
  });

  it("shows caller-local geo and distinguishes filled from missing intake fields", () => {
    const text = buildInstructions(session);
    assert.match(text, /Asia\/Kolkata/);
    assert.match(text, /service_interest.*Student visa/);
    assert.match(text, /target_date.*not yet known/);
    assert.match(text, /at most two missing key-priority fields/);
  });

  it("tells the agent not to invent a price when a service has none set", () => {
    const text = buildInstructions({ ...session, services: [{ name: "Mystery Service", durationMinutes: 30, price: null }] });
    assert.match(text, /Mystery Service \(30 min\): price not set — do not guess a number/);
  });

  it("gives office hours and the live open/closed status", () => {
    const text = buildInstructions({
      ...session,
      businessHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00:00", closes: "17:00:00", closed: weekday === 0 }))
    });
    assert.match(text, /# OFFICE HOURS/);
    assert.match(text, /Monday: 9 AM to 5 PM/);
    assert.match(text, /Sunday: closed/);
    assert.match(text, /RIGHT NOW: The office/);
    assert.match(text, /Never just say 'nothing's available' without the reason/);
  });
});

describe("realtime instructions: brevity and turn-taking", () => {
  const text = buildInstructions(session);

  it("makes brevity the top rule: match the caller, two short sentences, answer then stop", () => {
    assert.match(text, /Match the caller/);
    assert.match(text, /Hard limit: two short sentences/);
    assert.match(text, /No single sentence longer than 20 words/);
    assert.match(text, /Answer only what was asked, then stop/);
  });

  it("bans filler openers and re-introductions", () => {
    assert.match(text, /never say 'Great question', 'No worries'/);
    assert.match(text, /Do not introduce yourself or the business again/);
  });

  it("allows preambles only before tool calls and never announcing what it is about to say", () => {
    assert.match(text, /Say a preamble ONLY right before a tool call/);
    assert.match(text, /Never announce what you are about to say or do/);
  });

  it("handles interruptions: no resuming a cut-off answer, no repeating after a bare 'okay'", () => {
    assert.match(text, /do not resume or repeat the cut-off answer/);
    assert.match(text, /only acknowledges \('okay', 'yeah', 'hmm'\)/);
    assert.match(text, /Never reply twice in a row/);
  });

  it("ignores noise and unclear audio instead of guessing, and never treats it as a yes", () => {
    assert.match(text, /Ignore single sounds, fragments, filler/);
    assert.match(text, /Noise or unclear audio is never a yes/);
    assert.match(text, /If it is unclear twice in a row, offer to have the team call them back/);
  });

  it("includes short sample replies to anchor length and style", () => {
    assert.match(text, /# SAMPLE REPLIES/);
    assert.match(text, /Caller just says hi: 'Hi, how can I help\?'/);
  });
});

describe("realtime instructions: language", () => {
  it("speaks the first language by default and never asks which language", () => {
    const text = buildInstructions({ ...session, agent: { ...session.agent, languages: ["English", "Hindi"] } });
    assert.match(text, /Speak English from the first word\. Do not ask which language/);
    assert.match(text, /A single word, a filler sound or a short phrase is NOT a reason to switch/);
    assert.match(text, /Only use these languages: English, Hindi/);
    assert.match(text, /one consistent feminine form/);
    assert.doesNotMatch(text, /Which language would you like to continue in/);
  });

  it("locks to a single language when only one is configured", () => {
    const text = buildInstructions({ ...session, agent: { ...session.agent, languages: ["French"] } });
    assert.match(text, /Speak French only/);
  });
});

describe("realtime instructions: facts, names and booking", () => {
  const text = buildInstructions(session);

  it("states prices up front and requires the price before any booking tool", () => {
    assert.match(text, /State the exact price when asked/);
    assert.match(text, /Never call check_availability or create_booking before the caller has heard the price/);
  });

  it("forbids guessing facts and gives no medical or personal migration advice", () => {
    assert.match(text, /GST, payment methods, refunds, visa outcomes, timelines/);
    assert.match(text, /Never give personal migration or legal advice/);
    assert.match(text, /For medical or health talk give no advice/);
  });

  it("captures names carefully: spelled by the caller is saved, otherwise read back first", () => {
    assert.match(text, /If they spell it themselves, call update_caller_profile with it straight away/);
    assert.match(text, /read your spelling back and save it after they say yes/);
  });

  it("searches availability as soon as a day is known, and only says booked after create_booking succeeded", () => {
    assert.match(text, /call check_availability right away/);
    assert.match(text, /only after create_booking succeeded in this call/);
    assert.match(text, /The service you recap is the service you book/);
  });

  it("offers a consultation at most once", () => {
    assert.match(text, /Offer a consultation at most once/);
    assert.match(text, /never bring it up again/);
  });

  it("ends the call on goodbye and never mid-request", () => {
    assert.match(text, /say one short goodbye and call end_call/);
    assert.match(text, /A goodbye outranks everything else/);
    assert.match(text, /Never end the call mid-request or because of a pause/);
  });
});

describe("realtime instructions: transfer", () => {
  it("requires a clear yes before transferring, with the hold message in the same response", () => {
    const text = buildInstructions(session);
    assert.match(text, /Would you like me to connect you to a team member\? Please say yes to confirm/);
    assert.match(text, /Silence, noise, 'thank you' or unrelated words are NOT a yes/);
    assert.match(text, /Please stay on the line, it may ring for a few seconds/);
    assert.match(text, /Do not ask which consultant they want/);
  });

  it("tells the agent not to promise a transfer when no staff phone exists", () => {
    const unavailable = buildInstructions({ ...session, transferAvailable: false });
    assert.match(unavailable, /LIVE TRANSFER IS NOT AVAILABLE/);
    assert.match(unavailable, /NEVER call transfer_to_staff/);
    assert.doesNotMatch(unavailable, /Would you like me to connect you to a team member/);
    assert.doesNotMatch(buildInstructions({ ...session, transferAvailable: true }), /LIVE TRANSFER IS NOT AVAILABLE/);
    assert.doesNotMatch(buildInstructions(session), /LIVE TRANSFER IS NOT AVAILABLE/);
  });
});

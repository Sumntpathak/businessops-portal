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
    profile: {},
    stage: "interested"
  },
  intakeFields: [],
  agent: { agentMd: "# Holistic AGENT-MD", voiceGreeting: "Hello", languageMode: "english", languages: ["English", "Hindi", "Punjabi"] },
  services: [{ name: "Consultation", durationMinutes: 30, price: "110.00" }],
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00:00", closes: "17:00:00", closed: weekday === 0 || weekday === 6 })),
  transferRoster: [{ name: "Gundeep Malhotra", handles: "student and partner visas" }],
  memories: [],
  startedAt: "2026-07-06T04:00:00.000Z"
};

const info = {
  receptionistName: "Riya",
  receptionistGender: "female" as const,
  about: "Melbourne migration advisers.",
  email: "",
  website: "",
  offices: [{ name: "Carnegie", address: "23 Koornang Road", phone: "", notes: "" }],
  faqs: [{ question: "Do you guarantee approval?", answer: "No one can guarantee a visa outcome." }],
  outOfScope: "visa eligibility"
};

describe("realtime instructions", () => {
  const text = buildInstructions({ ...session, agent: { ...session.agent, businessInfo: info } });

  it("is short", () => {
    assert.ok(text.split("\n").length < 60, `${text.split("\n").length} lines`);
  });

  it("has one hard rule: only the business, no advice, no general knowledge", () => {
    assert.match(text, /# THE ONE RULE/);
    assert.match(text, /Never give advice \(visa, migration, legal, medical, financial or any other\)/);
    assert.match(text, /never answer from your own general knowledge\. Never discuss visa eligibility\./);
    assert.match(text, /offer a callback from the team/);
  });

  it("follows the caller's language", () => {
    assert.match(text, /Reply in the language the caller is speaking \(English, Hindi, Punjabi\), and switch whenever they switch/);
    assert.match(text, /Hindi forms for you: सकती हूँ/);
    assert.match(text, /You are Riya, the woman/);
  });

  it("describes only booking, callback, transfer and goodbye", () => {
    assert.match(text, /When the caller picks a time, do not book yet: read it back with the price/);
    assert.match(text, /Call create_booking once, only after they say yes to that question/);
    assert.match(text, /call request_callback when the caller asks for one or says yes/);
    assert.match(text, /names someone who is NOT in TEAM, never connect them/);
    assert.match(text, /nobody called Ramlal here\. Shall I connect you with Gundeep Malhotra\?/);
    assert.match(text, /say 'I'll connect you with \[name\] now/);
    assert.match(text, /say a short goodbye and call end_call/);
  });

  it("holds every business fact in one place", () => {
    assert.match(text, /Office Carnegie: 23 Koornang Road/);
    assert.match(text, /Q: Do you guarantee approval\?/);
    assert.match(text, /Consultation \(30 min\): 110\.00 dollars/);
    assert.match(text, /- Gundeep Malhotra: student and partner visas/);
    assert.match(text, /AGENT-MD/);
  });

  it("gives office hours in the caller's own time when they are elsewhere", () => {
    assert.match(text, /in the caller's own time, Asia\/Kolkata/);
    assert.match(text, /^- Monday \d{1,2}:30 AM to \d{1,2}:30 (AM|PM)$/m);
    const local = buildInstructions({ ...session, caller: { ...session.caller, timezone: "Australia/Melbourne" } });
    assert.match(local, /- Monday: 9 AM to 5 PM/);
  });

  it("offers a callback instead of a transfer when nobody can take a call", () => {
    assert.match(buildInstructions({ ...session, transferAvailable: false }), /Nobody can take a live call right now/);
  });

  it("never asks for the phone number", () => {
    assert.match(text, /phone \+919876543210 \(never ask for it\)/);
  });
});

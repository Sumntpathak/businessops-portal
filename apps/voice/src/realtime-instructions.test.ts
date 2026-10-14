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
  history: { upcomingBookings: [], pendingCallbacks: [], lastCallAt: null },
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
    // Was <70 before the 5-step call flow and the returning-caller rules.
    assert.ok(text.split("\n").length < 100, `${text.split("\n").length} lines`);
  });

  it("has one hard rule: only the business, no advice, no general knowledge", () => {
    assert.match(text, /# THE ONE RULE/);
    assert.match(text, /Never give advice \(visa, migration, legal, medical, financial or any other\)/);
    assert.match(text, /never answer from your own general knowledge\. Never discuss visa eligibility\./);
    assert.match(text, /offer a callback from the team/);
  });

  it("follows the caller's language", () => {
    assert.match(text, /Reply in the language of the caller's latest full sentence \(English, Hindi, Punjabi\)/);
    assert.match(text, /A short reply \('ok', 'not now', 'yes', 'haan'\) keeps the language/);
    assert.match(text, /Hindi forms for you.*सकती हूँ/);
    assert.match(text, /You are Riya, the woman/);
  });

  it("describes only booking, callback, transfer and goodbye", () => {
    assert.match(text, /When the caller picks a time, do not book yet: read back the EXACT time they picked/);
    assert.match(text, /Call create_booking with that exact startsAt only after they say yes/);
    assert.match(text, /call request_callback when the caller asks for one or says yes/);
    assert.match(text, /named a specific person who is NOT in that list/);
    assert.match(text, /Never respond to a transfer request with a plain no/);
    assert.match(text, /nobody called Ramlal here\. Shall I connect you with Gundeep Malhotra\?/);
    assert.match(text, /say 'I'll connect you with \[name\] now/);
    assert.match(text, /say a short goodbye out loud and call end_call/);
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
    assert.match(text, /phone: \+919876543210 \(never ask for it\)/);
  });

  it("lays out the 5-step call and no longer forbids moving the call on", () => {
    assert.match(text, /# HOW A CALL GOES/);
    assert.match(text, /1\. Introduction[\s\S]*2\. Why they are calling[\s\S]*3\. Their questions[\s\S]*4\. Booking[\s\S]*5\. Close/);
    assert.match(text, /our team confirms payment and the booking/);
    assert.match(text, /offer a consultation once/);
    assert.doesNotMatch(text, /Answer only what was asked/);
    assert.doesNotMatch(text, /Never proactively pitch a consultation/);
    assert.doesNotMatch(text, /Booking: only when the caller wants one/);
  });
});

describe("CALLER section", () => {
  const now = new Date("2026-10-14T00:00:00.000Z");
  const base = { ...session, caller: { ...session.caller, displayName: null, stage: "new" as const } };

  it("says a first-time caller has no history, so nothing gets invented", () => {
    assert.match(buildInstructions(base), /First-time caller: no history/);
  });

  it("shows what we know about a returning caller, in the caller's own time", () => {
    const text = buildInstructions({
      ...session,
      caller: { ...session.caller, profile: { enquiry: "partner visa, onshore" } },
      memories: [{ id: "m1", kind: "summary", content: "Asked about a partner visa; booked a consultation." }],
      history: {
        upcomingBookings: [{ serviceName: "Consultation", startsAt: "2026-10-20T04:30:00.000Z" }],
        pendingCallbacks: [{ reason: "Wants fees for a 482 visa", createdAt: "2026-10-12T00:00:00.000Z" }],
        lastCallAt: "2026-10-12T00:00:00.000Z"
      }
    });
    assert.doesNotMatch(text, /First-time caller/);
    assert.match(text, /- Name: Sumant/);
    assert.match(text, /- Last enquiry: partner visa, onshore/);
    // 04:30 UTC is 10:00 AM in Kolkata.
    assert.match(text, /- Upcoming booking: Consultation, Tuesday, Oct 20, 10:00 AM \(their time\)/);
    assert.match(text, /- Pending callback request \(\d+ days ago\): Wants fees for a 482 visa/);
    assert.match(text, /- From past calls: Asked about a partner visa/);
    assert.match(text, /only after they confirm who they are/);
  });

  it("lists intake fields with key ones first and marks what is still unknown", () => {
    const text = buildInstructions({
      ...base,
      caller: { ...base.caller, profile: { visa_type: "Student" } },
      intakeFields: [
        { id: "f1", key: "location", label: "Current location", type: "text", options: [], priority: "optional", sort: 1, active: true },
        { id: "f2", key: "visa_type", label: "Visa type", type: "select", options: ["Student", "Partner"], priority: "key", sort: 2, active: true }
      ]
    });
    assert.match(text, /- Visa type \[visa_type\], key: Student \(one of: Student, Partner\)\n- Current location \[location\]: not known yet/);
  });

  it("counts calendar days in the caller's timezone", async () => {
    const { callerLines } = await import("./call-flow-prompt.js");
    // 23:00 on the 12th in Kolkata, read at 05:30 on the 14th: two calendar days, not one.
    const lines = callerLines(
      { ...session, history: { upcomingBookings: [], pendingCallbacks: [{ reason: "x", createdAt: "2026-10-12T17:30:00.000Z" }], lastCallAt: null } },
      "Asia/Kolkata",
      now
    );
    assert.ok(lines.includes("- Pending callback request (2 days ago): x"), lines.join("\n"));
  });

  it("withholds all history when there is no name on file to confirm", () => {
    const text = buildInstructions({
      ...base,
      memories: [{ id: "m1", kind: "summary", content: "Asked about a partner visa." }],
      history: { upcomingBookings: [{ serviceName: "Consultation", startsAt: "2026-10-20T04:30:00.000Z" }], pendingCallbacks: [], lastCallAt: null }
    });
    assert.match(text, /no name is on file/);
    assert.doesNotMatch(text, /Upcoming booking|Asked about a partner visa|From past calls/);
  });

  it("does not treat a bare earlier call as history", () => {
    const text = buildInstructions({ ...base, history: { upcomingBookings: [], pendingCallbacks: [], lastCallAt: "2026-10-13T00:00:00.000Z" } });
    assert.match(text, /First-time caller/);
  });
});

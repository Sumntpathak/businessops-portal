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

const info = {
  receptionistName: "Riya",
  receptionistGender: "female" as const,
  about: "Melbourne migration advisers.",
  email: "enquiry@example.com",
  website: "",
  offices: [{ name: "Carnegie", address: "23 Koornang Road", phone: "+61 3 9999 7994", notes: "" }],
  faqs: [{ question: "Do you guarantee approval?", answer: "No one can guarantee a visa outcome." }],
  outOfScope: "visa eligibility and timelines"
};

describe("realtime instructions: five jobs and one source of truth", () => {
  it("lists exactly the five receptionist jobs and declines everything else", () => {
    const text = buildInstructions(session);
    assert.match(text, /# YOUR FIVE JOBS \(nothing else\)/);
    for (const job of ["1. Answer questions", "2. Tell callers the office", "3. Connect callers", "4. Book, change or cancel", "5. Take a callback"]) {
      assert.ok(text.includes(job), job);
    }
    assert.match(text, /Anything else: decline politely in one short line/);
    assert.match(text, /personal legal, migration, medical or financial advice/);
  });

  it("puts every business fact in one section that is the only truth", () => {
    const text = buildInstructions({
      ...session,
      agent: { ...session.agent, agentMd: "# Holistic AGENT-MD-MARKER", businessInfo: info },
      businessHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00:00", closes: "17:00:00", closed: weekday === 0 }))
    });
    const facts = text.slice(text.indexOf("# BUSINESS FACTS"), text.indexOf("# LANGUAGE"));
    assert.match(facts, /the ONLY things you know/);
    assert.match(facts, /Do not use your own general knowledge/);
    assert.match(facts, /Office Carnegie: 23 Koornang Road; phone \+61 3 9999 7994/);
    assert.match(facts, /Q: Do you guarantee approval\? A: No one can guarantee/);
    assert.match(facts, /Consultation \(30 min\): 110\.00 dollars/);
    assert.match(facts, /caller is in Asia\/Kolkata; already converted/);
    assert.match(facts, /^- Monday \d{1,2}:30 AM to \d{1,2}:30 (AM|PM)$/m);
    assert.match(facts, /Sunday: closed/);
    assert.match(facts, /RIGHT NOW \(business time\): The office/);
    assert.match(facts, /AGENT-MD-MARKER/);
    assert.match(text, /or discuss visa eligibility and timelines\./);
    assert.equal(text.match(/# BUSINESS/g)?.length, 1);
  });

  it("gives plain business-time hours when the caller is in the business's time zone", () => {
    const text = buildInstructions({
      ...session,
      caller: { ...session.caller, timezone: "Australia/Melbourne" },
      businessHours: [{ weekday: 1, opens: "09:00:00", closes: "17:00:00", closed: false }]
    });
    assert.match(text, /OFFICE HOURS \(business local time\):\n- Monday: 9 AM to 5 PM/);
    assert.doesNotMatch(text, /Only if the caller asks for/);
  });

  it("never invents a price that is not set", () => {
    const text = buildInstructions({ ...session, services: [{ name: "Mystery Service", durationMinutes: 30, price: null }] });
    assert.match(text, /Mystery Service \(30 min\): price not set, the team will confirm it/);
  });
});

describe("realtime instructions: language", () => {
  const text = buildInstructions({ ...session, agent: { ...session.agent, languages: ["English", "Hindi", "Punjabi"], businessInfo: info } });

  it("always replies in the language the caller is speaking", () => {
    assert.match(text, /Always reply in the language the caller is speaking NOW/);
    assert.match(text, /If they speak Hindi, reply in Hindi; Punjabi, reply in Punjabi; English, reply in English/);
    assert.match(text, /A one-word reply .* does not change the language/);
    assert.match(text, /Tool results are English data\. They never change your language/);
    assert.match(text, /Never ask which language/);
  });

  it("keeps the persona's gender forms and native-script samples", () => {
    assert.match(text, /You are Riya, the woman/);
    assert.match(text, /In Hindi always use the female forms: सकती हूँ/);
    assert.match(text, /In Punjabi always use the female forms: ਸਕਦੀ ਹਾਂ/);
    assert.match(text, /Punjabi: 'ਜੀ, ਦੱਸੋ/);
  });

  it("uses male forms for a male receptionist", () => {
    const male = buildInstructions({
      ...session,
      agent: { ...session.agent, languages: ["English", "Hindi"], businessInfo: { ...info, receptionistGender: "male" } }
    });
    assert.match(male, /In Hindi always use the male forms: सकता हूँ/);
    assert.doesNotMatch(male, /सकती हूँ/);
  });

  it("locks to a single language when only one is configured", () => {
    assert.match(buildInstructions({ ...session, agent: { ...session.agent, languages: ["French"] } }), /Speak French only/);
  });
});

describe("realtime instructions: connecting to the right person", () => {
  const roster = [
    { name: "Gundeep Malhotra", handles: "student and partner visas" },
    { name: "Asha Rao", handles: "" }
  ];

  it("lists who handles what and routes by role", () => {
    const text = buildInstructions({ ...session, transferRoster: roster });
    assert.match(text, /- Gundeep Malhotra: student and partner visas/);
    assert.match(text, /- Asha Rao: general enquiries/);
    assert.match(text, /the person whose role matches what the caller needs/);
  });

  it("transfers straight away on a clear request with the hold line, and treats 'No, [name]' as no", () => {
    const text = buildInstructions({ ...session, transferRoster: roster });
    assert.match(text, /'I'll connect you with \[name\] now\. Please stay on the line, it may ring for a few seconds\.' and call transfer_to_staff/);
    assert.match(text, /Asking to book is NOT asking for a person/);
    assert.match(text, /'No', 'No, \[name\]' or just a name after you offered someone means NO/);
  });

  it("never promises a transfer when nobody can take a call", () => {
    const text = buildInstructions({ ...session, transferAvailable: false });
    assert.match(text, /LIVE TRANSFER IS NOT AVAILABLE/);
    assert.match(text, /NEVER call transfer_to_staff/);
    assert.doesNotMatch(buildInstructions({ ...session, transferRoster: roster }), /LIVE TRANSFER IS NOT AVAILABLE/);
  });
});

describe("realtime instructions: booking, callbacks, names and ending", () => {
  const text = buildInstructions(session);

  it("books only on request, from real slots, after a recap and a yes", () => {
    assert.match(text, /Only when the caller asks to book\. Never sell/);
    assert.match(text, /say its price, then check_availability/);
    assert.match(text, /Offer only times from the latest check_availability/);
    assert.match(text, /Pass startsAt to create_booking exactly as returned/);
    assert.match(text, /Say it is booked only after create_booking succeeded/);
  });

  it("takes a callback only with consent", () => {
    assert.match(text, /Call request_callback only when the caller asks for a call back or says yes to leaving a message/);
  });

  it("confirms names letter by letter and never uses a saved name unconfirmed", () => {
    assert.match(text, /read it back letter by letter/);
    assert.match(text, /Use the name only after they say yes/);
    assert.match(text, /Never ask for the phone number/);
  });

  it("keeps replies short and answers the latest words", () => {
    assert.match(text, /One short sentence; two at most/);
    assert.match(text, /Always answer the caller's LATEST words/);
    assert.match(text, /Noise, a cough or unclear audio is never an answer/);
  });

  it("hangs up with end_call after a goodbye, never mid-request", () => {
    assert.match(text, /one short goodbye AND call end_call in the same response/);
    assert.match(text, /Never end the call mid-request/);
  });

  it("includes the caller's profile and local time", () => {
    assert.match(text, /Asia\/Kolkata/);
    assert.match(text, /service_interest.*Student visa/);
    assert.match(text, /target_date.*not yet known/);
  });
});

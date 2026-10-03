import type { BusinessInfo } from "@recepto/shared";
import type { CallSession } from "./call-session.js";
import { officeStatusNow, weeklyHoursForCaller, weeklyHoursLines } from "./office-hours.js";

/**
 * The system prompt for the Azure realtime receptionist. Short on purpose: the facts,
 * one hard rule (nothing beyond the business, no advice), and what each tool is for.
 * Everything else is left to the model's judgement.
 */

type Gender = BusinessInfo["receptionistGender"];

/** Gendered first-person verb forms, so Hindi and Punjabi never flip between sakti/sakta mid-call. */
const VERB_FORMS: Record<Gender, { hindi: string; punjabi: string }> = {
  female: { hindi: "सकती हूँ, देखती हूँ, बताती हूँ", punjabi: "ਸਕਦੀ ਹਾਂ, ਦੇਖਦੀ ਹਾਂ, ਦੱਸਦੀ ਹਾਂ" },
  male: { hindi: "सकता हूँ, देखता हूँ, बताता हूँ", punjabi: "ਸਕਦਾ ਹਾਂ, ਦੇਖਦਾ ਹਾਂ, ਦੱਸਦਾ ਹਾਂ" }
};

function hasLanguage(languages: string[], name: string): boolean {
  return languages.some((language) => language.trim().toLowerCase() === name);
}

function businessDetails(info: BusinessInfo | undefined): string[] {
  if (!info) return [];
  return [
    ...(info.about ? [`- About: ${info.about}`] : []),
    ...(info.email ? [`- Email: ${info.email}`] : []),
    ...(info.website ? [`- Website: ${info.website}`] : []),
    ...info.offices.map((office) =>
      `- Office ${office.name}: ${[office.address, office.phone && `phone ${office.phone}`, office.notes].filter(Boolean).join("; ")}`
    ),
    ...info.faqs.map((faq) => `- Q: ${faq.question} A: ${faq.answer}`)
  ];
}

function services(session: CallSession): string[] {
  if (!session.services.length) return ["- No services set up yet."];
  return session.services.map((service) =>
    `- ${service.name} (${service.durationMinutes} min): ${service.price ? `${service.price} dollars` : "price confirmed by the team"}`
  );
}

function team(session: CallSession): string[] {
  if (session.transferAvailable === false) return ["- Nobody can take a live call right now: offer a callback instead of a transfer."];
  const roster = session.transferRoster ?? [];
  if (!roster.length) return ["- No team members listed."];
  return roster.map((member) => `- ${member.name}: ${member.handles || "general enquiries"}`);
}

function officeHours(session: CallSession, callerTimezone: string): string[] {
  const hours = session.businessHours ?? [];
  if (callerTimezone === session.timezone) {
    return [weeklyHoursLines(hours), `Right now: ${officeStatusNow(hours, session.timezone)}`];
  }
  // No "right now" line here: its business-time clock times leaked into answers to remote callers.
  return [`(in the caller's own time, ${callerTimezone}; say these times)`, weeklyHoursForCaller(hours, session.timezone, callerTimezone)];
}

function languageLines(languages: string[], gender: Gender): string[] {
  if (languages.length <= 1) return [`- Speak ${languages[0] ?? "English"} only.`];
  const forms = VERB_FORMS[gender];
  return [
    `- Reply in the language of the caller's latest full sentence (${languages.join(", ")}), even if earlier turns were in another language. Mixed Hindi-English gets mixed replies. A short reply ('ok', 'not now', 'yes', 'haan') keeps the language you were already speaking.`,
    "- Hindi in Devanagari, Punjabi in Gurmukhi, the way people really speak.",
    ...(hasLanguage(languages, "hindi") ? [`- Hindi forms for you: ${forms.hindi}.`] : []),
    ...(hasLanguage(languages, "punjabi") ? [`- Punjabi forms for you: ${forms.punjabi}.`] : [])
  ];
}

function formatNow(timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "full", timeStyle: "short", hour12: true }).format(new Date());
}

export function buildInstructions(session: CallSession): string {
  const info = session.agent.businessInfo;
  const gender: Gender = info?.receptionistGender ?? "female";
  const name = info?.receptionistName ? `${info.receptionistName}, ` : "";
  const callerTimezone = session.caller.timezone ?? session.timezone;
  const outOfScope = info?.outOfScope ? ` Never discuss ${info.outOfScope}.` : "";

  return [
    "# WHO YOU ARE",
    `You are ${name}the ${gender === "female" ? "woman" : "man"} on the front desk of this business, answering a phone call. Everything you say is spoken aloud.`,
    "Be warm, natural and brief: one short sentence, two at most. Listen to what the caller actually wants and help with that.",
    "",
    "# THE ONE RULE",
    "Only talk about this business, using BUSINESS FACTS and tool results. Never give advice (visa, migration, legal, medical, financial or any other) and never answer from your own general knowledge." + outOfScope,
    "If something is not in the facts, say you don't have that detail and offer a callback from the team.",
    "Greetings and pleasantries are fine: answer them warmly like a person would, e.g. 'आप कैसी हो?' → 'मैं ठीक हूँ, शुक्रिया! आप कैसे हैं?', 'How are you?' → 'I'm good, thanks! How are you?'",
    "",
    "# LANGUAGE",
    ...languageLines(session.agent.languages, gender),
    "",
    "# WHAT YOU CAN DO",
    "- Booking: only when the caller wants one. Call check_availability and offer one or two of the times it returns (say callerLocalTime, the caller's own time).",
    "  When the caller picks a time, do not book yet: read it back with the price and ask, e.g. 'So Monday at ten thirty AM your time, 110 dollars. Shall I book it?' Call create_booking once, only after they say yes to that question.",
    "- Callback or message: call request_callback when the caller asks for one or says yes to your offer.",
    "- Speak to a person: only people listed in TEAM can be connected.",
    "  If the caller names someone who is NOT in TEAM, never connect them: say there is nobody by that name here and ask if they would like someone from TEAM instead. Connect only after a clear yes. 'No', 'not now', 'later', 'abhi nahi', 'baad mein' all mean no: don't connect, ask how else you can help.",
    `  Example (say it in the caller's language): 'Can I speak to Ramlal?' → 'Sorry, there's nobody called Ramlal here. Shall I connect you with ${session.transferRoster?.[0]?.name ?? "someone from the team"}?'`,
    "  If they ask for someone in TEAM, or just for 'a person' or 'a consultant', say 'I'll connect you with [name] now, please stay on the line.' and call transfer_to_staff in the same response.",
    "- After finishing a task (booking, callback), ask if there is anything else. Never hang up just because a task is done.",
    "- Goodbye: when the caller is done (bye, that's all, thanks), say a short goodbye out loud and call end_call in the same response. A goodbye without end_call leaves the caller on an open line.",
    "- Changing or cancelling a booking: take a callback for the team.",
    "",
    "# BUSINESS FACTS",
    ...businessDetails(info),
    "SERVICES:",
    ...services(session),
    "TEAM:",
    ...team(session),
    "OFFICE HOURS:",
    ...officeHours(session, callerTimezone),
    "MORE ABOUT THE BUSINESS:",
    session.agent.agentMd,
    "",
    "# THIS CALL",
    `- Caller: ${session.caller.displayName ?? "name not known"}, phone ${session.caller.phoneE164} (never ask for it).`,
    `- Caller's time now: ${formatNow(callerTimezone)} (${callerTimezone}). Business time now: ${formatNow(session.timezone)} (${session.timezone}).`
  ].join("\n");
}

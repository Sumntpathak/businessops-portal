import type { CallSession } from "./call-session.js";
import { ENQUIRY_KEY, localDateInTimezone } from "./caller-profile.js";

/**
 * A returning caller's bookings, callbacks and past conversations are private. They are kept
 * out of the prompt and only handed to the model by confirm_caller, once the person on the
 * line has said they are the caller on file. A model told "don't share this" still shared a
 * booking time with "his wife" in testing; a model that was never told can't.
 */

/** Matches the "Oct 20, 2026, 10:00 AM" shape used elsewhere, plus the weekday callers say. */
function spokenTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(iso));
}

/** Calendar days in the caller's timezone, so 11 PM yesterday is "yesterday", not "today". */
function daysAgo(iso: string, now: Date, timeZone: string): string {
  const day = (date: Date) => Date.parse(localDateInTimezone(date, timeZone) + "T00:00:00Z");
  const days = Math.round((day(now) - day(new Date(iso))) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Anything worth acting on. A bare earlier call (dropped, spam, wrong number) is not. */
export function hasPrivateHistory(session: CallSession): boolean {
  const { caller, history, memories } = session;
  return Boolean(
    caller.profile[ENQUIRY_KEY] || memories.length || history.upcomingBookings.length || history.pendingCallbacks.length ||
      session.intakeFields.some((field) => caller.profile[field.key] !== undefined && caller.profile[field.key] !== "")
  );
}

/** What we know about the caller on file, for confirm_caller to return. */
export function privateHistoryLines(session: CallSession, callerTimezone: string, now: Date = new Date()): string[] {
  const { caller, history, memories } = session;
  const enquiry = caller.profile[ENQUIRY_KEY];
  return [
    `Stage: ${caller.stage}`,
    ...(enquiry ? [`Last enquiry: ${String(enquiry)}`] : []),
    ...(history.lastCallAt ? [`Last called: ${daysAgo(history.lastCallAt, now, callerTimezone)}`] : []),
    ...history.upcomingBookings.map((booking) => `Upcoming booking: ${booking.serviceName}, ${spokenTime(booking.startsAt, callerTimezone)} (their time)`),
    ...history.pendingCallbacks.map((callback) => `Pending callback request (${daysAgo(callback.createdAt, now, callerTimezone)}): ${callback.reason}`),
    ...session.intakeFields.flatMap((field) => {
      const value = caller.profile[field.key];
      return value !== undefined && value !== "" ? [`${field.label} [${field.key}]: ${String(value)}`] : [];
    }),
    ...memories.map((memory) => `From past calls: ${memory.content}`)
  ];
}

/** Relations that mark someone speaking about the caller rather than as them. */
const RELATION = "wife|husband|partner|mother|mum|mom|father|dad|son|daughter|brother|sister|friend|mate|assistant|secretary|colleague|boss|cousin|uncle|aunt|girlfriend|boyfriend|fianc[eé]e?|lawyer|agent";

/**
 * Someone other than the caller on file: "this is his wife", "Raj's wife", "on behalf of",
 * "he isn't here", "take a message", "unki/uski". "My" is deliberately not here: "my partner
 * visa" and "my wife booked it" are how the owner talks.
 */
const THIRD_PARTY = new RegExp(
  [
    /\b(his|her|their)\s+/.source + `(${RELATION})` + /\b/.source,
    /\b\p{L}+'s\s+/u.source + `(${RELATION})` + /\b/.source,
    /\b(i'?m|i am|this is)\s+(his|her|their)\b/.source,
    /\bon behalf of\b/.source,
    /\b(isn'?t|is not|not)\s+(here|in|available|around)\b/.source,
    /\btake a message\b/.source,
    /\b(unki|unka|unke|uski|uska|uske)\b/.source,
    "उनकी|उनका|उनके|उसकी|उसका|उसके|ਉਹਨਾਂ ਦੀ|ਉਹਨਾਂ ਦਾ"
  ].join("|"),
  "iu"
);

/** Word end that also works after Devanagari/Gurmukhi, where `\b` never matches. */
const END = "(?=\\s|$)";

/** A short yes to "Am I speaking with X?". */
const AFFIRMATIVE = new RegExp(
  `^(yes|yeah|yep|yup|ya|yah|sure|correct|right|speaking|that'?s me|it'?s me|this is me|haan|han|haa|ha|ji|haanji|ha ji|bilkul|हाँ|हां|हा|जी|ਹਾਂ|ਜੀ|ਹਾਂਜੀ)${END}`,
  "iu"
);

/** A "no" that answers the question, not "no problem" / "no worries". */
const NEGATIVE = new RegExp(`^(no|nope|nah|not me|wrong number|nahi|nahin|नहीं|नही|ਨਹੀਂ)${END}(?!\\s+(problem|worries|issue|tension))`, "iu");

/**
 * "I'm Ravi", "this is Ravi", "my name is Ravi", "Ravi speaking". The name must be capitalised
 * (speech-to-text capitalises names), so "I'm fine" or "I'm calling about…" never reads as one.
 */
const SELF_NAME = /\b(?:[Ii]'?m|[Ii] am|[Tt]his is|[Mm]y name is|[Mm]era naam)\s+(\p{Lu}\p{L}*)|\b(\p{Lu}\p{L}*)\s+(?:here|speaking|bol raha|bol rahi)\b/u;

/** Capitalised words that start a reply but aren't names ("Yes speaking", "Haan here"). */
const NOT_NAMES = new Set(["yes", "yeah", "yep", "yup", "haan", "han", "ji", "hello", "hi", "hey", "ok", "okay", "sure", "speaking", "me", "i"]);

export type IdentityAnswer = "confirmed" | "someone-else" | "unclear";

function normalise(text: string): string {
  return text.trim().replace(/[.,!?;:"“”‘’…।]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Classifies the caller's answer to "Am I speaking with {name}?". Needs positive evidence to confirm. */
export function identityAnswer(callerWords: string, nameOnFile: string): IdentityAnswer {
  const text = normalise(callerWords);
  if (!text) return "unclear";
  if (THIRD_PARTY.test(text)) return "someone-else";
  const firstName = nameOnFile.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  // "this is Meena" on Ravi's number is someone else; "I'm Ravi" is him.
  const selfName = SELF_NAME.exec(text);
  const spoken = (selfName?.[1] ?? selfName?.[2] ?? "").toLowerCase();
  if (spoken && !NOT_NAMES.has(spoken)) return spoken === firstName ? "confirmed" : "someone-else";
  if (NEGATIVE.test(text)) return "someone-else";
  if (AFFIRMATIVE.test(text)) return "confirmed";
  return "unclear";
}

export type ConfirmCallerResult =
  | { confirmed: true; history: string[]; instruction: string }
  | { confirmed: false; answer: "someone-else" | "unclear" | "no-name"; reason: string; instruction: string };

/**
 * The confirm_caller tool. The model passes the caller's own words, and the history is handed
 * over only on positive evidence that they are the caller on file; the model's decision alone
 * is not enough (same idea as the independent "no" check on transfers).
 */
export function confirmCaller(
  session: CallSession,
  callerWords: string,
  callerTimezone: string,
  now: Date = new Date()
): ConfirmCallerResult {
  const name = session.caller.displayName;
  if (!name) {
    return {
      confirmed: false,
      answer: "no-name",
      reason: "no name is on file for this number",
      instruction: "There is nobody on file to confirm. Treat them as a new caller."
    };
  }
  const answer = identityAnswer(callerWords, name);
  if (answer === "someone-else") {
    return {
      confirmed: false,
      answer,
      reason: `the person on the line is not ${name} ("${callerWords}")`,
      instruction: `Treat them as a new caller. Share nothing about ${name}, don't save their details with update_caller_profile, and if they ask about ${name}, say the team will contact ${name} directly.`
    };
  }
  if (answer === "unclear") {
    return {
      confirmed: false,
      answer,
      reason: `it isn't clear yet that this is ${name} ("${callerWords}")`,
      instruction: `Share nothing about ${name} yet. Ask once, simply, whether you're speaking with ${name}, then call confirm_caller again with their answer.`
    };
  }
  return {
    confirmed: true,
    history: privateHistoryLines(session, callerTimezone, now),
    instruction: hasPrivateHistory(session)
      ? "This is the caller's history. Open with the single most relevant item as one short question: an upcoming booking first, else a pending callback, else the last topic. Never read out the whole list."
      : "Nothing else is on file. Ask how you can help."
  };
}

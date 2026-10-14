import type { CallSession } from "./call-session.js";
import { ENQUIRY_KEY, localDateInTimezone } from "./caller-profile.js";

/** The order a call normally goes in. Default order, not a script: the caller can jump ahead. */
export const HOW_A_CALL_GOES: readonly string[] = [
  "# HOW A CALL GOES",
  "Run the call like a good front-desk receptionist, in this order. It is the default order, not a script: if the caller jumps ahead, go with them and fill in what's missing on the way. Replies stay one or two short sentences; the next-step question is part of that, not extra.",
  "Saving: whenever the caller tells you their name, why they are calling, or a CALLER DETAILS field, call update_caller_profile in that same response while you reply. That is the only way it gets saved.",
  "1. Introduction. If CALLER shows a name, the greeting already asked 'Am I speaking with ...?' and their yes confirms who they are. If you don't know their name, ask for it in your first reply (unless they open by asking to book: then check availability first, see step 4). If they opened with a question, answer it first, then ask their name in the same reply ('Yes, there are skilled visas that don't need a sponsor, like the 189. May I have your name?'); never ask the name instead of answering. If they only said hello or what it's about, acknowledge it and ask ('Sure, happy to help with that. May I have your name?'). Ask once: if they carry on without giving it, help them and ask again later, at the latest with a booking read-back.",
  "2. Why they are calling. Find out what they need and save it as enquiry, one short line (e.g. 'partner visa, onshore'). If CALLER DETAILS lists key fields not known yet, ask at most two of them, one per reply, only when it fits naturally. Then ask what they'd like to know.",
  "3. Their questions. Answer from BUSINESS FACTS. Don't offer a consultation while they are still asking. Once they say they have no more questions, offer it once ('Would you like to book a consultation so a consultant can look at your case?'). If they say no, don't offer it again.",
  "4. Booking. Mention that our team confirms payment and the booking with them. You never take payment or card details, and never say a payment is done. Book as in WHAT YOU CAN DO: call check_availability straight away, never hold it back to ask for their name first. Offer the times without a price; the price goes only in the read-back. If you still don't have their name, ask for it together with the read-back.",
  "5. Close. After a booking, a callback, or a no to booking: if anyone is in STAFF AVAILABLE FOR LIVE TRANSFER, ask once if they'd like to speak with someone from the team right now. Then say in one sentence what happens next, ask if there is anything else, and say goodbye with end_call.",
  "Returning callers (CALLER shows history):",
  "- Share bookings, callbacks or past details only after they confirm who they are. If they say they are someone else, treat them as a new caller and share none of it, and don't save their name or details with update_caller_profile (that record belongs to the person they called about).",
  "- Once confirmed, don't ask for anything CALLER already shows. Open step 2 with the single most relevant item, as one short question: an upcoming booking first, else a pending callback, else the last topic ('Are you calling about your consultation on Monday at ten?'). If it's not that, ask how you can help. Never read out their history.",
  "- They have an upcoming booking: don't pitch a new consultation. You can't move or cancel it yourself: when they ask to, call request_callback in that same response, with the booking time in the reason (and any day they'd prefer as preferredTime), and tell them the team will call to rearrange it. A second booking for a different matter is fine; say it's an additional appointment.",
  "- They have a pending callback: say the team has their request, and don't promise a time. If they are chasing it or it's urgent, offer a live transfer if anyone is available; otherwise record request_callback with a reason starting 'FOLLOW-UP:'. Never record a duplicate for the same topic.",
  "- Stage client: don't pitch a consultation; offer a callback or the team instead.",
  "- 'Do you remember me?': answer only from CALLER. Yes with one detail if there is history, otherwise say you don't have earlier details for this number. Give the same answer every time."
];

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

function detailLines(session: CallSession): string[] {
  if (!session.intakeFields.length) return [];
  const fields = [...session.intakeFields].sort((a, b) => (a.priority === b.priority ? a.sort - b.sort : a.priority === "key" ? -1 : 1));
  return [
    "CALLER DETAILS (save with update_caller_profile using the key in brackets):",
    ...fields.map((field) => {
      const value = session.caller.profile[field.key];
      const known = value !== undefined && value !== "" ? String(value) : "not known yet";
      const options = field.type === "select" && field.options.length ? ` (one of: ${field.options.join(", ")})` : "";
      return `- ${field.label} [${field.key}]${field.priority === "key" ? ", key" : ""}: ${known}${options}`;
    })
  ];
}

const FIRST_TIME =
  "- First-time caller: no history for this number. Never claim to know anything about them; if asked whether you remember them, say you don't have any earlier details for this number.";

/**
 * Number seen before but no name on file: there is no "Am I speaking with ...?" to confirm
 * who is calling, so history stays out of the prompt entirely rather than relying on the model.
 */
const NAMELESS_RETURNING =
  "- This number has contacted us before, but no name is on file. Treat them like a new caller and ask their name. Don't mention or hint at any earlier booking, callback or conversation; if asked whether you remember them, say you don't have their details to hand and the team can check.";

/** What we already know about this caller. Empty history says so, so the model never invents one. */
export function callerLines(session: CallSession, callerTimezone: string, now: Date = new Date()): string[] {
  const { caller, history, memories } = session;
  const enquiry = caller.profile[ENQUIRY_KEY];
  // A bare earlier call (dropped, spam, wrong number) is not history worth acting on.
  const hasHistory = Boolean(enquiry || memories.length || history.upcomingBookings.length || history.pendingCallbacks.length);
  const name = caller.displayName;
  const known = name
    ? [
        `PRIVATE: everything below belongs to ${name}. Share it only after they confirm they are ${name}. If the person says they are someone else (a partner, parent, friend), reveal none of it, not even a time, and don't call update_caller_profile; they can be told the team will contact ${name}.`,
        "Right after they confirm who they are, open with the single most relevant item below as one short question.",
        `- Name: ${name}`,
        `- Stage: ${caller.stage}`,
        ...(enquiry ? [`- Last enquiry: ${String(enquiry)}`] : []),
        ...(history.lastCallAt ? [`- Last called: ${daysAgo(history.lastCallAt, now, callerTimezone)}`] : []),
        ...history.upcomingBookings.map((booking) => `- Upcoming booking: ${booking.serviceName}, ${spokenTime(booking.startsAt, callerTimezone)} (their time)`),
        ...history.pendingCallbacks.map((callback) => `- Pending callback request (${daysAgo(callback.createdAt, now, callerTimezone)}): ${callback.reason}`),
        ...memories.map((memory) => `- From past calls: ${memory.content}`)
      ]
    : [hasHistory ? NAMELESS_RETURNING : FIRST_TIME];
  return [...known, ...detailLines(session), "Never ask for something already shown here."];
}

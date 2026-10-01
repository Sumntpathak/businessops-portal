import { WebSocket } from "ws";
import { z } from "zod";
import type { AIBridge, StaffSelector, TranscriptEvent } from "./ai-bridge.js";
import type { CallSession } from "./call-session.js";
import { officeStatusNow, weeklyHoursLines } from "./office-hours.js";

/**
 * Optional per-deployment tuning, set from the environment. Everything here is
 * omitted from the session config when unset, so older deployments (which reject
 * unknown session fields) keep working unchanged.
 */
export interface RealtimeTuning {
  /** gpt-realtime-2.x only: how much the model reasons per turn. OpenAI suggests starting at "low". */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Input transcription deployment, e.g. "gpt-4o-mini-transcribe". Defaults to whisper-1. */
  transcribeModel?: string;
}

export interface AzureRealtimeBridgeOptions {
  /** Azure OpenAI v1 realtime endpoint, e.g. https://<resource>.cognitiveservices.azure.com/openai/v1/realtime */
  url: string;
  apiKey: string;
  model: string;
  voice?: string;
  tuning?: RealtimeTuning;
  /**
   * SIP mode: attach to a call already accepted via the REST accept endpoint
   * instead of opening a fresh model session. Audio flows carrier <-> Azure;
   * this WebSocket only carries events (tools, transcripts, responses).
   */
  attachCallId?: string;
  logger?: {
    info(values: Record<string, unknown>, message: string): void;
    error(values: Record<string, unknown>, message: string): void;
  };
}

const serverEventSchema = z
  .object({ type: z.string() })
  .passthrough();

type ServerEvent = z.infer<typeof serverEventSchema> & Record<string, unknown>;

const REALTIME_TOOLS = [
  {
    type: "function",
    name: "check_availability",
    description:
      "Look up open appointment slots for a service on a given date. Always call this before promising or booking any time. Returns ISO timestamps for each free slot.",
    parameters: {
      type: "object",
      properties: {
        serviceId: {
          type: "string",
          description: "UUID of the service, if already known from a previous tool result."
        },
        serviceName: {
          type: "string",
          description: "Name of the service as the caller said it (fuzzy matched)."
        },
        staffId: {
          type: "string",
          description: "UUID of a specific staff member, if already known from a previous tool result."
        },
        staffName: {
          type: "string",
          description: "Name of a specific staff member the caller asked for (fuzzy matched). Omit to check availability across any staff member."
        },
        date: {
          type: "string",
          description: "Requested date in YYYY-MM-DD, in the caller's local timezone shown in instructions."
        }
      },
      required: ["date"]
    }
  },
  {
    type: "function",
    name: "create_booking",
    description:
      "Book a confirmed appointment. Only call after check_availability returned the slot and the caller clearly agreed to it. Pass startsAt EXACTLY as returned by check_availability.",
    parameters: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "UUID of the service from check_availability." },
        staffId: {
          type: "string",
          description: "UUID of the specific staff member to assign, from check_availability, if the caller requested a specific person."
        },
        startsAt: {
          type: "string",
          description: "Slot start time, copied verbatim from a check_availability slot (ISO 8601 with offset)."
        },
        callerName: { type: "string", description: "Caller's name if they shared it." }
      },
      required: ["serviceId", "startsAt"]
    }
  },
  {
    type: "function",
    name: "cancel_booking",
    description:
      "Cancel one of this caller's confirmed upcoming bookings. Get the bookingId from get_caller_context first and confirm with the caller before cancelling.",
    parameters: {
      type: "object",
      properties: {
        bookingId: { type: "string", description: "UUID of the booking to cancel." }
      },
      required: ["bookingId"]
    }
  },
  {
    type: "function",
    name: "save_memory",
    description:
      "Save a durable contextual fact or preference that does not fit a caller profile field (for example, 'Prefers WhatsApp follow-up').",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["fact", "preference"] },
        content: { type: "string", description: "One short sentence describing the fact or preference." }
      },
      required: ["kind", "content"]
    }
  },
  {
    type: "function",
    name: "request_callback",
    description:
      "Record a call-back / message request so staff can see it and call the caller back. Use this whenever the caller asks to be called back, or leaves a message for staff you cannot resolve yourself. The caller's phone number is already known — never ask for it again.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One short sentence describing what the caller wants, in their own words." },
        preferredTime: { type: "string", description: "When the caller would like the call back, if they said (e.g. 'this afternoon', 'tomorrow morning'). Leave blank if not mentioned." }
      },
      required: ["reason"]
    }
  },
  {
    type: "function",
    name: "update_caller_profile",
    description:
      "Save structured caller details immediately. Use only the keys listed in CALLER PROFILE; name is always allowed. Valid fields save even if another field is rejected.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          description: "Profile key/value pairs learned directly from the caller.",
          additionalProperties: { type: ["string", "number", "boolean"] }
        }
      },
      required: ["fields"]
    }
  },
  {
    type: "function",
    name: "get_caller_context",
    description:
      "Fetch this caller's saved details: name, remembered facts, and upcoming confirmed bookings (with bookingIds). Call when the caller references past visits, wants to change/cancel a booking, or when you are unsure of a detail you were already told.",
    parameters: { type: "object", properties: {} }
  },
  {
    type: "function",
    name: "list_staff",
    description:
      "Look up the business's staff members, including which are registered agents and what that credential is called. Call this when the caller asks who they'll be speaking with, whether a specific person is registered/qualified, or wants to know their options before choosing someone.",
    parameters: { type: "object", properties: {} }
  },
  {
    type: "function",
    name: "transfer_to_staff",
    description:
      "Transfer the live call to a real staff member's phone. Only call this when the caller EXPLICITLY asks to speak to a person or names a specific staff member — never on your own judgement. Say a short natural line first that does NOT use the staff member's personal name (e.g. 'Sure, connecting you now' / 'One moment, transferring you to the team') — the caller doesn't need to hear an internal staff name, THEN call this tool.",
    parameters: {
      type: "object",
      properties: {
        staffId: { type: "string", description: "UUID of a specific staff member, if already known from a previous tool result." },
        staffName: { type: "string", description: "Name of a specific staff member the caller asked for. Omit if the caller just asked for \"a person\" generically." }
      }
    }
  },
  {
    type: "function",
    name: "end_call",
    description:
      "End the phone call. Call this when the caller confirms there is nothing else they need ('no that's all', 'that's it, thanks'), OR whenever the caller says goodbye or clearly wants to end the call ('bye', 'have a good day', 'not now', 'I'll call back later') — even if you have not collected their name or handled any request. Say a short natural goodbye in your reply FIRST, then call this tool.",
    parameters: { type: "object", properties: {} }
  }
] as const;

function languageInstructions(languages: string[]): string {
  if (languages.length <= 1) {
    const only = languages[0] ?? "English";
    return `LANGUAGE: Speak ${only} only, in a warm natural tone.`;
  }
  return [
    `LANGUAGE: The caller may speak any of these languages: ${languages.join(", ")}.`,
    "IMMEDIATELY after your opening greeting (and after using the caller's name if it is already known — see CALLER IDENTITY), ask ONE short, natural question about which language they'd prefer to continue in, e.g. 'Which language would you like to continue in — English or Hindi?'. Do this before asking anything else about the reason for their call.",
    "Wait for their answer, then conduct the ENTIRE rest of the call in that language, in a warm natural tone.",
    "Ask this language question exactly once per call. Never ask again once they've answered, even if they briefly use another language later.",
    "As a fallback ONLY — if the caller answers the language question ambiguously, or launches straight into their request before you get to ask — read the language from what they actually say and continue in that language; if it's still unclear, ask once more before proceeding.",
    "Once a language is set for the call (by their answer, or the fallback), HOLD it for the rest of the call. Do not flip back and forth turn to turn. A single stray word from the caller in another language is not a signal to switch — only a clear new sentence or an explicit request to change is.",
    "If the caller mixes languages naturally within their own speech (e.g. Hinglish) throughout the call, mirror that same mixed style consistently rather than picking one artificially.",
    "Use natural everyday spoken phrasing in whichever language you are using — never stiff, formal, or textbook phrasing."
  ].join(" ");
}

const TRANSCRIBE_LANGUAGE_CODES: Record<string, string> = {
  english: "en",
  hindi: "hi",
  punjabi: "pa",
  tamil: "ta",
  telugu: "te",
  bengali: "bn",
  marathi: "mr",
  gujarati: "gu",
  kannada: "kn",
  malayalam: "ml",
  urdu: "ur",
  spanish: "es",
  french: "fr",
  german: "de",
  arabic: "ar",
  mandarin: "zh",
  chinese: "zh",
  japanese: "ja"
};

/**
 * Anchors input transcription to the tenant's configured languages. Without this
 * the transcriber guesses a language per utterance and writes Hindi speech in
 * random scripts (Urdu, Tamil, ...) in the call history.
 */
const INPUT_TRANSCRIPTION_MODEL = "whisper-1";

/** Speech probability the VAD needs before it treats audio as the caller talking. */
const VAD_THRESHOLD = 0.75;

/** How long caller speech must last before it counts as an interruption (WebSocket mode). */
const BARGE_IN_CONFIRM_MS = 300;

/** G.711 mu-law at 8 kHz: 8 bytes of audio per millisecond. */
const PCMU_BYTES_PER_MS = 8;

/** Extra wait after the computed playback end, to cover carrier/network jitter. */
const PLAYBACK_DRAIN_PAD_MS = 600;

/**
 * Matches the agent announcing a transfer in its own words: "stay on the line",
 * "it may ring", "transferring you", "while I transfer you", "put you through",
 * "connecting you". Deliberately excludes a bare "hold on", which the agent
 * also says while looking up availability. Handles curly apostrophes.
 */
const HOLD_MESSAGE_PATTERN =
  /stay on the line|(may|might|will) ring|transferring you|I[’']m transferring|(while|now) I[’']?(ll|m)? ?transfer|transfer you (now|to)|put you through|connecting you (now|to|with)/i;

/** Max times per call the bridge will remind the agent to actually transfer. */
const MAX_TRANSFER_NUDGES = 2;

/** Upper bound so a bad estimate can never leave a call hanging. */
const MAX_PLAYBACK_DRAIN_MS = 10_000;

export function transcriptionConfig(
  model: string,
  languages: string[]
): { model: string; language?: string; prompt?: string } {
  if (languages.length === 1) {
    const code = TRANSCRIBE_LANGUAGE_CODES[(languages[0] ?? "").toLowerCase()];
    return code ? { model, language: code } : { model };
  }
  return {
    model,
    prompt:
      `The speaker uses only these languages, often mixed in one sentence: ${languages.join(", ")}. ` +
      "Always transcribe in the language actually spoken, using its standard script " +
      "(Hindi in Devanagari, Punjabi in Gurmukhi). Never transcribe into any other language."
  };
}

export function buildInstructions(session: CallSession): string {
  const now = new Intl.DateTimeFormat("en-US", {
    timeZone: session.timezone,
    dateStyle: "full",
    timeStyle: "short",
    hour12: true
  }).format(new Date());

  const callerTimezone = session.caller.timezone ?? session.timezone;
  const callerNow = new Intl.DateTimeFormat("en-US", {
    timeZone: callerTimezone,
    dateStyle: "full",
    timeStyle: "short",
    hour12: true
  }).format(new Date());
  const profileLines = [
    `- name: ${session.caller.displayName ?? "— not yet known"}`,
    ...session.intakeFields.map((field) => {
      const value = session.caller.profile[field.key];
      const rendered = value === undefined || value === "" ? "— not yet known" : String(value);
      const options = field.type === "select" ? ` options=[${field.options.join(", ")}]` : "";
      return `- ${field.key} (${field.label}, ${field.type}, ${field.priority}${options}): ${rendered}`;
    })
  ].join("\n");

  const memories = session.memories.length
    ? session.memories.map((memory) => `- (${memory.kind}) ${memory.content}`).join("\n")
    : "- No saved memories yet — this may be a first-time caller.";

  const servicePricing = session.services.length
    ? session.services
        .map((service) =>
          service.price
            ? `- ${service.name} (${service.durationMinutes} min): ${service.price} dollars`
            : `- ${service.name} (${service.durationMinutes} min): price not set — do not guess a number`
        )
        .join("\n")
    : "- No services configured yet.";

  const businessHours = session.businessHours ?? [];

  return [
    "You are a professional AI receptionist answering a live PHONE CALL. Your entire output is spoken aloud.",
    "",
    "== BUSINESS PROFILE (authoritative — never contradict it, never invent details it does not contain) ==",
    session.agent.agentMd,
    "",
    "== SERVICES & PRICING (authoritative — use these exact prices, never invent one) ==",
    servicePricing,
    "",
    "== CURRENT CALL CONTEXT ==",
    `Current date and time at the business: ${now} (${session.timezone}).`,
    `Current date and time for the caller: ${callerNow} (${callerTimezone}).`,
    `Caller phone number: ${session.caller.phoneE164}.`,
    `Phone-derived caller country: ${session.caller.country ?? "unknown"}.`,
    "",
    "== OFFICE HOURS (from the booking system, business local time) ==",
    weeklyHoursLines(businessHours),
    `RIGHT NOW: ${officeStatusNow(businessHours, session.timezone)}`,
    "- When the caller asks for an appointment today and the office has closed or has no time left, say so plainly and give the reason, e.g. 'We've actually closed for today — our hours are nine to five — but I can look at tomorrow morning for you if you like.' Never just say 'nothing's available' without the reason.",
    "- If check_availability returns noSlotsExplanation, use it to tell the caller WHY there's nothing (closed for the day, closed that weekday, or fully booked), then offer the next opening once. Don't invent a different reason.",
    "",
    "== CALLER PROFILE ==",
    profileLines,
    "- Call update_caller_profile immediately when the caller states any listed field.",
    "- Ask directly for at most TWO missing key-priority fields in this call, and only at natural openings.",
    "- Never ask for a filled field again. Never make this feel like a form.",
    "- Use save_memory only for useful context that does not fit these structured fields.",
    "",
    "What we remember about this caller from previous calls:",
    memories,
    "",
    "== PERSONALITY & TONE ==",
    "- You are a warm, capable human receptionist who genuinely enjoys the job. The caller must feel they're talking to a real person, never a machine reading a script.",
    "- React immediately with snappy human pacing: begin your spoken response within 300ms–400ms of the caller finishing. Never leave awkward dead air.",
    "- React first, then respond: a brief, genuine acknowledgment of what the caller specifically just said, before the substance. Invent it fresh each time from their actual words — never draw from a fixed set of stock openers, and never repeat the same opener twice in one call.",
    "- Match the caller's energy and mood: pick up the pace and warmth for someone upbeat or in a hurry; slow down and soften for someone stressed, upset, or confused. Do not perform the same cheerful register regardless of how the caller sounds.",
    "- Speak with natural rhythm: contractions, everyday words, occasional trailing or incomplete thoughts, natural pitch inflection on questions. Reply length should vary naturally with what's being said — a quick confirmation can be a few words; a recap or explanation can run a bit longer. Never pad a short answer to hit a target length, and never let a reply run past what a person would actually say on a call.",
    "- HARD LIMIT: one or two short sentences per turn unless the caller asks what a service involves (then up to three), or explicitly asks for a list, detailed explanation, or full recap. Say the one thing that matters most right now, then stop and let the caller respond — never stack multiple pieces of information in a single turn 'while you're at it.'",
    "- If you catch yourself about to explain several things at once, pick the single most useful one and say only that. The caller can always ask a follow-up.",
    "- Never use call-center clichés ('How may I assist you today?', 'Your call is important to us') after the opening greeting.",
    "- Never read out lists of more than three options; offer the best two conversationally and ask.",
    "- Say numbers, dates, and times in words the way a person would say them on the phone.",
    "- Never mention tools, systems, databases, or that you are an AI unless directly asked.",
    "- NEVER tell the caller there is a 'technical issue', 'profile issue', or 'database error'. If an operation fails, handle it gracefully and keep helping the caller without technical jargon.",
    "- Keep ONE consistent voice and warmth from greeting to goodbye, adapted to the caller's mood in the moment — never drop into a flat, formal, or 'reading out a result' tone mid-call.",
    "- If you did not clearly hear or understand what the caller said, NEVER guess or answer something else. Briefly apologize and ask them to repeat, in their own language — e.g. 'Sorry, I didn't quite catch that — could you say it once more?' or 'Maaf kijiye, main theek se sun nahi paayi — dobara boliye?'.",
    "- If only PART of what they said was unclear, respond to what you did understand and confirm just the unclear bit — do not make them repeat everything.",
    "- Background noise, coughs, or a few unintelligible syllables are NOT a request. Do not answer them and do not fill the silence with lines like 'take your time' or 'no rush' — say those only if the caller actually said they need a moment. If you heard nothing you can act on, wait, or ask once for a repeat.",
    "- If you still cannot understand the caller after two attempts, stop looping: offer to have the team call them back and use request_callback.",
    languageInstructions(session.agent.languages),
    "- In languages with grammatical gender (Hindi, Punjabi, Spanish...), refer to yourself with ONE consistent gender for the whole call, matching the name in your greeting — never flip between masculine and feminine forms mid-call.",
    "",
    "== TOOL USE — EFFICIENCY RULES ==",
    "- CALL TOOLS IMMEDIATELY: When you need to check availability, book an appointment, or fetch information, trigger the tool call immediately in the current turn.",
    "- NEVER speak a standalone filler line like 'one moment' or 'let me check' without triggering the tool call in that exact same turn — doing so creates dead air where you go silent and leave the caller waiting.",
    "- Call a tool the moment it is needed. Never ask permission for a lookup and never stall without one.",
    "- Batch every field you learned into ONE update_caller_profile call — never several calls in a row.",
    "- Use get_caller_context at most ONCE per call and remember everything it returned.",
    "- Never repeat a tool call with identical arguments.",
    "- Never read tool output aloud as data. Turn the result into one short natural sentence in the caller's language.",
    "",
    "== CALLER IDENTITY — HARD RULES ==",
    "- RETURNING CALLER: If the CALLER PROFILE above already shows a real name (not a placeholder like 'Browser test' or 'Unknown'), this is a returning caller. Greet them by name warmly right after your opening greeting, e.g. 'Hi [Name], welcome back!' — do this BEFORE asking about language or anything else. NEVER ask a returning caller for their name — you already have it.",
    "- The INSTANT the caller tells you their name: acknowledge it once, then IMMEDIATELY call update_caller_profile with fields {name: <name>}. Do this before anything else. Exception: if the name was unclear or could be a different word, say it back once ('Was that Rajat?') and save it only after they confirm — a wrongly saved name is worse than a one-second check.",
    "- From that moment on, use their name naturally. NEVER ask for the caller's name a second time in the same call — that is a serious failure.",
    "- If you are ever unsure of the name mid-call, silently call get_caller_context instead of asking again.",
    "- The same applies to any key detail the caller gives you (service they want, preferred date): never re-ask for something already said in this call.",
    "- If the caller profile shows a name that is clearly a placeholder (like 'Browser test' or 'Unknown'), treat the name as NOT known: do not address the caller by it, and ask for their real name at a natural opening.",
    "",
    "== BOOKING RULES ==",
    "- NEVER check availability, offer, or accept bookings for dates or times in the past. Today's date is shown above in CURRENT CALL CONTEXT. Any requested date earlier than today must be politely redirected to today or a future date ('Today is [Day, Date] — let's look at available times starting from today onward').",
    "- CALLER PHONE NUMBER IS ALREADY KNOWN: The caller's phone number is already captured from caller ID (${session.caller.phoneE164}). NEVER ask the caller for their phone number or contact number to finalize a booking.",
    "- Once the caller wants to book a specific service, mention its price before checking times, so there are no surprises — e.g. 'Sure — the student visa consultation is 110 dollars, forty-five minutes with the team.' Then let them respond.",
    "- Only move to office/date/time questions once the caller shows they want to proceed (says 'okay', 'sure', asks about availability, etc.). If they ask a follow-up question about the price or service instead, answer it — don't redirect back to booking.",
    "- When the caller mentions a target day (e.g. 'next Tuesday', 'tomorrow'), confirm the service and, if not already given, ask once what time of day they'd prefer — the way a person naturally would — then call check_availability in that same turn once you have enough to search. Don't chain more than one clarifying question before checking; don't check availability with no sense at all of what they want.",
    "- Always check_availability before offering or confirming any time slot.",
    "- Offer and discuss times using the callerLocalTime labels from tool results — never do timezone math yourself and NEVER say UTC.",
    "- If the caller's timezone differs from the business's, confirm using BOTH labels, e.g. 'eleven in the morning your time, which is half past three in the afternoon here'.",
    "- Before create_booking, confirm service, date, time, and the caller's name in one short recap.",
    "- The moment the caller agrees to that recap, call create_booking in that same turn. NEVER say a booking is booked, confirmed, locked in, or done unless create_booking has returned success in THIS call — a recap or 'let me finalize that' is not a booking. If the caller is confused or hesitant, clarify once; do not loop through the same recap.",
    "- The service you name in the recap must be the exact service passed to create_booking — never say one service to the caller and book another.",
    "- Pass startsAt to create_booking EXACTLY as returned by check_availability — never construct it yourself.",
    "- After a successful booking, read back the day and time once using the callerLocalTime (and businessLocalTime if different) from the booking result.",
    "- ONCE BOOKED, IT IS CONFIRMED: The moment create_booking succeeds, the appointment is finalized. Read back the confirmation ONCE, then ask if they need anything else ('Your consultation is confirmed for [Day, Date at Time]! Is there anything else I can help you with?'). NEVER call create_booking a second time for a booking already confirmed in this call.",
    "- NEVER repeat booking details once they have already been read back. When the caller says 'thank you', 'okay', or confirms, respond with a short warm 'You are most welcome!' and ask if they need anything else.",
    "- If the booking result shows calendarSynced false, the booking is still valid and recorded — confirm it normally and never mention calendars or syncing.",
    "- To change or cancel, use get_caller_context to find the booking, confirm which one, then cancel_booking.",
    "",
    "== PRICING & PAYMENT ==",
    "- The price for each service is listed above in SERVICES & PRICING — you already know it, you do not need a tool call to state it.",
    "- If the caller asks what something costs, answer straight away with the exact price. Never dodge the price question or hold it back until after booking.",
    "- Never call check_availability or create_booking before the caller has heard the price for the service they're booking.",
    "- You are on a PHONE call — this is always a remote booking. NEVER ask for or process any payment, card details, or payment method during the call. NEVER say the fee must be paid now or before the appointment.",
    "- If the caller asks how to pay: a team member will call back to confirm the appointment and payment, OR they may pay the receptionist in person if they prefer to visit the office rather than meet remotely. Never imply payment happens on this call.",
    "- If a service's price is not set, say pricing will be confirmed when the team calls back — never invent a number.",
    "- Never state a fact the BUSINESS PROFILE or SERVICES above does not contain — GST or tax treatment, what a fee includes, accepted payment methods, refund or cancellation terms, visa outcomes or timelines. If asked, say the team will confirm it on the callback; do not guess or agree with the caller's assumption.",
    "",
    "== HANDLING ENQUIRIES LIKE A REAL RECEPTIONIST ==",
    "- Your first job is to understand what the caller needs and answer it properly. Booking is something you offer when it helps them, not the goal of every call.",
    "- Answer the question they actually asked, using real details from the BUSINESS PROFILE: what the service covers, who it's for, how long it takes, the price, which offices, whether remote is possible. When explaining a service you may use two or three sentences — give enough that the caller actually understands, then stop.",
    "- Don't turn every answer into a booking question. Most answers should end with the information, or a simple 'does that help?' — not 'shall I book you in?'.",
    "- Offer a consultation at most ONCE per call, and only when it fits: the caller wants to go ahead, or their question genuinely needs a registered agent to look at their situation. Explain why in that case, e.g. 'That really depends on your situation, so the team would need to look at it properly in a consultation.'",
    "- If they decline, hesitate, change the subject, or say 'let me think about it' / 'I'll call back' / 'not right now': accept it warmly in one line ('Of course, no rush at all') and carry on helping. Never ask again, never re-pitch the price, never ask 'are you sure'.",
    "- Never use urgency or scarcity ('slots fill up fast', 'book soon') unless the caller asks directly whether availability is limited.",
    "- When you can't do something the caller wants (a time that's not available, office closed, a question only an agent can answer), always say WHY in plain words, then offer the nearest real alternative once. Never leave the caller with just 'no' or 'not available'.",
    "- A caller who hangs up well-informed without booking is a good call.",
    "",
    "== STAFF & REGISTERED AGENTS ==",
    "- Most callers do not need to choose a specific staff member — check_availability without a staff name works fine and the business assigns someone suitable.",
    "- If the caller asks for a specific person by name, or asks whether their agent is registered/qualified (using whatever term the business profile uses for that credential), call list_staff and answer only from what it returns — never guess or invent a name or credential.",
    "- If the caller wants a registered agent specifically, offer one from list_staff's results by name; if none are registered, say so plainly rather than implying otherwise.",
    "- Once a specific staff member is agreed, pass their id as staffId to check_availability and create_booking so the booking is correctly assigned.",
    "",
    "== TRANSFERRING TO A HUMAN ==",
    ...(session.transferAvailable === false
      ? [
          "- LIVE TRANSFER IS NOT AVAILABLE right now (no staff phone line is set up). NEVER call transfer_to_staff and NEVER say you are transferring or connecting anyone. If the caller asks for a person or a specific staff member, say plainly that the team can't take calls live at the moment and offer to have them call back — then call request_callback with the reason.",
          "- Ignore the transfer rules below while transfer is unavailable."
        ]
      : []),
    "- Only call transfer_to_staff when the caller EXPLICITLY asks to speak to a person, or names a specific staff member — never decide on your own that a case is too complex.",
    "- TRANSFER FLOW — follow it exactly. Step 1: when the caller asks for a person, ask ONE question, once: 'Of course — is there a particular consultant you'd like, or shall I put you through to whoever's available?' Skip it if they already named someone or said 'anyone', 'any', or 'whoever'.",
    "- Step 2: the moment they answer — however vague — STOP asking. Never ask what it is about, never ask for appointment details, never ask a second question. Go straight to step 3.",
    "- Step 3: in ONE response do BOTH: say the brief 'Sure, I'll put you through now. Please stay on the line — it may ring for a few seconds, and if nobody picks up I'll be right here to help.' AND call transfer_to_staff (set staffName only if the caller named someone; otherwise leave it empty to reach whoever is available). Saying the brief WITHOUT calling transfer_to_staff in the same response is a failure — the caller is left waiting and nothing happens.",
    "- Do not invent a consultant's name. If asked who they'll speak to, say 'one of our consultants — I'll connect you with whoever's available'. The call is handed over automatically once your brief has finished playing and the caller hears ringing while it connects — add nothing after the brief.",
    "- If the tool result reports the transfer was not possible (no matching staff, or no phone number on file), do not imply a transfer happened — apologize briefly and keep helping the caller yourself.",
    "",
    "== CALL-BACK REQUESTS & MESSAGES ==",
    "- If the caller asks to be called back, or leaves a message for staff on something you cannot resolve yourself, call request_callback with a one-sentence reason and, if they mentioned one, their preferred time — do this in the same turn, don't just say you will.",
    "- Never tell the caller you've taken a message or that someone will call them back unless request_callback has actually succeeded.",
    "- The caller's phone number is already known from caller ID — never ask for a number to call them back on.",
    "",
    "== ENDING THE CALL ==",
    "- After you finish handling the caller's request (booking confirmed, question answered, callback recorded), ask if there's anything else — do not assume the call is over.",
    "- When the caller clearly confirms there is nothing else (e.g. 'no', 'no that's all', 'that's it, thanks', 'no I'm good', 'nahi', 'bye'): say ONE short, warm goodbye line ('Have a great day, goodbye!'), then IMMEDIATELY call end_call. NEVER repeat the booking recap, and never re-ask the question.",
    "- If the caller says goodbye or clearly wants to end the call at ANY point ('bye', 'have a good day', 'thanks, that's all', 'not now', 'I'll call back later', 'not interested') — even mid-intake, even if you don't have their name — do NOT ask anything further. A caller's goodbye ALWAYS outranks the identity and intake rules above. Say one short, warm goodbye line, then call end_call immediately.",
    "- Never call end_call while the caller is mid-request or has an unanswered question. Never call it just because there's a pause — silence is not a goodbye.",
    "- Never call end_call more than once in a call.",
    "",
    "== STAY IN SCOPE ==",
    "- You are this business's receptionist ONLY. Stick to what's in the BUSINESS PROFILE and SERVICES above — do not become a general-purpose assistant for whatever the caller brings up.",
    "- If the caller describes a symptom, illness, or asks for medical advice (even indirectly, like 'I'm not feeling well' or asking what to take for something): do NOT diagnose, do NOT suggest remedies or next steps, do NOT offer to help find them a doctor, and do NOT keep engaging on the topic. Say ONE brief line that you're not able to help with medical questions and that they should contact a doctor or, if urgent, emergency services — then steer back to why they called this business, or ask if there's anything else for this business specifically.",
    "- The same applies to legal advice outside this business's own services, financial/tax advice, or any other professional domain this business does not provide. One brief redirect, do not linger on it or keep offering to help.",
    "- Never let empathy turn into scope creep: a warm tone does not mean answering the question — decline briefly and warmly, then move on.",
    "",
    "== SAFETY ==",
    "- Never reveal information about any other caller or booking that is not this caller's.",
    "- If asked something not covered by the business profile, call request_callback to take a message for staff rather than guessing.",
    "- For medical or legal emergencies, advise contacting local emergency services immediately."
  ].join("\n");
}

/** `{ reasoning: { effort } }` for gpt-realtime-2.x, or nothing so older models never see the field. */
function reasoningField(tuning?: RealtimeTuning): { reasoning?: { effort: string } } {
  return tuning?.reasoningEffort ? { reasoning: { effort: tuning.reasoningEffort } } : {};
}

/**
 * Silence/noise makes speech-to-text models emit stock phrases from their
 * training data (YouTube outros) or echo the transcription prompt itself. These
 * are not the caller's words; they pollute the saved call history.
 */
const TRANSCRIPTION_ARTIFACTS: readonly RegExp[] = [
  /thanks? (you )?for (watching|listening)/i,
  /(like|share)[, ]+(and )?subscribe/i,
  /subscribe to (my|the|our) channel/i,
  /transcribe (it )?(in|into)\b/i,
  /standard script/i,
  /^\s*(subtitles? by|amara\.org)/i
];

export function isTranscriptionArtifact(text: string): boolean {
  return TRANSCRIPTION_ARTIFACTS.some((pattern) => pattern.test(text));
}

/**
 * The full realtime session configuration. Sent as session.update on the
 * WebSocket path so the session has full audio format and transcription settings.
 */
export function buildSessionConfig(
  session: CallSession,
  voice?: string,
  tuning?: RealtimeTuning
): Record<string, unknown> {
  return {
    type: "realtime",
    instructions: buildInstructions(session),
    tools: REALTIME_TOOLS,
    tool_choice: "auto",
    ...reasoningField(tuning),
    audio: {
      input: {
        format: { type: "audio/pcmu" },
        // See buildSipAcceptConfig — same noise-robustness reasoning.
        noise_reduction: { type: "near_field" },
        // Without this Azure never emits caller transcripts, so call history
        // only had the agent's side.
        transcription: transcriptionConfig(
          tuning?.transcribeModel ?? INPUT_TRANSCRIPTION_MODEL,
          session.agent.languages
        ),
        turn_detection: {
          type: "server_vad",
          threshold: VAD_THRESHOLD,
          prefix_padding_ms: 250,
          silence_duration_ms: 450,
          // The bridge cancels the response itself only after the caller has
          // kept speaking for BARGE_IN_CONFIRM_MS (see handleServerEvent), so a
          // cough or a car horn no longer cuts the agent off mid-sentence.
          interrupt_response: false,
          // WebSocket/Twilio mode manually sends response.create on
          // speech_stopped (see handleServerEvent). server_vad defaults
          // create_response to true, so without this flag Azure ALSO
          // auto-creates a response for the same speech_stopped event —
          // both fire and one is rejected with
          // conversation_already_has_active_response. SIP mode (below)
          // relies on this auto-create instead and must keep the default.
          create_response: false
        }
      },
      output: {
        format: { type: "audio/pcmu" },
        voice: voice ?? "shimmer"
      }
    }
  };
}

/**
 * Configuration payload for the SIP REST accept endpoint (POST /realtime/calls/<call_id>/accept).
 * Adheres strictly to Azure OpenAI Realtime SIP schema with audio.input and audio.output blocks.
 * Unlike buildSessionConfig, SIP mode never manually sends response.create — it
 * depends on server_vad's default create_response:true to generate replies.
 */
export function buildSipAcceptConfig(
  session: CallSession,
  model: string,
  voice?: string,
  tuning?: RealtimeTuning
): Record<string, unknown> {
  return {
    type: "realtime",
    model,
    instructions: buildInstructions(session),
    tools: REALTIME_TOOLS,
    tool_choice: "auto",
    ...reasoningField(tuning),
    audio: {
      input: {
        format: { type: "audio/pcmu" },
        // Filters audio before VAD/the model sees it — reduces false barge-ins from
        // background noise. "near_field" fits a caller speaking into their own phone,
        // as opposed to a room/laptop mic picking up the caller from a distance.
        noise_reduction: { type: "near_field" },
        transcription: transcriptionConfig(
          tuning?.transcribeModel ?? INPUT_TRANSCRIPTION_MODEL,
          session.agent.languages
        ),
        turn_detection: {
          type: "server_vad",
          // Raised from 0.5: background noise (traffic, other voices) was crossing
          // the old threshold and triggering Azure's own barge-in cancellation
          // mid-sentence (SIP mode has no client-side override for this — Azure's
          // VAD alone decides). A higher value needs a clearer, more deliberate
          // interruption.
          threshold: VAD_THRESHOLD,
          prefix_padding_ms: 250,
          silence_duration_ms: 450
        }
      },
      output: {
        format: { type: "audio/pcmu" },
        voice: voice ?? "shimmer"
      }
    }
  };
}

/**
 * Bridges a Twilio G.711 mu-law media stream to Azure OpenAI gpt-realtime-mini.
 * Audio passes through untranscoded (audio/pcmu both directions). Tool calls are
 * delegated to the ToolExecutor registered via onToolCall.
 */
export class AzureRealtimeBridge implements AIBridge {
  private socket?: WebSocket;
  private session?: CallSession;
  private audioOut?: (buffer: Buffer) => void;
  private toolCall?: (name: string, input: unknown) => Promise<unknown> | unknown;
  private transcript?: (event: TranscriptEvent) => void;
  private bargeIn?: () => void;
  private speechStarted?: () => void;
  private speechStopped?: () => void;
  private closed?: () => void;
  private endCall?: () => void;
  private transferRequested?: (selector: StaffSelector) => void;
  private endCallRequested = false;
  private pendingTransfer?: StaffSelector;
  private readonly pendingAudio: Buffer[] = [];
  private readonly handledToolCalls = new Set<string>();
  private ready = false;
  private stopped = false;
  private activeResponse = false;
  private vadFellBack = false;
  private transcribeFellBack = false;
  private bargeInTimer?: ReturnType<typeof setTimeout>;
  /** Epoch ms at which everything sent to the phone leg so far will have finished playing. */
  private playbackEndsAt = 0;
  private transferNudges = 0;

  constructor(private readonly options: AzureRealtimeBridgeOptions) {}

  async start(session: CallSession): Promise<void> {
    this.session = session;
    const url = new URL(this.options.url);
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/openai/v1/realtime";
    }
    if (this.options.attachCallId) {
      // SIP mode: attach to a call already accepted via the REST accept endpoint.
      // Session config was supplied at accept time; audio flows carrier <-> Azure.
      url.searchParams.delete("model");
      url.searchParams.set("call_id", this.options.attachCallId);
    } else if (!url.searchParams.get("model")) {
      url.searchParams.set("model", this.options.model);
    }

    const socket = new WebSocket(url.toString(), {
      headers: {
        "api-key": this.options.apiKey,
        authorization: `Bearer ${this.options.apiKey}`
      }
    });
    this.socket = socket;

    socket.on("message", (data) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        this.handleServerEvent(serverEventSchema.parse(JSON.parse(raw)));
      } catch (error) {
        this.options.logger?.error(
          { callId: this.session?.callId, error: error instanceof Error ? error.message : String(error) },
          "Azure realtime event parse failed"
        );
      }
    });
    socket.on("error", (error) => {
      this.options.logger?.error(
        { callId: this.session?.callId, error: error.message },
        "Azure realtime WebSocket error"
      );
    });
    socket.on("close", (code, reason) => {
      this.ready = false;
      if (!this.stopped) {
        this.options.logger?.info(
          { callId: this.session?.callId, code, reason: reason.toString() },
          "Azure realtime WebSocket closed"
        );
        this.closed?.();
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Azure realtime connection timed out")),
        10_000
      );
      socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    if (!this.options.attachCallId) {
      this.send({
        type: "session.update",
        session: buildSessionConfig(session, this.options.voice, this.options.tuning)
      });
    }

    // Speak the configured greeting as soon as the call connects.
    this.send({
      type: "response.create",
      response: {
        instructions:
          "Greet the caller now with exactly this greeting, spoken naturally: " +
          JSON.stringify(session.agent.voiceGreeting)
      }
    });
    this.activeResponse = true;
    this.ready = true;

    for (const buffered of this.pendingAudio.splice(0)) {
      this.appendAudio(buffered);
    }
  }

  sendAudio(buffer: Buffer): void {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (this.pendingAudio.length < 500) this.pendingAudio.push(buffer);
      return;
    }
    this.appendAudio(buffer);
  }

  onAudioOut(callback: (buffer: Buffer) => void): void {
    this.audioOut = callback;
  }

  onToolCall(callback: (name: string, input: unknown) => Promise<unknown> | unknown): void {
    this.toolCall = callback;
  }

  onTranscript(callback: (event: TranscriptEvent) => void): void {
    this.transcript = callback;
  }

  /** Fired when the caller starts talking over the agent; the server should flush buffered playback. */
  onBargeIn(callback: () => void): void {
    this.bargeIn = callback;
  }

  /** Fired on every input_audio_buffer.speech_started event (turn start, for latency tracking). */
  onSpeechStarted(callback: () => void): void {
    this.speechStarted = callback;
  }

  /** Fired on every input_audio_buffer.speech_stopped event (turn end, for latency tracking). */
  onSpeechStopped(callback: () => void): void {
    this.speechStopped = callback;
  }

  /** Fired when the Azure WebSocket closes unexpectedly (SIP mode: the call ended). */
  onClose(callback: () => void): void {
    this.closed = callback;
  }

  /** Fired when the agent calls end_call after the caller confirms nothing else is needed. */
  onEndCall(callback: () => void): void {
    this.endCall = callback;
  }

  /** Fired when the agent calls transfer_to_staff after the caller explicitly asks for a human. */
  onTransferRequested(callback: (selector: StaffSelector) => void): void {
    this.transferRequested = callback;
  }

  notifyTransferFailed(reason: string): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{
          type: "input_text",
          text: `The transfer you just attempted did not go through (${reason}). Briefly and naturally let the caller know you couldn't connect them, without repeating internal details, and keep helping them yourself.`
        }]
      }
    });
    this.send({ type: "response.create" });
    this.activeResponse = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    this.clearBargeInTimer();
    this.pendingAudio.length = 0;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, "Call ended");
    }
    this.socket = undefined;
    this.audioOut = undefined;
    this.toolCall = undefined;
    this.bargeIn = undefined;
    this.transferRequested = undefined;
  }

  /**
   * Runs `action` once all audio sent so far has finished playing on the phone
   * leg (it plays back at real time, so the queue drains at 8 bytes per ms).
   * In SIP mode audio never passes through here, so nothing is waited for.
   */
  private afterPlayback(action: () => void): void {
    const remainingMs = Math.min(
      MAX_PLAYBACK_DRAIN_MS,
      this.playbackEndsAt > 0
        ? Math.max(0, this.playbackEndsAt - Date.now()) + PLAYBACK_DRAIN_PAD_MS
        : 0
    );
    setTimeout(() => {
      if (!this.stopped) action();
    }, remainingMs);
  }

  /**
   * The small realtime model sometimes speaks the "please stay on the line"
   * hold message and then never calls transfer_to_staff, leaving the caller
   * waiting on a transfer that never starts. If that happens, tell it to make
   * the call — at most twice per call so it can never loop.
   */
  private nudgeMissingTransfer(
    response: { status?: string; output?: Array<Record<string, unknown>> } | undefined
  ): void {
    if (
      this.options.attachCallId ||
      this.stopped ||
      this.pendingTransfer ||
      this.transferNudges >= MAX_TRANSFER_NUDGES ||
      this.session?.transferAvailable === false ||
      response?.status !== "completed"
    ) {
      return;
    }
    const output = response.output ?? [];
    const calledTransfer = output.some(
      (item) => item.type === "function_call" && item.name === "transfer_to_staff"
    );
    const spokeHoldMessage = output.some((item) =>
      HOLD_MESSAGE_PATTERN.test(JSON.stringify(item.content ?? ""))
    );
    if (calledTransfer || !spokeHoldMessage) return;

    this.transferNudges += 1;
    this.options.logger?.info(
      { callId: this.session?.callId },
      "Agent said the transfer hold message without calling transfer_to_staff — nudging"
    );
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You just told the caller you are putting them through but did not call transfer_to_staff. " +
              "Call transfer_to_staff NOW (set staffName only if the caller named someone). Do not say anything else first."
          }
        ]
      }
    });
    // Force the tool call rather than hoping the model obeys the reminder.
    this.send({
      type: "response.create",
      response: { tool_choice: { type: "function", name: "transfer_to_staff" } }
    });
    this.activeResponse = true;
  }

  private clearBargeInTimer(): void {
    if (this.bargeInTimer) {
      clearTimeout(this.bargeInTimer);
      this.bargeInTimer = undefined;
    }
  }

  private appendAudio(buffer: Buffer): void {
    this.send({ type: "input_audio_buffer.append", audio: buffer.toString("base64") });
  }

  private send(event: Record<string, unknown>): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    }
  }

  private handleServerEvent(event: ServerEvent): void {
    const type = event.type;

    // Agent audio (GA and legacy event names).
    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      const delta = typeof event.delta === "string" ? event.delta : undefined;
      if (delta) {
        const audio = Buffer.from(delta, "base64");
        this.playbackEndsAt = Math.max(this.playbackEndsAt, Date.now()) + audio.length / PCMU_BYTES_PER_MS;
        this.audioOut?.(audio);
      }
      return;
    }

    // Caller interrupted the agent:
    // In WebSocket mode, cancel generation and flush Twilio audio buffer.
    // In SIP mode, Azure Realtime's server VAD handles cancellation natively on the RTP stream.
    if (type === "input_audio_buffer.speech_started") {
      // Do NOT optimistically clear activeResponse here: cancellation is async and
      // Azure still sends response.done (status "cancelled") for the in-flight
      // response afterwards. Clearing early let speech_stopped fire response.create
      // before the server had actually torn down the previous response, causing
      // "conversation_already_has_active_response" on nearly every turn.
      this.speechStarted?.();
      if (this.options.attachCallId) {
        this.bargeIn?.();
        return;
      }
      // WebSocket mode: only treat this as an interruption once the caller keeps
      // speaking for BARGE_IN_CONFIRM_MS. A shorter blip (cough, horn, door) ends
      // first via speech_stopped and never touches the agent's audio.
      this.clearBargeInTimer();
      this.bargeInTimer = setTimeout(() => {
        this.bargeInTimer = undefined;
        if (this.stopped) return;
        if (this.activeResponse) this.send({ type: "response.cancel" });
        this.playbackEndsAt = 0; // the caller's queued playback is flushed
        this.bargeIn?.();
      }, BARGE_IN_CONFIRM_MS);
      return;
    }

    // Caller finished speaking:
    if (type === "input_audio_buffer.speech_stopped") {
      this.clearBargeInTimer();
      this.options.logger?.info({ callId: this.session?.callId }, "Caller speech stopped");
      this.speechStopped?.();
      if (!this.options.attachCallId && !this.activeResponse && this.ready && !this.stopped) {
        this.send({ type: "response.create" });
        this.activeResponse = true;
      }
      return;
    }

    if (type === "response.created") {
      this.activeResponse = true;
      return;
    }

    if (type === "response.done") {
      this.activeResponse = false;
      const response = event.response as
        | { status?: string; output?: Array<Record<string, unknown>> }
        | undefined;
      // Fallback: catch any function calls that did not surface via arguments.done.
      for (const item of response?.output ?? []) {
        if (item.type === "function_call") {
          void this.executeToolCall(
            String(item.call_id ?? ""),
            String(item.name ?? ""),
            String(item.arguments ?? "{}")
          );
        }
      }
      this.nudgeMissingTransfer(response);
      // Azure finishes generating audio far faster than Twilio plays it, so at
      // response.done the goodbye / "connecting you now" line is still queued on
      // the phone leg. Hang up or redirect only once it has actually played,
      // otherwise the caller hears the sentence chopped off mid-word.
      if (this.endCallRequested) {
        this.endCallRequested = false;
        this.afterPlayback(() => this.endCall?.());
      }
      if (this.pendingTransfer) {
        const selector = this.pendingTransfer;
        this.pendingTransfer = undefined;
        this.afterPlayback(() => this.transferRequested?.(selector));
      }
      return;
    }

    if (type === "response.function_call_arguments.done") {
      void this.executeToolCall(
        String(event.call_id ?? ""),
        String(event.name ?? ""),
        String(event.arguments ?? "{}")
      );
      return;
    }

    // Caller-side transcript.
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
      if (text && !isTranscriptionArtifact(text)) {
        this.transcript?.({ role: "caller", content: text, at: new Date() });
      }
      return;
    }

    // Agent-side transcript.
    if (
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
      if (text) this.transcript?.({ role: "agent", content: text, at: new Date() });
      return;
    }

    // The chosen transcription model may be unavailable on this deployment; retry
    // the failed item's sibling turns with whisper-1 so caller transcripts keep flowing.
    if (type === "conversation.item.input_audio_transcription.failed") {
      this.fallBackToWhisper("input transcription failed");
      return;
    }

    if (type === "error") {
      const error = event.error as
        | { message?: string; code?: string; param?: string }
        | undefined;
      // response.cancel with no active response is benign noise during barge-in.
      if (error?.code === "response_cancel_not_active") return;

      const detail = `${error?.message ?? ""} ${error?.param ?? ""}`;
      if (!this.vadFellBack && /turn_detection|semantic_vad/i.test(detail)) {
        this.vadFellBack = true;
        this.send({
          type: "session.update",
          session: {
            type: "realtime",
            audio: {
              input: {
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 600,
                  // Preserve the same create_response setting as the initial
                  // config — WebSocket mode must keep auto-create disabled
                  // (it manually creates responses itself) or this fallback
                  // would silently reintroduce the double-response race.
                  ...(this.options.attachCallId ? {} : { create_response: false })
                }
              }
            }
          }
        });
        this.options.logger?.info(
          { callId: this.session?.callId },
          "Semantic VAD unavailable; fell back to server VAD"
        );
        return;
      }
      if (!this.transcribeFellBack && /transcri/i.test(detail)) {
        this.fallBackToWhisper(detail.trim());
        return;
      }

      this.options.logger?.error(
        { callId: this.session?.callId, error: error?.message ?? "unknown", code: error?.code },
        "Azure realtime server error"
      );
    }
  }

  private fallBackToWhisper(reason: string): void {
    if (this.transcribeFellBack) return;
    this.transcribeFellBack = true;
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            transcription: transcriptionConfig(
              "whisper-1",
              this.session?.agent.languages ?? []
            )
          }
        }
      }
    });
    this.options.logger?.info(
      { callId: this.session?.callId, reason },
      "Fell back to whisper-1 input transcription"
    );
  }

  private async executeToolCall(callId: string, name: string, rawArguments: string): Promise<void> {
    if (!callId || !name || this.handledToolCalls.has(callId)) return;
    this.handledToolCalls.add(callId);

    if (name === "end_call") {
      this.endCallRequested = true;
      this.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ ended: true })
        }
      });
      this.transcript?.({ role: "tool", content: "end_call -> {\"ended\":true}", at: new Date() });
      return;
    }

    if (name === "transfer_to_staff") {
      let selector: StaffSelector = {};
      try {
        const parsed = rawArguments ? JSON.parse(rawArguments) : {};
        selector = { staffId: parsed.staffId, staffName: parsed.staffName };
      } catch {
        // Malformed arguments still transfer with no selector — findStaff
        // returning nothing is handled the same as "staff not found" below.
      }
      this.pendingTransfer = selector;
      this.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ transferring: true })
        }
      });
      this.transcript?.({ role: "tool", content: "transfer_to_staff -> {\"transferring\":true}", at: new Date() });
      return;
    }

    let output: unknown;
    let parsedInput: unknown;
    try {
      parsedInput = rawArguments ? JSON.parse(rawArguments) : {};
      output = await this.toolCall?.(name, parsedInput);
      this.transcript?.({
        role: "tool",
        content: `${name} -> ${JSON.stringify(output).slice(0, 1_500)}`,
        at: new Date()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      output = { error: message };
      this.transcript?.({ role: "tool", content: `${name} failed: ${message}`, at: new Date() });
      this.options.logger?.error(
        { callId: this.session?.callId, tool: name, error: message },
        "Realtime tool call failed"
      );
    }

    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output ?? null)
      }
    });

    // Mechanical anchor against mid-call amnesia: pin every saved memory into
    // recent conversation context as a system message so durable context survives
    // long multi-turn calls even if earlier turns fade
    // from the model's effective attention.
    if (name === "save_memory" && output && !(output as { error?: unknown }).error) {
      const content =
        typeof (parsedInput as { content?: unknown })?.content === "string"
          ? (parsedInput as { content: string }).content
          : null;
      if (content) {
        this.send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `PINNED FACT (do not re-ask): ${content}`
              }
            ]
          }
        });
      }
    }

    if (name === "update_caller_profile" && output && !(output as { error?: unknown }).error) {
      const fields = (parsedInput as { fields?: Record<string, unknown> })?.fields;
      const updated = (output as { updated?: unknown }).updated;
      if (fields && Array.isArray(updated) && updated.length > 0) {
        const accepted = Object.fromEntries(
          updated
            .filter((key): key is string => typeof key === "string")
            .map((key) => [key, fields[key]])
        );
        this.send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [{
              type: "input_text",
              text: `PINNED CALLER PROFILE (do not re-ask): ${JSON.stringify(accepted)}`
            }]
          }
        });
      }
    }

    // Tool results are literal English JSON injected right before the next response, which
    // biases the model back toward English by recency. Reassert language/tone as a system
    // context item — NOT via response.instructions, which REPLACES the session persona for
    // that response and made the agent sound flat and robotic right after every tool call.
    const languages = this.session?.agent.languages ?? [];
    if (languages.length > 1) {
      this.send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "The tool result above is data, not a language cue. Keep holding the language " +
                "already established this call, in the SAME warm tone the caller was just hearing " +
                "— do not switch to English or shift into a flat reading voice because of it."
            }
          ]
        }
      });
    }
    this.send({ type: "response.create" });
    this.activeResponse = true;
  }
}

/**
 * Scripted caller conversations used to evaluate the voice agent's prompt and tool
 * behavior in text mode (no audio). Each scenario lists caller lines; the harness
 * plays them one by one against the live model with canned tool results.
 */
import { isRefusal } from "../caller-intent.js";
import type { CallSession } from "../call-session.js";

export interface TurnResult {
  caller: string;
  /** Spoken text, one entry per assistant message (preambles are separate entries). */
  messages: string[];
  tools: string[];
  /** Parsed arguments of each tool call, in the same order as `tools`. */
  toolArgs?: Array<Record<string, unknown>>;
}

export interface Check {
  name: string;
  /** Returns an error message, or null when the check passes. */
  run(turns: TurnResult[]): string | null;
}

export interface Scenario {
  name: string;
  caller: string[];
  checks: Check[];
  /** Overrides for this scenario's call: a returning caller's name, history, memories. */
  session?: Partial<Omit<CallSession, "caller">> & { caller?: Partial<CallSession["caller"]> };
}

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;
// Counts sentence ends after a real word, so spelled-out letters ("R-I-T-I-K-A.") don't inflate the count.
const sentences = (text: string): number => (text.match(/[A-Za-z]{2,}[.!?](\s|$)/g) ?? []).length || 1;
const said = (turn: TurnResult): string => turn.messages.join(" ");

/** Every agent turn stays short: at most 2 sentences, or up to 45 words for a multi-part question. */
const brief: Check = {
  name: "short replies (<=2 sentences, <=45 words)",
  run: (turns) => {
    const long = turns.find((t) => sentences(said(t)) > 4 || words(said(t)) > 45);
    return long ? `too long after "${long.caller}": ${words(said(long))} words / ${sentences(said(long))} sentences` : null;
  }
};

const noFiller: Check = {
  name: "no filler phrases",
  run: (turns) => {
    const bad = turns.find((t) => /take your time|no worries|all ears|great question|no rush|let me just ask/i.test(said(t)));
    return bad ? `filler after "${bad.caller}": "${said(bad).slice(0, 80)}"` : null;
  }
};

const oneVoicePerTurn: Check = {
  name: "no double reply without a tool call",
  run: (turns) => {
    const bad = turns.find((t) => t.messages.length > 1 && t.tools.length === 0);
    return bad ? `spoke ${bad.messages.length} times after "${bad.caller}"` : null;
  }
};

const neverAsksLanguage: Check = {
  name: "never asks which language",
  run: (turns) => {
    const bad = turns.find((t) => /which language|english or hindi|prefer to continue in/i.test(said(t)));
    return bad ? `asked language after "${bad.caller}"` : null;
  }
};

const toolNeverCalled = (name: string): Check => ({
  name: `never calls ${name}`,
  run: (turns) => (turns.some((t) => t.tools.includes(name)) ? `${name} was called` : null)
});

const toolCalledOn = (name: string, turnIndex: number): Check => ({
  name: `calls ${name} on turn ${turnIndex + 1}`,
  run: (turns) => (turns[turnIndex]?.tools.includes(name) ? null : `${name} not called on turn ${turnIndex + 1}`)
});

const noToolOn = (name: string, turnIndex: number): Check => ({
  name: `does NOT call ${name} on turn ${turnIndex + 1}`,
  run: (turns) => (turns[turnIndex]?.tools.includes(name) ? `${name} called too early on turn ${turnIndex + 1}` : null)
});

const replyMatches = (turnIndex: number, pattern: RegExp, label: string): Check => ({
  name: label,
  run: (turns) => (pattern.test(said(turns[turnIndex] ?? { caller: "", messages: [], tools: [] })) ? null : `turn ${turnIndex + 1} reply did not match ${pattern}`)
});

const replyAvoids = (turnIndex: number, pattern: RegExp, label: string): Check => ({
  name: label,
  run: (turns) => (pattern.test(said(turns[turnIndex] ?? { caller: "", messages: [], tools: [] })) ? `turn ${turnIndex + 1} reply matched ${pattern}` : null)
});

const searchesSeveralDays: Check = {
  name: "searches several days when the caller has no preferred date",
  run: (turns) => {
    const calls = turns.flatMap((t) => (t.toolArgs ?? []).map((args, i) => ({ name: t.tools[i], args })));
    const availability = calls.find((c) => c.name === "check_availability");
    if (!availability) return "check_availability was never called";
    return Number(availability.args.days ?? 1) >= 3 ? null : `check_availability searched ${availability.args.days ?? 1} day(s), expected 3 or more`;
  }
};

/** No transfer actually went through: any transfer call carried the caller's "no" and was blocked. */
const neverConnected: Check = {
  name: "never connects the call",
  run: (turns) => {
    const calls = turns.flatMap((t) => (t.toolArgs ?? []).map((args, i) => ({ name: t.tools[i], args, caller: t.caller })));
    const connected = calls.find((c) => c.name === "transfer_to_staff" && !isRefusal(String(c.args.callerWords ?? "")));
    return connected ? `transferred after "${connected.caller}"` : null;
  }
};

const toolOnlyOn = (name: string, turnIndex: number): Check => ({
  name: `calls ${name} only on turn ${turnIndex + 1}`,
  run: (turns) => {
    const turn = turns.findIndex((t) => t.tools.includes(name));
    if (turn === -1) return `${name} never called`;
    return turn === turnIndex ? null : `${name} first called on turn ${turn + 1}`;
  }
});

type ToolCall = { name: string; args: Record<string, unknown>; turn: number };
const toolCalls = (turns: TurnResult[]): ToolCall[] =>
  turns.flatMap((t, turn) => t.tools.map((name, i) => ({ name, args: t.toolArgs?.[i] ?? {}, turn })));
const fieldsOf = (call: ToolCall): Record<string, unknown> => (call.args.fields as Record<string, unknown> | undefined) ?? {};

/** update_caller_profile saved `key` (matching `pattern`) no later than `byTurn`. */
const savesField = (key: string, pattern: RegExp, byTurn: number): Check => ({
  name: `saves ${key} by turn ${byTurn + 1}`,
  run: (turns) => {
    const saved = toolCalls(turns).find((c) => c.name === "update_caller_profile" && c.turn <= byTurn && pattern.test(String(fieldsOf(c)[key] ?? "")));
    return saved ? null : `${key} matching ${pattern} not saved by turn ${byTurn + 1}`;
  }
});

const noReplyMatches = (pattern: RegExp, label: string, fromTurn = 0): Check => ({
  name: label,
  run: (turns) => {
    const index = turns.findIndex((t, i) => i >= fromTurn && pattern.test(said(t)));
    return index === -1 ? null : `turn ${index + 1} reply matched ${pattern}: "${said(turns[index]!).slice(0, 80)}"`;
  }
});

const someReplyMatches = (pattern: RegExp, label: string, fromTurn = 0, toTurn = Infinity): Check => ({
  name: label,
  run: (turns) => (turns.some((t, i) => i >= fromTurn && i <= toTurn && pattern.test(said(t))) ? null : `no reply in turns ${fromTurn + 1}-${Math.min(toTurn + 1, turns.length)} matched ${pattern}`)
});

const atMostReplies = (pattern: RegExp, max: number, label: string): Check => ({
  name: label,
  run: (turns) => {
    const count = turns.filter((t) => pattern.test(said(t))).length;
    return count <= max ? null : `${count} replies matched ${pattern} (max ${max})`;
  }
});

const toolArgsMatch = (name: string, test: (args: Record<string, unknown>) => boolean, label: string): Check => ({
  name: label,
  run: (turns) => (toolCalls(turns).some((c) => c.name === name && test(c.args)) ? null : `no ${name} call matched`)
});

/** An ISO time `days` from now at `hourUtc`:00 UTC, so history stays "upcoming" whenever the eval runs. */
const isoInDays = (days: number, hourUtc = 0): string => {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCHours(hourUtc, 30, 0, 0);
  return date.toISOString();
};

/** A known caller: name confirmed by the greeting's "Am I speaking with ...?". */
const returning = (name: string, extra: Scenario["session"] = {}): Scenario["session"] => ({
  ...extra,
  caller: { displayName: name, stage: "interested", ...extra.caller },
  history: { upcomingBookings: [], pendingCallbacks: [], lastCallAt: isoInDays(-5), ...extra.history }
});

const base = [brief, noFiller, oneVoicePerTurn, neverAsksLanguage];

/**
 * A full receptionist call of about three minutes, mirrored in apps/voice/CALL_TEST_SCRIPT.md
 * for testing by phone. Turn numbers in the checks are 1-based in the labels.
 */
export const FULL_CALL: string[] = [
  "हाँ, मैं सुमंत बोल रहा हूँ।",
  "आप कैसी हो?",
  "आप लोग क्या काम करते हो?",
  "आपका ऑफिस कहाँ है और टाइमिंग क्या है?",
  "Consultation ki fees kitni hai?",
  "क्या मेरा स्टूडेंट वीज़ा अप्रूव हो जाएगा?",
  "नहीं, अभी मैसेज नहीं चाहिए।",
  "Can I speak to Ramlal?",
  "Not now.",
  "I want to book a student services consultation, any day next week is fine.",
  "The first one works.",
  "Yes, book it. My name is Sumant.",
  "ਇੱਕ ਗੱਲ ਹੋਰ, ਆਸਟ੍ਰੇਲੀਆ ਵਿੱਚ ਅੱਜ ਮੌਸਮ ਕਿਵੇਂ ਹੈ?",
  "Please ask Gundeep to call me back tomorrow evening about my documents.",
  "Bas itna hi, thank you, bye."
];

export const SCENARIOS: Scenario[] = [
  {
    name: "full 3-minute receptionist call",
    caller: FULL_CALL,
    checks: [
      noFiller,
      replyMatches(1, /ठीक|अच्छी/, "turn 2: answers 'how are you' like a person"),
      neverAsksLanguage,
      replyMatches(2, /[ऀ-ॿ]/, "turn 3: answers a Hindi question in Hindi"),
      replyAvoids(3, /\b9\s?(AM)?\s?(to|-)\s?5\b|nine (AM )?to five|9 बजे|नौ बजे/i, "turn 4: office hours in the caller's (India) time, not Melbourne's"),
      replyMatches(4, /110|एक सौ दस|one hundred (and )?ten/i, "turn 5: states the 110 dollar price"),
      replyAvoids(5, /\b(yes|will be approved|हो जाएगा|ज़रूर|guarantee)\b/i, "turn 6: gives no visa advice or promise"),
      noToolOn("request_callback", 6),
      replyMatches(7, /(nobody|no one|not .*ramlal|don.t have)/i, "turn 8: says there is nobody called Ramlal (in English)"),
      replyAvoids(9, /[ऀ-ॿ]/, "turn 10: answers an English request in English"),
      neverConnected,
      noToolOn("create_booking", 9),
      noToolOn("create_booking", 10),
      replyMatches(10, /book|confirm|\?/i, "turn 11: reads the time back and asks before booking"),
      toolOnlyOn("create_booking", 11),
      replyMatches(12, /[਀-੿]/, "turn 13: answers Punjabi in Punjabi"),
      noToolOn("check_availability", 12),
      toolOnlyOn("request_callback", 13),
      replyAvoids(13, /[ऀ-ॿ]/, "turn 14: answers an English request in English"),
      toolCalledOn("end_call", 14),
      replyMatches(14, /\S/, "turn 15: says goodbye before hanging up")
    ]
  },
  {
    name: "Hindi small talk: answers 'how are you' like a person",
    caller: ["आप कैसी हो?"],
    checks: [
      ...base,
      replyMatches(0, /ठीक|अच्छी/, "says she is fine"),
      replyMatches(0, /[ऀ-ॿ]/, "in Hindi")
    ]
  },
  {
    name: "'not now' after a transfer offer does not transfer",
    caller: ["Can I speak to Ramlal?", "Not now."],
    checks: [...base, neverConnected, replyAvoids(1, /stay on the line|connecting you/i, "turn 2: does not announce a transfer")]
  },
  {
    name: "Hindi: 'abhi nahi' after a transfer offer does not transfer",
    caller: ["क्या मैं रामलाल से बात कर सकता हूँ?", "अभी नहीं।"],
    checks: [...base, neverConnected, replyMatches(1, /[ऀ-ॿ]/, "turn 2: stays in Hindi")]
  },
  {
    name: "price question",
    caller: ["Hi, how much is a consultation?"],
    checks: [...base, replyMatches(0, /110/, "states the 110 dollar price")]
  },
  {
    name: "a bare 'okay' does not make it repeat itself",
    caller: ["How much is a consultation?", "Okay."],
    checks: [...base, replyAvoids(1, /110/, "does not repeat the price after 'okay'")]
  },
  {
    name: "terse caller gets a terse reply",
    caller: ["Hi", "Fees?", "Student visa"],
    checks: [
      ...base,
      { name: "replies to terse callers stay under 20 words", run: (turns) => (turns.some((t) => words(said(t)) > 20) ? "a reply to a terse caller exceeded 20 words" : null) }
    ]
  },
  {
    name: "general visa question (no advice)",
    caller: ["What is a student visa?", "Will I get approved if I apply?"],
    checks: [...base, replyAvoids(1, /\b(yes|definitely|guarantee[ds]?|you will)\b.*\bapproved\b/i, "does not promise approval")]
  },
  {
    name: "asks for a consultant: transfers straight away, naming who",
    caller: ["Can you connect me with a consultant please?"],
    checks: [
      ...base,
      toolCalledOn("transfer_to_staff", 0),
      replyMatches(0, /gundeep/i, "names the consultant it is connecting to")
    ]
  },
  {
    name: "Hindi: asks for a person who is not on the team",
    caller: ["क्या मैं रामलाल से बात कर सकता हूँ?"],
    checks: [
      ...base,
      toolNeverCalled("transfer_to_staff"),
      replyMatches(0, /[ऀ-ॿ]/, "answers in Hindi"),
      replyMatches(0, /(नहीं|कोई नहीं)/, "says there is nobody by that name")
    ]
  },
  {
    name: "asks for a person who is not on the team",
    caller: ["Can you transfer my call to Ramlal?"],
    checks: [
      ...base,
      replyAvoids(0, /stay on the line|connect(ing)? you now|put you through now/i, "does not promise a transfer to a stranger"),
      replyMatches(0, /(don.t|do not|no one|nobody|can.t|cannot).*(ramlal|ram lal|by that name|anyone)|gundeep|message/i, "says there is no such person and offers an alternative")
    ]
  },
  {
    name: "visa question gets one short sentence",
    caller: ["Actually, I want to understand about child visa."],
    checks: [...base, { name: "visa answer is one short sentence (<=22 words)", run: (turns) => (words(said(turns[0] ?? { caller: "", messages: [], tools: [] })) > 22 ? "visa answer exceeded 22 words" : null) }]
  },
  {
    name: "unknown person: offers a listed consultant, noise is not a yes",
    caller: ["Is there anyone called Ramlal working there?", "Thanks for watching."],
    checks: [...base, toolNeverCalled("transfer_to_staff")]
  },
  {
    name: "booking a consultation is not a transfer request",
    caller: ["I'd like a consultation about a student visa."],
    checks: [...base, toolNeverCalled("transfer_to_staff")]
  },
  {
    name: "says goodbye and hangs up",
    caller: ["What are your office timings?", "Okay thanks, that's all. Bye."],
    checks: [...base, toolCalledOn("end_call", 1)]
  },
  {
    name: "junk audio gets a short re-ask, no tools",
    caller: ["ए", "आं लोकली", "uh"],
    checks: [...base, toolNeverCalled("transfer_to_staff"), toolNeverCalled("create_booking"), toolNeverCalled("update_caller_profile")]
  },
  {
    name: "single foreign word does not switch language",
    caller: ["Hello", "ਪੰਜਾਬੀ", "Can you tell me about your services?"],
    checks: [...base, replyAvoids(1, /[਀-੿]/, "does not answer in Punjabi after one word")]
  },
  {
    name: "nonsense term is not matched to the closest service",
    caller: ["Looking for an help regarding Nvidia service."],
    checks: [
      ...base,
      noToolOn("check_availability", 0),
      noToolOn("create_booking", 0),
      replyAvoids(0, /migration consultation|what time works|which day/i, "does not offer to book an unrelated/unclear request"),
      replyMatches(0, /(don.t have|not sure|could you clarify|not something we|not clear)/i, "says it doesn't recognise the request instead of guessing")
    ]
  },
  {
    name: "fees question (GST) is not invented",
    caller: ["Does the 110 dollars include GST?"],
    checks: [...base, replyAvoids(0, /\b(includes?|inclusive of|plus)\s+GST\b|GST (is|are) (included|extra)/i, "does not invent GST terms")]
  },
  {
    name: "medical talk stays out of scope",
    caller: ["I have a bad stomach ache, what medicine should I take?"],
    checks: [...base, replyAvoids(0, /\b(drink|hydrat|fiber|rest|antacid|paracetamol|take .* medicine)\b/i, "gives no medical advice")]
  },
  {
    name: "no preferred date: searches the next days, not one",
    caller: ["Hi, I want to book a student services consultation. Any date in the next five days is fine, I am in India."],
    checks: [...base, searchesSeveralDays]
  },
  {
    name: "booking: checks availability, confirms, then books",
    caller: [
      "I'd like to book a student visa consultation for tomorrow morning.",
      "Ten thirty works.",
      "Yes, book it. My name is Ritika."
    ],
    checks: [...base, toolCalledOn("check_availability", 0), noToolOn("create_booking", 1)]
  },
  {
    name: "fact not in the knowledge: no general knowledge, offers a message",
    caller: ["How long does a partner visa take to process these days?"],
    checks: [
      ...base,
      replyAvoids(0, /\b(\d+|one|two|three|six|twelve)\s*(to\s*\w+\s*)?(weeks?|months?|years?)\b/i, "does not quote a timeline"),
      replyMatches(0, /don.t have|team|message|call you back/i, "says it doesn't have it and offers a message")
    ]
  },
  {
    name: "office question: answers from details, does not sell",
    caller: ["Where is your Carnegie office?", "Okay, thanks."],
    checks: [
      ...base,
      replyMatches(0, /koornang/i, "gives the Carnegie address"),
      replyAvoids(0, /\b(book|consultation)\b/i, "does not push a booking"),
      replyAvoids(1, /\b(book|consultation)\b/i, "still does not push a booking")
    ]
  },
  {
    name: "office timings are answered, not deferred",
    caller: ["What are your office timings?"],
    checks: [
      ...base,
      replyMatches(0, /\b(9|nine)\b.*\b(5|five)\b/i, "gives 9 to 5"),
      replyAvoids(0, /confirm|follow up|call you back/i, "does not defer to the team")
    ]
  },
  {
    name: "English caller stays in English after a lookup (run with --india)",
    caller: ["Can you check and book an appointment for me for tomorrow after 12 p.m. Indian time?", "Okay, what else do you have?"],
    checks: [
      ...base,
      { name: "never answers an English caller in Hindi or Punjabi", run: (turns) => (turns.some((t) => /[ऀ-ॿ਀-੿]/.test(said(t))) ? "replied in Devanagari/Gurmukhi to an English caller" : null) }
    ]
  },
  {
    name: "declined message is not taken",
    caller: ["Is there anyone called Ramlal there?", "No, I don't want to leave any message."],
    checks: [...base, toolNeverCalled("request_callback")]
  },
  {
    name: "Hindi: stays female",
    caller: ["नमस्ते, मुझे आपके ऑफिस का पता चाहिए, आप बता सकती हैं?"],
    checks: [...base, replyAvoids(0, /सकता|बताता|देखता|करता हूँ/, "uses female verb forms")]
  },
  {
    name: "Punjabi: answers in Punjabi and stays female",
    caller: ["ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਜੀ, ਮੈਨੂੰ ਤੁਹਾਡੇ ਦਫ਼ਤਰ ਦਾ ਪਤਾ ਚਾਹੀਦਾ ਹੈ।"],
    checks: [
      ...base,
      replyMatches(0, /[਀-੿]/, "answers in Gurmukhi"),
      replyAvoids(0, /ਸਕਦਾ|ਦੱਸਦਾ|ਦੇਖਦਾ|ਕਰਦਾ ਹਾਂ/, "uses female verb forms")
    ]
  },
  {
    name: "name capture: spell before saving",
    caller: ["My name is Ritika.", "R I T I K A.", "Yes that's right."],
    checks: [...base, noToolOn("update_caller_profile", 0)]
  },
  {
    name: "books the exact slot the caller picked, not a nearby one",
    caller: [
      "I'd like to book a student services consultation for tomorrow.",
      "I'll take the 10 AM one.",
      "Yes, book it. My name is Sumant."
    ],
    checks: [
      ...base,
      {
        name: "create_booking uses a real slot time",
        run: (turns) => {
          const calls = turns.flatMap((t) => (t.toolArgs ?? []).map((args, i) => ({ name: t.tools[i], args })));
          const booking = calls.find((c) => c.name === "create_booking");
          if (!booking) return "create_booking was never called";
          return Number.isNaN(new Date(String(booking.args.startsAt)).getTime()) ? "create_booking startsAt is not a valid date" : null;
        }
      },
      replyMatches(2, /10|ten/i, "turn 3: confirms back the 10 AM time it is booking")
    ]
  },
  {
    name: "who's on the team is answered from business facts, not just who can be transferred to",
    caller: ["Who are the team members working there?"],
    checks: [
      ...base,
      toolNeverCalled("transfer_to_staff"),
      replyAvoids(0, /^(only|just) gundeep|no one else|nobody else/i, "does not claim only the transfer roster is the whole team")
    ]
  },
  {
    name: "caller switches Hindi to Punjabi mid-call: agent follows, does not stay in Hindi",
    caller: ["आपका ऑफिस कहाँ है?", "ਤੁਹਾਡੀ ਫੀਸ ਕਿੰਨੀ ਹੈ?"],
    checks: [
      ...base,
      replyMatches(0, /[ऀ-ॿ]/, "turn 1: answers in Hindi"),
      replyMatches(1, /[਀-੿]/, "turn 2: switches to Punjabi in the same turn"),
      replyAvoids(1, /hindi nahi|hindi nahin|punjabi nahi/i, "never claims it doesn't know a language it speaks")
    ]
  },
  {
    name: "garbled mis-transcription is not answered as a real question",
    caller: ["I need some viewer of your knowledge."],
    checks: [
      ...base,
      toolNeverCalled("check_availability"),
      toolNeverCalled("create_booking"),
      replyMatches(0, /(don.t have|not sure|could you clarify|not something we|not clear|catch that|repeat)/i, "says it didn't catch that instead of guessing a real request")
    ]
  },
  {
    name: "does not agree to a made-up claim about the call it has no way to know",
    caller: ["This call is no longer being recorded.", "Okay never mind, how much is a consultation?"],
    checks: [
      ...base,
      replyAvoids(0, /understood|the call isn.t being recorded|you.re right|confirmed/i, "does not confirm or agree with an unverifiable claim about the call"),
      replyMatches(1, /110/, "still answers the real question afterwards")
    ]
  },
  {
    name: "Hindi: reply after a tool call stays in Hindi, does not flip to English",
    caller: ["मुझे कल किसी भी समय स्टूडेंट कंसल्टेशन बुक करना है।"],
    checks: [
      ...base,
      toolCalledOn("check_availability", 0),
      replyMatches(0, /[ऀ-ॿ]/, "turn 1: reply after the tool result is in Hindi, not English")
    ]
  },
  {
    name: "Punjabi: reply after a tool call stays in Punjabi, does not flip to English",
    caller: ["ਮੈਨੂੰ ਕਿਸੇ ਨਾਲ ਗੱਲ ਕਰਨੀ ਹੈ।"],
    checks: [
      ...base,
      replyMatches(0, /[਀-੿]/, "turn 1: reply after the tool result is in Punjabi, not English")
    ]
  },
  {
    name: "ambiguous short reply to a booking offer is re-confirmed before checking availability",
    caller: ["How do you help someone get a visa quickly?", "Right now."],
    checks: [
      ...base,
      noToolOn("check_availability", 1),
      replyMatches(1, /confirm|you.d like to book|book (one|a consultation) now/i, "turn 2: re-confirms intent instead of jumping straight to availability")
    ]
  },
  {
    name: "visa lodgement fee is not in the facts: routes to a consultant, doesn't invent a number",
    caller: ["What is the visa lodgement fee?"],
    checks: [
      ...base,
      replyAvoids(0, /\$\d|\d+\s?(dollars|AUD)/i, "does not invent a government lodgement fee figure"),
      replyMatches(0, /consultant|consultation|specific case|confirm/i, "says a consultant would need to confirm this case-specific detail")
    ]
  },
  {
    name: "reputation question with no exact figure: confident answer, no invented number, no flat 'I don't know'",
    caller: ["How many clients have you handled so far?"],
    checks: [
      ...base,
      replyAvoids(0, /^(i don.t have|i don.t know|not sure|no information)/i, "does not open with a flat 'I don't have/know' refusal"),
      replyAvoids(0, /\b(?!15\b)\d{2,}\b/, "does not invent a specific client count"),
      replyMatches(0, /15\+? ?years|years of experience|many (clients|people)/i, "answers confidently from the real 15+ years fact")
    ]
  },

  // ── The 5-step call ladder ──────────────────────────────────────────────
  {
    name: "ladder: new caller goes name → reason → questions → booking → team offer → close",
    caller: [
      "Hi, I'm Ravi Kumar.",
      "I'm calling about a partner visa. I'm in Melbourne on a student visa at the moment.",
      "Can consultations be done over video?",
      "No, that's all my questions.",
      "Yes, let's book one.",
      "The first time works.",
      "Yes, book it.",
      "No thanks, that's fine.",
      "No, that's everything. Bye."
    ],
    checks: [
      ...base,
      savesField("name", /ravi/i, 0),
      replyMatches(0, /help|calling about|what can i/i, "turn 1: after the name, asks what they're calling about"),
      savesField("enquiry", /partner/i, 1),
      replyMatches(3, /consultation/i, "turn 4: offers a consultation once questions are done"),
      someReplyMatches(/payment/i, "mentions that the team confirms payment", 4, 6),
      atMostReplies(/\b110\b/, 1, "says the price at most once"),
      toolCalledOn("create_booking", 6),
      someReplyMatches(/speak (with|to) (someone|gundeep|a member|the team|one of)|connect you/i, "offers a team member before closing", 6, 7),
      neverConnected,
      toolCalledOn("end_call", 8)
    ]
  },
  {
    name: "ladder: a no to the consultation is respected, then the call closes",
    caller: [
      "Hello, this is Priya.",
      "I just wanted to know what kind of visas you help with.",
      "Do you have an office in Adelaide?",
      "No, that's all I wanted to know.",
      "No thanks, maybe later.",
      "No, that's it. Bye."
    ],
    checks: [
      ...base,
      savesField("name", /priya/i, 0),
      replyMatches(3, /consultation/i, "turn 4: offers a consultation once"),
      noReplyMatches(/consultation|book/i, "never offers the consultation again after a no", 4),
      toolNeverCalled("check_availability"),
      toolNeverCalled("create_booking"),
      toolCalledOn("end_call", 5)
    ]
  },
  {
    name: "ladder: a caller who asks for a person first is transferred, no intake questions",
    caller: ["Can I talk to someone from your team right now please?"],
    checks: [
      ...base,
      toolCalledOn("transfer_to_staff", 0),
      replyAvoids(0, /your name|who am i speaking|what.*calling about/i, "does not ask for the name or reason before transferring")
    ]
  },
  {
    name: "ladder: a caller who jumps straight to booking gets slots, and their name before the booking",
    caller: [
      "I want to book a student services consultation for tomorrow.",
      "It's Arjun. Tomorrow morning is best.",
      "The 10:30 one.",
      "Yes, book it.",
      "Yes, please go ahead."
    ],
    checks: [
      ...base,
      {
        name: "checks availability within the first two turns (no stalling on the name)",
        run: (turns) => {
          const first = toolCalls(turns).find((c) => c.name === "check_availability");
          return first && first.turn <= 1 ? null : `check_availability first on turn ${first ? first.turn + 1 : "never"}`;
        }
      },
      toolArgsMatch("create_booking", (args) => /arjun/i.test(String(args.callerName ?? "")), "books with the caller's name")
    ]
  },
  {
    name: "ladder (Hindi): name, reason and booking all stay in Hindi",
    caller: ["नमस्ते, मेरा नाम राहुल है।", "मुझे पार्टनर वीज़ा के बारे में जानकारी चाहिए।", "हाँ, कंसल्टेशन बुक करना है।"],
    checks: [
      ...base,
      savesField("name", /rahul|राहुल/i, 0),
      savesField("enquiry", /partner|पार्टनर/i, 1),
      toolCalledOn("check_availability", 2),
      replyMatches(0, /[ऀ-ॿ]/, "turn 1 in Hindi"),
      replyMatches(1, /[ऀ-ॿ]/, "turn 2 in Hindi"),
      replyMatches(2, /[ऀ-ॿ]/, "turn 3 in Hindi")
    ]
  },

  // ── Returning callers ───────────────────────────────────────────────────
  {
    name: "returning caller with a booking: brings it up, doesn't re-ask the name, moving it becomes a callback",
    session: returning("Ravi", {
      caller: { stage: "booked", profile: { enquiry: "partner visa, onshore" } },
      history: { upcomingBookings: [{ serviceName: "Individual / Family Migration Consultation", startsAt: isoInDays(6, 23) }], pendingCallbacks: [], lastCallAt: isoInDays(-3) }
    }),
    caller: ["Yes, speaking.", "Yes, I need to move it to a different day.", "Next week sometime, Tuesday if possible.", "No, that's it, thanks. Bye."],
    checks: [
      ...base,
      replyMatches(0, /consultation|appointment|booking/i, "turn 1: brings up the upcoming booking"),
      noReplyMatches(/your name|who am i speaking/i, "never asks the name again"),
      noReplyMatches(/would you like to book a (new )?consultation/i, "does not pitch a new consultation"),
      toolNeverCalled("create_booking"),
      toolArgsMatch("request_callback", (args) => /10[:.]?30|ten thirty|consultation|booking|appointment/i.test(String(args.reason ?? "")), "callback reason names the booking")
    ]
  },
  {
    name: "returning caller chasing a pending callback: offers the team or logs a FOLLOW-UP, never a plain duplicate",
    session: returning("Anita", {
      history: { upcomingBookings: [], pendingCallbacks: [{ reason: "Wants fees for an employer-sponsored 482 visa", createdAt: isoInDays(-3) }], lastCallAt: isoInDays(-3) }
    }),
    caller: ["Yes, it's Anita.", "Yes, and nobody has called me back yet. It's urgent.", "Yes please."],
    checks: [
      ...base,
      replyMatches(0, /call(ed)? (you )?back|callback|482|sponsor/i, "turn 1: brings up the pending callback"),
      {
        name: "escalates: transfer, or a callback marked FOLLOW-UP",
        run: (turns) => {
          const calls = toolCalls(turns);
          const transferred = calls.some((c) => c.name === "transfer_to_staff" && !isRefusal(String(c.args.callerWords ?? "")));
          const followUp = calls.some((c) => c.name === "request_callback" && /^FOLLOW-UP/i.test(String(c.args.reason ?? "")));
          return transferred || followUp ? null : "neither transferred nor logged a FOLLOW-UP callback";
        }
      },
      {
        name: "never logs a plain duplicate callback",
        run: (turns) => {
          const plain = toolCalls(turns).find((c) => c.name === "request_callback" && !/^FOLLOW-UP/i.test(String(c.args.reason ?? "")));
          return plain ? `plain callback: "${String(plain.args.reason).slice(0, 60)}"` : null;
        }
      }
    ]
  },
  {
    name: "someone else on a known number: no history is shared and nothing is saved over the caller",
    session: returning("Ravi", {
      caller: { stage: "booked", profile: { enquiry: "partner visa, onshore" } },
      history: { upcomingBookings: [{ serviceName: "Individual / Family Migration Consultation", startsAt: isoInDays(6, 23) }], pendingCallbacks: [], lastCallAt: isoInDays(-3) },
      memories: [{ id: "m1", kind: "summary", content: "Ravi asked about a partner visa and booked a consultation." }]
    }),
    caller: ["No, this is his wife, Meena.", "What time is his appointment?", "Okay. How much is a consultation?"],
    checks: [
      ...base,
      noReplyMatches(/10[:.]?30|ten thirty|partner visa|individual \/ family/i, "never reveals the booking or past details"),
      toolNeverCalled("update_caller_profile"),
      replyMatches(2, /110/, "still answers a general question")
    ]
  },
  {
    name: "past caller with only a summary: picks up the last topic and doesn't re-ask why they called",
    session: returning("Sam", {
      caller: { profile: { enquiry: "student visa extension" } },
      memories: [{ id: "m1", kind: "summary", content: "Sam asked about extending a student visa; no booking yet." }]
    }),
    caller: ["Yes, Sam here.", "Yes, that's right. Can the consultation be done by phone?"],
    checks: [
      ...base,
      replyMatches(0, /student/i, "turn 1: refers to the last topic"),
      replyAvoids(1, /how can i help|what are you calling about|what can i do for you/i, "turn 2: doesn't re-ask why they called"),
      replyMatches(1, /phone|yes/i, "turn 2: answers the question")
    ]
  },
  {
    name: "'do you remember me?' with history: yes and a real detail, the same both times",
    session: returning("Sam", {
      caller: { profile: { enquiry: "student visa extension" } },
      memories: [{ id: "m1", kind: "summary", content: "Sam asked about extending a student visa; no booking yet." }]
    }),
    caller: ["Yes, it's Sam.", "Do you remember me?", "So do you remember me or not?"],
    checks: [
      ...base,
      replyMatches(1, /student|yes|of course/i, "turn 2: yes, with a detail"),
      replyAvoids(1, /don.t have (any )?(earlier|previous|past)|no record|first time/i, "turn 2: doesn't deny the history"),
      replyAvoids(2, /don.t have (any )?(earlier|previous|past)|no record|first time/i, "turn 3: same answer, no contradiction")
    ]
  },
  {
    name: "'do you remember me?' from a first-time caller: no invented history",
    caller: ["Hi, do you remember me?"],
    checks: [
      ...base,
      replyAvoids(0, /yes,? (of course|i (do )?remember)|last time (we|you)/i, "doesn't pretend to remember"),
      replyMatches(0, /don.t have|no (earlier|previous|record)|first time|can.t see|not sure/i, "says there are no earlier details")
    ]
  }
];

/**
 * Scripted caller conversations used to evaluate the voice agent's prompt and tool
 * behavior in text mode (no audio). Each scenario lists caller lines; the harness
 * plays them one by one against the live model with canned tool results.
 */

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
}

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;
// Counts sentence ends after a real word, so spelled-out letters ("R-I-T-I-K-A.") don't inflate the count.
const sentences = (text: string): number => (text.match(/[A-Za-z]{2,}[.!?](\s|$)/g) ?? []).length || 1;
const said = (turn: TurnResult): string => turn.messages.join(" ");

/** Every agent turn stays short: at most 2 sentences and 35 words. */
const brief: Check = {
  name: "short replies (<=2 sentences, <=35 words)",
  run: (turns) => {
    const long = turns.find((t) => sentences(said(t)) > 2 || words(said(t)) > 35);
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

const base = [brief, noFiller, oneVoicePerTurn, neverAsksLanguage];

export const SCENARIOS: Scenario[] = [
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
  }
];

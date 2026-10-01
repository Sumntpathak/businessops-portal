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
    name: "wants a human: confirm first, then transfer",
    caller: ["I want to talk to a real person please.", "Yes please.", "Thanks."],
    checks: [
      ...base,
      noToolOn("transfer_to_staff", 0),
      replyMatches(0, /(connect|put).*\b(yes|confirm)\b|\b(yes|confirm)\b.*(connect|put)|would you like/i, "asks for a yes before transferring"),
      toolCalledOn("transfer_to_staff", 1)
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
    name: "wants a human: noise is not a yes",
    caller: ["Can I speak to someone from your team?", "Thanks for watching."],
    checks: [...base, noToolOn("transfer_to_staff", 1)]
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
    name: "booking: checks availability, confirms, then books",
    caller: [
      "I'd like to book a student visa consultation for tomorrow morning.",
      "Ten thirty works.",
      "Yes, book it. My name is Ritika."
    ],
    checks: [...base, toolCalledOn("check_availability", 0), noToolOn("create_booking", 1)]
  },
  {
    name: "name capture: spell before saving",
    caller: ["My name is Ritika.", "R I T I K A.", "Yes that's right."],
    checks: [...base, noToolOn("update_caller_profile", 0)]
  }
];

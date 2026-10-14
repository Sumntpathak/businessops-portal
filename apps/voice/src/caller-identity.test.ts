import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identityAnswer } from "./caller-identity.js";

const check = (expected: string, phrases: string[]) => {
  for (const phrase of phrases) assert.equal(identityAnswer(phrase, "Raj Kumar"), expected, phrase);
};

describe("identityAnswer: who is on the line when we asked 'Am I speaking with Raj?'", () => {
  it("confirms the owner on a plain yes, in any of the call's languages", () => {
    check("confirmed", [
      "Yes",
      "Yes, speaking.",
      "Yeah, that's me",
      "Speaking",
      "It's me",
      "yes speaking, calling about my partner visa",
      "Yes it's me, calling about my visa",
      "Yes, my wife booked it",
      "हाँ",
      "हाँ जी, बोल रहा हूँ",
      "जी",
      "ਹਾਂ ਜੀ",
      "haan ji",
      "Okay",
      "Hello, yes, I wanted to ask about fees",
      "Hi, it's me",
      "Haan ji bolo",
      "Tell me",
      "Namaste ji"
    ]);
  });

  it("confirms the owner when they give their own name", () => {
    check("confirmed", ["I'm Raj", "Yes, this is Raj", "My name is Raj", "Raj speaking", "Raj here"]);
  });

  it("recognises someone else: a different name, a relation, or the owner being away", () => {
    check("someone-else", [
      "No, this is his wife, Meena.",
      "This is his wife, Meena.",
      "this is Meena, Raj's wife",
      "I'm Raj's mate",
      "I'm his assistant",
      "I'm calling on behalf of Raj",
      "Raj isn't here, who's this?",
      "He's not available, can I take a message",
      "main unki wife bol rahi hoon",
      "नहीं, मैं उनकी पत्नी हूँ",
      "This is Meena",
      "No",
      "Nope, wrong number"
    ]);
  });

  it("stays unclear, without locking anyone out, when there is no evidence either way", () => {
    check("unclear", [
      "",
      "Hello?",
      "Hi, it's Meena",
      "I'm calling about a visa",
      "I'm fine, thanks",
      "No problem, I wanted to ask about fees"
    ]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRefusal } from "./caller-intent.js";

describe("isRefusal", () => {
  it("catches no in English, Hindi and Punjabi", () => {
    for (const text of ["No.", "Nope", "No, Gundeep.", "नो गंदगी", "नहीं नहीं", "नहीं चाहिए", "ਨਹੀਂ ਜੀ", "nahi", "I don't want that", "I said no"]) {
      assert.equal(isRefusal(text), true, text);
    }
  });

  it("catches 'not now' and putting it off", () => {
    for (const text of ["Not now", "not now, thanks", "Maybe later", "abhi nahi", "baad mein karta hu", "अभी नहीं", "बाद में बात करूँगा", "रहने दो", "Later"]) {
      assert.equal(isRefusal(text), true, text);
    }
  });

  it("does not block real requests", () => {
    for (const text of ["Yes please", "Yes, connect me with Gundeep", "हाँ जी", "हाँ, जोड़ दो", "Can you connect me with a consultant?", "I want to talk to a person, not a bot please", "Gundeep Malhotra please", "Connect me now"]) {
      assert.equal(isRefusal(text), false, text);
    }
  });
});

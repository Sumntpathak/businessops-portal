import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRefusal } from "./caller-intent.js";

describe("isRefusal", () => {
  it("catches the misheard call: 'No, Gundeep' transcribed as 'नो गंदगी'", () => {
    assert.equal(isRefusal("नो गंदगी"), true);
    assert.equal(isRefusal("No, Gundeep."), true);
  });

  it("catches no in English, Hindi and Punjabi", () => {
    for (const text of ["No.", "Nope", "नहीं नहीं", "नहीं चाहिए", "ਨਹੀਂ ਜੀ", "nahi", "I don't want that", "I said no"]) {
      assert.equal(isRefusal(text), true, text);
    }
  });

  it("does not block real requests", () => {
    for (const text of ["Yes please", "Yes, connect me with Gundeep", "हाँ जी", "Can you connect me with a consultant?", "I want to talk to a person, not a bot please", "Gundeep Malhotra please"]) {
      assert.equal(isRefusal(text), false, text);
    }
  });
});

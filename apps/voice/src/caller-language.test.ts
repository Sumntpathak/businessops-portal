import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CallerLanguage, detectLanguage } from "./caller-language.js";

const all = ["English", "Hindi", "Punjabi"];

describe("detectLanguage", () => {
  it("reads the language from the transcript's script", () => {
    assert.equal(detectLanguage("Can you check and book an appointment for me?", all), "English");
    assert.equal(detectLanguage("नहीं नहीं नहीं चाहिए।", all), "Hindi");
    assert.equal(detectLanguage("ਮੈਨੂੰ ਦਫ਼ਤਰ ਦਾ ਪਤਾ ਚਾਹੀਦਾ ਹੈ", all), "Punjabi");
  });

  it("does not decide from one word or a language that is not configured", () => {
    assert.equal(detectLanguage("हाँ", all), undefined);
    assert.equal(detectLanguage("Hello.", all), undefined);
    assert.equal(detectLanguage("ਮੈਨੂੰ ਦਫ਼ਤਰ ਦਾ ਪਤਾ", ["English", "Hindi"]), undefined);
  });
});

describe("CallerLanguage", () => {
  it("starts in the first language, follows full sentences and ignores one-word turns", () => {
    const tracker = new CallerLanguage(all);
    assert.equal(tracker.language, "English");
    tracker.observe("हाँ");
    assert.equal(tracker.language, "English", "one Hindi word does not switch");
    tracker.observe("मुझे कल का अपॉइंटमेंट चाहिए");
    assert.equal(tracker.language, "Hindi");
    tracker.observe("Okay.");
    assert.equal(tracker.language, "Hindi", "a one-word English reply does not switch back");
  });

  it("names the language after a tool result instead of saying 'do not switch to English'", () => {
    const tracker = new CallerLanguage(all);
    tracker.observe("Can you check and book an appointment for me for tomorrow after 12 p.m. Indian time?");
    assert.match(tracker.replyNote(), /The caller is speaking English: reply in English only/);
    assert.doesNotMatch(tracker.replyNote(), /do not switch to English/);
  });
});

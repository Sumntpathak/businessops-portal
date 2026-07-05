import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPublicUrl,
  rankCrawlUrls,
  stubDistill
} from "./crawler.js";

describe("onboarding crawler safety", () => {
  it("rejects localhost and private IP targets", async () => {
    await assert.rejects(() => assertPublicUrl("http://localhost/admin"));
    await assert.rejects(() => assertPublicUrl("http://127.0.0.1/admin"));
    await assert.rejects(() => assertPublicUrl("http://10.10.0.2/internal"));
  });

  it("keeps only same-domain pages, prioritizes useful paths, and caps at ten", () => {
    const urls = rankCrawlUrls("https://example.com", [
      "https://evil.example.net/services",
      "https://example.com/blog/post-1",
      "https://www.example.com/contact",
      "https://example.com/pricing",
      "https://example.com/about",
      ...Array.from({ length: 20 }, (_, index) => `https://example.com/page-${index}`)
    ]);

    assert.equal(urls.length, 10);
    assert.ok(urls.every((url) => new URL(url).hostname.replace(/^www\./, "") === "example.com"));
    assert.deepEqual(urls.slice(0, 4), [
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/pricing",
      "https://www.example.com/contact"
    ]);
  });

  it("returns a visibly incomplete non-AI draft", () => {
    const draft = stubDistill("BrightSmile Dental");

    assert.match(draft.agentMd, /BrightSmile Dental/);
    assert.match(draft.agentMd, /\[REVIEW: fill from crawl\]/);
    assert.equal(draft.services.length, 2);
  });
});

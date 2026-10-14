import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRealtimeConfig } from "./realtime-config.js";

const defaults = { AZURE_REALTIME_MODEL: "gpt-realtime-mini", AZURE_REALTIME_VOICE: "shimmer", AZURE_TRANSCRIBE_MODEL: "whisper-1" };

describe("realtime provider config", () => {
  it("keeps today's Azure settings working unchanged", () => {
    const config = resolveRealtimeConfig({
      ...defaults,
      AZURE_REALTIME_URL: "https://recepto.openai.azure.com",
      AZURE_REALTIME_KEY: "azure-key",
      AZURE_REALTIME_MODEL: "gpt-realtime-2.1-mini",
      AZURE_REALTIME_REASONING_EFFORT: "low"
    });
    assert.deepEqual(config, {
      url: "https://recepto.openai.azure.com",
      apiKey: "azure-key",
      model: "gpt-realtime-2.1-mini",
      voice: "shimmer",
      tuning: { reasoningEffort: "low", transcribeModel: "whisper-1" }
    });
  });

  it("switches to OpenAI with the REALTIME_* names, which win over the Azure ones", () => {
    const config = resolveRealtimeConfig({
      ...defaults,
      AZURE_REALTIME_URL: "https://recepto.openai.azure.com",
      AZURE_REALTIME_KEY: "azure-key",
      REALTIME_URL: "https://api.openai.com/v1/realtime",
      REALTIME_API_KEY: "sk-test",
      REALTIME_MODEL: "gpt-realtime-2.1-mini",
      REALTIME_TRANSCRIBE_MODEL: "gpt-4o-mini-transcribe"
    });
    assert.equal(config.url, "https://api.openai.com/v1/realtime");
    assert.equal(config.apiKey, "sk-test");
    assert.equal(config.model, "gpt-realtime-2.1-mini");
    assert.equal(config.tuning.transcribeModel, "gpt-4o-mini-transcribe");
  });

  it("refuses to start without a URL and key", () => {
    assert.throws(() => resolveRealtimeConfig(defaults), /REALTIME_URL and REALTIME_API_KEY/);
  });
});

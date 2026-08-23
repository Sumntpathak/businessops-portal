import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLOSING_QUESTION_PATTERN, REALTIME_TOOLS } from "./gemini-live-bridge.js";

const AZURE_TOOL_NAMES = [
  "check_availability",
  "create_booking",
  "cancel_booking",
  "save_memory",
  "update_caller_profile",
  "get_caller_context",
  "list_staff",
  "transfer_to_staff",
  "end_call"
];

describe("Gemini Live tool declarations", () => {
  it("declares the same tool set the Azure realtime bridge exposes", () => {
    const names = REALTIME_TOOLS.map((tool) => tool.name);
    assert.deepEqual(names, AZURE_TOOL_NAMES);
  });

  it("gives every tool a name, description, and JSON-schema parameters block", () => {
    for (const tool of REALTIME_TOOLS) {
      assert.ok(tool.name && tool.name.length > 0, "tool missing a name");
      assert.ok(tool.description && tool.description.length > 0, `${tool.name} missing a description`);
      assert.ok(tool.parametersJsonSchema, `${tool.name} missing parametersJsonSchema`);
    }
  });

  it("requires the fields object on update_caller_profile", () => {
    const tool = REALTIME_TOOLS.find((entry) => entry.name === "update_caller_profile");
    const schema = tool?.parametersJsonSchema as { required?: string[] } | undefined;
    assert.deepEqual(schema?.required, ["fields"]);
  });

  it("takes no parameters for end_call, get_caller_context, and list_staff", () => {
    for (const name of ["end_call", "get_caller_context", "list_staff"]) {
      const tool = REALTIME_TOOLS.find((entry) => entry.name === name);
      const schema = tool?.parametersJsonSchema as { properties?: Record<string, unknown> } | undefined;
      assert.deepEqual(schema?.properties, {});
    }
  });

  it("never exposes a staff phone number as a transfer_to_staff parameter", () => {
    const tool = REALTIME_TOOLS.find((entry) => entry.name === "transfer_to_staff");
    const schema = tool?.parametersJsonSchema as { properties?: Record<string, unknown> } | undefined;
    assert.deepEqual(Object.keys(schema?.properties ?? {}).sort(), ["staffId", "staffName"]);
  });
});

describe("closing-question detection for the silence timer", () => {
  it("matches the agent's English closing question", () => {
    assert.ok(CLOSING_QUESTION_PATTERN.test("Is there anything else I can help you with today?"));
    assert.ok(CLOSING_QUESTION_PATTERN.test("Is there anything else?"));
    assert.ok(CLOSING_QUESTION_PATTERN.test("Anything else I can help with?"));
  });

  it("matches Hinglish/Hindi closing phrasing", () => {
    assert.ok(CLOSING_QUESTION_PATTERN.test("Aur kuch aur chahiye aapko?"));
    assert.ok(CLOSING_QUESTION_PATTERN.test("क्या आपको कुछ और चाहिए?"));
    assert.ok(CLOSING_QUESTION_PATTERN.test("kuch and chahiye aapko?"));
  });

  it("does not match opening greetings", () => {
    assert.ok(!CLOSING_QUESTION_PATTERN.test("Hello! Thank you for calling. How can I help you today?"));
    assert.ok(!CLOSING_QUESTION_PATTERN.test("Hello! Thank you for calling BrightSmile Dental. How can I help you today?"));
    assert.ok(!CLOSING_QUESTION_PATTERN.test("Hi there, how may I assist you today?"));
    assert.ok(!CLOSING_QUESTION_PATTERN.test("Good morning, how can I help?"));
  });

  it("does not match an ordinary mid-conversation turn", () => {
    assert.ok(!CLOSING_QUESTION_PATTERN.test("Sure, we offer student and graduate visa consultations."));
    assert.ok(!CLOSING_QUESTION_PATTERN.test("One moment, let me check availability for you."));
  });
});

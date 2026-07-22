import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REALTIME_TOOLS } from "./gemini-live-bridge.js";

const AZURE_TOOL_NAMES = [
  "check_availability",
  "create_booking",
  "cancel_booking",
  "save_memory",
  "update_caller_profile",
  "get_caller_context",
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

  it("takes no parameters for end_call and get_caller_context", () => {
    for (const name of ["end_call", "get_caller_context"]) {
      const tool = REALTIME_TOOLS.find((entry) => entry.name === name);
      const schema = tool?.parametersJsonSchema as { properties?: Record<string, unknown> } | undefined;
      assert.deepEqual(schema?.properties, {});
    }
  });
});

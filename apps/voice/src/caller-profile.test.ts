import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveCallerGeo,
  mergeMissingProfile,
  promoteStage,
  validateProfileFields
} from "./caller-profile.js";

const fields = [
  { key: "service_interest", type: "text" as const, options: [] },
  { key: "visa_type", type: "select" as const, options: ["Student", "Partner"] },
  { key: "has_passport", type: "boolean" as const, options: [] },
  { key: "dependants", type: "number" as const, options: [] }
];

describe("caller geography", () => {
  it("derives stable country and timezone values from common E.164 prefixes", () => {
    assert.deepEqual(deriveCallerGeo("+919876543210"), {
      country: "India",
      timezone: "Asia/Kolkata"
    });
    assert.deepEqual(deriveCallerGeo("+61412345678"), {
      country: "Australia",
      timezone: "Australia/Sydney"
    });
    assert.deepEqual(deriveCallerGeo("+447700900123"), {
      country: "United Kingdom",
      timezone: "Europe/London"
    });
  });

  it("returns null system geography when a prefix is unknown", () => {
    assert.deepEqual(deriveCallerGeo("+999123456789"), {
      country: null,
      timezone: null
    });
  });
});

describe("caller profile validation", () => {
  it("accepts a reserved name and valid configured values", () => {
    const result = validateProfileFields(
      {
        name: " Sumant Pathak ",
        service_interest: "Student visa",
        visa_type: "Student",
        has_passport: true,
        dependants: 2
      },
      fields
    );

    assert.deepEqual(result.accepted, {
      name: "Sumant Pathak",
      service_interest: "Student visa",
      visa_type: "Student",
      has_passport: true,
      dependants: 2
    });
    assert.deepEqual(result.rejected, []);
  });

  it("keeps valid values while returning terse rejection codes", () => {
    const result = validateProfileFields(
      {
        service_interest: "Australia migration",
        visa_type: "Tourist",
        has_passport: "yes",
        mystery: "value"
      },
      fields
    );

    assert.deepEqual(result.accepted, {
      service_interest: "Australia migration"
    });
    assert.deepEqual(result.rejected, [
      { key: "visa_type", code: "invalid_option" },
      { key: "has_passport", code: "wrong_type" },
      { key: "mystery", code: "unknown_key" }
    ]);
  });

  it("fills only missing values during post-call reconciliation", () => {
    assert.deepEqual(
      mergeMissingProfile(
        { country: "India", dependants: 0, has_passport: false },
        { country: "Australia", dependants: 2, has_passport: true, target_date: "July" }
      ),
      { country: "India", dependants: 0, has_passport: false, target_date: "July" }
    );
  });

  it("promotes stages monotonically and enforces booked when a booking exists", () => {
    assert.equal(promoteStage("interested", "new", false), "interested");
    assert.equal(promoteStage("new", "interested", false), "interested");
    assert.equal(promoteStage("new", "new", true), "booked");
    assert.equal(promoteStage("client", "booked", true), "client");
  });
});

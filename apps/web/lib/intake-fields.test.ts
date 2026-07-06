import { describe, expect, it } from "vitest";
import {
  canManageIntakeFields,
  normalizeSelectOptions,
  resolveDisplayedCountry,
  slugifyIntakeKey
} from "./intake-fields";

describe("intake field helpers", () => {
  it("creates immutable safe keys and reserves name", () => {
    expect(slugifyIntakeKey("Visa Type")).toBe("visa_type");
    expect(() => slugifyIntakeKey("Name")).toThrow(/reserved/i);
  });

  it("normalizes unique select options", () => {
    expect(normalizeSelectOptions("Student\nPartner\nStudent")).toEqual(["Student", "Partner"]);
  });

  it("limits schema editing to owners", () => {
    expect(canManageIntakeFields("owner")).toBe(true);
    expect(canManageIntakeFields("staff")).toBe(false);
  });

  it("prefers an active caller-stated country for display only", () => {
    expect(resolveDisplayedCountry({ country: "Australia" }, ["country"], "India")).toBe("Australia");
    expect(resolveDisplayedCountry({ country: "Australia" }, [], "India")).toBe("India");
  });
});

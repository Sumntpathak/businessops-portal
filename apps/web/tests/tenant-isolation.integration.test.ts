import { describe, expect, it } from "vitest";
import { selectAuthorizedMembership } from "../lib/tenant-access";

const memberships = [
  { userId: "user-a", tenantId: "tenant-a", slug: "alpha", name: "Alpha Clinic", role: "owner" as const },
  { userId: "user-b", tenantId: "tenant-b", slug: "bravo", name: "Bravo Clinic", role: "owner" as const }
];

describe("tenant isolation", () => {
  it("never resolves a tenant owned by another user even when its id is requested", () => {
    const selected = selectAuthorizedMembership(memberships, "user-a", "tenant-b");

    expect(selected?.tenantId).toBe("tenant-a");
    expect(selected?.tenantId).not.toBe("tenant-b");
  });

  it("returns only the authenticated user's requested membership", () => {
    const selected = selectAuthorizedMembership(memberships, "user-b", "tenant-b");

    expect(selected).toMatchObject({ userId: "user-b", tenantId: "tenant-b" });
  });

  it("returns null when the authenticated user has no memberships", () => {
    expect(selectAuthorizedMembership(memberships, "user-c", "tenant-a")).toBeNull();
  });
});

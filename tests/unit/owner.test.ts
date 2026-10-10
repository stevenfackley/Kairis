import { describe, expect, it } from "vitest";
import { isOwner, parseOwnerEmails } from "@/lib/domain/owner";

describe("owner", () => {
  it("parses a comma list case-insensitively", () => { expect(parseOwnerEmails(" A@x.com, b@y.com ,")).toEqual(["a@x.com", "b@y.com"]); });
  it("is owner by email or realm role, never by default", () => {
    expect(isOwner({ email: "a@x.com", roles: [] }, ["a@x.com"])).toBe(true);
    expect(isOwner({ email: "z@x.com", roles: ["owner"] }, [])).toBe(true);
    expect(isOwner({ email: "z@x.com", roles: ["user"] }, ["a@x.com"])).toBe(false);
    expect(isOwner({ email: null, roles: [] }, [])).toBe(false);
  });
});

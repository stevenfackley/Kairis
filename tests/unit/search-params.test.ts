import { describe, expect, it } from "vitest";
import { firstString, oneOf } from "@/lib/search-params";

describe("firstString", () => {
  it("returns strings, first of arrays, null otherwise", () => {
    expect(firstString({ a: "x" }, "a")).toBe("x");
    expect(firstString({ a: ["x", "y"] }, "a")).toBe("x");
    expect(firstString({ a: [] }, "a")).toBeNull();
    expect(firstString({}, "a")).toBeNull();
    expect(firstString({ a: undefined }, "a")).toBeNull();
  });
});

describe("oneOf", () => {
  it("accepts only allowed values", () => {
    expect(oneOf("a", ["a", "b"] as const)).toBe("a");
    expect(oneOf("c", ["a", "b"] as const)).toBeNull();
    expect(oneOf(null, ["a"] as const)).toBeNull();
    expect(oneOf("toString", ["a"] as const)).toBeNull();
  });
});

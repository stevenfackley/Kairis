import { describe, expect, it } from "vitest";
import { safeCallbackUrl, signInPath } from "@/lib/auth/paths";

describe("safeCallbackUrl", () => {
  it("falls back for empty input", () => {
    expect(safeCallbackUrl(undefined)).toBe("/app");
    expect(safeCallbackUrl(null)).toBe("/app");
    expect(safeCallbackUrl("")).toBe("/app");
    expect(safeCallbackUrl("", "/x")).toBe("/x");
  });
  it("rejects external, protocol-relative and backslash urls", () => {
    expect(safeCallbackUrl("https://evil.example/app")).toBe("/app");
    expect(safeCallbackUrl("//evil.example")).toBe("/app");
    expect(safeCallbackUrl("/\\evil.example")).toBe("/app");
    expect(safeCallbackUrl("app/relative")).toBe("/app");
  });
  it("keeps same-origin paths", () => {
    expect(safeCallbackUrl("/app/trades?id=1")).toBe("/app/trades?id=1");
  });
});

describe("signInPath", () => {
  it("encodes the callback", () => {
    expect(signInPath("/app/x?a=1&b=2")).toBe("/sign-in?callbackUrl=%2Fapp%2Fx%3Fa%3D1%26b%3D2");
  });
  it("sanitises unsafe callbacks", () => {
    expect(signInPath("//evil.example")).toBe("/sign-in?callbackUrl=%2Fapp");
  });
});

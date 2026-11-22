import { describe, expect, it } from "vitest";
import { ASSISTED_STATUS, countsTowardExposure } from "@/lib/domain/assisted-status";

describe("ASSISTED_STATUS", () => {
  it("gives every status its pill tone", () => {
    expect(Object.fromEntries(Object.entries(ASSISTED_STATUS).map(([status, meaning]) => [status, meaning.tone]))).toEqual({
      previewed: "pill-warn",
      submitted: "pill-warn",
      filled: "pill-ok",
      blocked: "pill-bad",
      failed: "pill-bad",
      cancelled: "pill-bad",
      expired: "pill-bad"
    });
  });

  it("marks only submitted and filled as in flight or filled", () => {
    const inFlightOrFilled = Object.entries(ASSISTED_STATUS).filter(([, meaning]) => meaning.inFlightOrFilled).map(([status]) => status);
    expect(inFlightOrFilled.sort()).toEqual(["filled", "submitted"]);
  });
});

describe("countsTowardExposure", () => {
  it("counts filled and submitted orders whatever they report", () => {
    for (const status of ["filled", "submitted"] as const) {
      for (const filledSize of [null, 0, 0.5]) expect(countsTowardExposure({ status, filledSize })).toBe(true);
    }
  });

  it("counts a failed, cancelled or expired order only while it reports a partial fill", () => {
    for (const status of ["failed", "cancelled", "expired"] as const) {
      expect(countsTowardExposure({ status, filledSize: 0.5 })).toBe(true);
      expect(countsTowardExposure({ status, filledSize: 0 })).toBe(false);
      expect(countsTowardExposure({ status, filledSize: null })).toBe(false);
    }
  });

  it("never counts a preview or a blocked attempt", () => {
    for (const status of ["previewed", "blocked"] as const) {
      for (const filledSize of [null, 0, 0.5]) expect(countsTowardExposure({ status, filledSize })).toBe(false);
    }
  });
});

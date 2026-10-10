import { describe, expect, it } from "vitest";
import { usdPrice } from "@/lib/domain/money";

describe("usdPrice", () => {
  it("shows two decimals from $1 up and up to eight below, never $0.00 for a micro price", () => {
    expect(usdPrice(61234.5)).toBe("$61,234.50");
    expect(usdPrice(1)).toBe("$1.00");
    expect(usdPrice(0.5)).toBe("$0.50");
    expect(usdPrice(0.00001234)).toBe("$0.00001234");
    expect(usdPrice(Number.NaN)).toBe("n/a");
  });
});

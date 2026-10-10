import { describe, expect, it } from "vitest";
import { num, pct, short, usd, when } from "@/lib/format";

describe("format", () => {
  it("formats dollars", () => {
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(usd(-5)).toBe("-$5.00");
    expect(usd(0)).toBe("$0.00");
    expect(usd(1500, 0)).toBe("$1,500");
    expect(usd(0.123456, 4)).toBe("$0.1235");
    expect(usd(Number.NaN)).toBe("n/a");
    expect(usd(Number.POSITIVE_INFINITY)).toBe("n/a");
  });

  it("formats plain numbers", () => {
    expect(num(0.123456789)).toBe("0.1235");
    expect(num(0.123456789, 8)).toBe("0.12345679");
    expect(num(12345.5)).toBe("12,345.5");
    expect(num(3, 2)).toBe("3");
    expect(num(Number.NaN)).toBe("n/a");
  });

  it("formats percents given in percent units", () => {
    expect(pct(1.234)).toBe("1.23%");
    expect(pct(0.5, 1)).toBe("0.5%");
    expect(pct(-2)).toBe("-2.00%");
    expect(pct(Number.NaN)).toBe("n/a");
  });

  it("formats UTC timestamps deterministically", () => {
    expect(when("2026-10-09T12:34:56.000Z")).toBe("Oct 9, 2026, 12:34 UTC");
    expect(when("2026-10-09T00:04:00.000Z")).toBe("Oct 9, 2026, 00:04 UTC");
    expect(when("2026-10-09T23:59:00-05:00")).toBe("Oct 10, 2026, 04:59 UTC");
    expect(when("")).toBe("n/a");
    expect(when("not a date")).toBe("n/a");
  });

  it("shortens ids", () => {
    expect(short("3f2b9c1e-aaaa-bbbb-cccc-1234567890ab")).toBe("3f2b9c1e");
    expect(short("abc")).toBe("abc");
  });
});

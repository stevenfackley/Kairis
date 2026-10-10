import { describe, expect, it } from "vitest";
import { atr, ema, rsi } from "@/lib/domain/indicators";
import type { Candle } from "@/lib/types";

const c = (close: number, high = close + 1, low = close - 1): Candle => ({ start: 0, open: close, high, low, close, volume: 1 });

describe("ema", () => {
  it("returns null until the period is filled", () => { expect(ema([1, 2], 3)).toBeNull(); });
  it("seeds with the SMA and smooths", () => {
    // period 3: seed = (1+2+3)/3 = 2; k = 0.5; next = 4*0.5 + 2*0.5 = 3; next = 5*0.5 + 3*0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toBeCloseTo(4, 10);
  });
});

describe("rsi", () => {
  it("is 100 on straight gains and 0 on straight losses", () => {
    expect(rsi(Array.from({ length: 16 }, (_, i) => i + 1), 14)).toBe(100);
    expect(rsi(Array.from({ length: 16 }, (_, i) => 16 - i), 14)).toBe(0);
  });
  it("is 50 when gains equal losses", () => {
    const closes = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10];
    expect(rsi(closes, 14)).toBeCloseTo(50, 5);
  });
  it("returns null without enough data", () => { expect(rsi([1, 2, 3], 14)).toBeNull(); });
});

describe("atr", () => {
  it("averages the true range over the period", () => {
    const candles = [c(10), c(10), c(10), c(10)]; // TR = high-low = 2 every bar
    expect(atr(candles, 3)).toBeCloseTo(2, 10);
  });
  it("uses the previous close when it widens the range", () => {
    const candles = [c(10), { start: 0, open: 20, high: 21, low: 19, close: 20, volume: 1 }];
    // TR = max(21-19, |21-10|, |19-10|) = 11
    expect(atr(candles, 1)).toBeCloseTo(11, 10);
  });
});

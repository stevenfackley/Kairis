import { describe, expect, it } from "vitest";
import { completedCandles, evaluateSignal, suggestedQuoteUsd } from "@/lib/domain/signals";
import type { Candle, Ticker } from "@/lib/types";

const now = Date.UTC(2026, 9, 9, 12, 0, 0);
function series(closes: number[]): Candle[] {
  const startOfLast = Math.floor(now / 1000) - 3600;
  return closes.map((close, i) => ({ start: startOfLast - (closes.length - 1 - i) * 3600, open: close, high: close * 1.005, low: close * 0.995, close, volume: 100 }));
}
const ticker = (price: number, spreadPct = 0.02, ageMs = 1000): Ticker => ({ productId: "BTC-USD", price, bestBid: price * (1 - spreadPct / 200), bestAsk: price * (1 + spreadPct / 200), tradeTime: now - ageMs });

/** 60 choppy candles (100 / 99.7, RSI near 50) then a short climb: EMA9 crosses above EMA21 within the last 3 candles, RSI lands in the 55-65 band. */
const uptrend = [...Array.from({ length: 60 }, (_, i) => 100 - (i % 2) * 0.3), ...Array.from({ length: 3 }, (_, i) => 100 + i * 0.5)];
/** Steady decline. */
const downtrend = Array.from({ length: 72 }, (_, i) => 120 - i * 0.3);

describe("evaluateSignal", () => {
  it("goes long on a fresh EMA cross with RSI inside the band", () => {
    const r = evaluateSignal("BTC-USD", series(uptrend), ticker(101), now);
    expect(r.action).toBe("long");
    expect(r.rationale.join(" ")).toMatch(/EMA 9 crossed above EMA 21/);
    expect(r.strength).toBeGreaterThan(0);
  });
  it("observes when no cross happened", () => {
    expect(evaluateSignal("BTC-USD", series(downtrend), ticker(98), now).action).toBe("observe");
  });
  it("blocks on a wide spread", () => {
    const r = evaluateSignal("BTC-USD", series(uptrend), ticker(101, 1.2), now);
    expect(r.action).toBe("blocked");
    expect(r.rationale.join(" ")).toMatch(/spread/i);
  });
  it("blocks on stale ticker data", () => {
    const r = evaluateSignal("BTC-USD", series(uptrend), ticker(101, 0.02, 10 * 60 * 1000), now);
    expect(r.action).toBe("blocked");
    expect(r.rationale.join(" ")).toMatch(/stale/i);
  });
  it("blocks when there are not enough candles", () => {
    expect(evaluateSignal("BTC-USD", series([1, 2, 3]), ticker(3), now).action).toBe("blocked");
  });
  it("ignores the hourly candle that is still forming", () => {
    const closed = series(uptrend);
    // A crash inside the current, unfinished hour would flip EMA 9 below EMA 21 if it were used.
    const forming = { start: Math.floor(now / 1000) - 600, open: 101, high: 101, low: 60, close: 60, volume: 5 };
    const r = evaluateSignal("BTC-USD", [...closed, forming], ticker(101), now);
    expect(r.action).toBe("long");
    expect(r).toEqual(evaluateSignal("BTC-USD", closed, ticker(101), now));
  });
  it("does not depend on the order the candles arrive in", () => {
    const closed = series(uptrend);
    const shuffled = [...closed].reverse();
    expect(evaluateSignal("BTC-USD", shuffled, ticker(101), now)).toEqual(evaluateSignal("BTC-USD", closed, ticker(101), now));
  });
  it("judges staleness on the last completed candle", () => {
    const old = series(uptrend).map((c) => ({ ...c, start: c.start - 3 * 3600 }));
    const r = evaluateSignal("BTC-USD", old, ticker(101), now);
    expect(r.action).toBe("blocked");
    expect(r.setup).toBe("Stale data");
  });
  it("never reports a non-finite ATR when a close is zero", () => {
    const zeroed = series(uptrend);
    zeroed[zeroed.length - 1] = { ...zeroed[zeroed.length - 1]!, close: 0, low: 0 };
    const r = evaluateSignal("BTC-USD", zeroed, ticker(101), now);
    expect(r.atrPct === null || Number.isFinite(r.atrPct)).toBe(true);
  });
});

describe("completedCandles", () => {
  it("sorts by start time and drops the candle whose hour has not closed", () => {
    const nowSec = Math.floor(now / 1000);
    const c = (start: number) => ({ start, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    expect(completedCandles([c(nowSec - 3600), c(nowSec - 7200), c(nowSec - 10)], now).map((x) => x.start)).toEqual([nowSec - 7200, nowSec - 3600]);
  });
});

describe("suggestedQuoteUsd", () => {
  it("sizes from the daily loss budget divided by ATR percent and caps at max position", () => {
    // budget = 300 * 0.25 = 75; atrPct 2 -> 75 / 0.02 = 3750 -> capped at 1500
    expect(suggestedQuoteUsd({ dailyLossCapUsd: 300, maxPositionUsd: 1500 }, 2)).toBe(1500);
    // atrPct 10 -> 75 / 0.10 = 750
    expect(suggestedQuoteUsd({ dailyLossCapUsd: 300, maxPositionUsd: 1500 }, 10)).toBe(750);
  });
  it("returns 0 without an ATR", () => { expect(suggestedQuoteUsd({ dailyLossCapUsd: 300, maxPositionUsd: 1500 }, null)).toBe(0); });
  it("never suggests more than the product's per-symbol cap", () => {
    const limits = { dailyLossCapUsd: 300, maxPositionUsd: 1500, perSymbolMaxUsd: { "SOL-USD": 200 } };
    expect(suggestedQuoteUsd(limits, 2, "SOL-USD")).toBe(200);
    expect(suggestedQuoteUsd(limits, 2, "BTC-USD")).toBe(1500);
    expect(suggestedQuoteUsd(limits, 50, "SOL-USD")).toBe(150);
  });
  it("rounds down to whole cents so the suggestion never lands a cent over a limit", () => {
    // 75 / 0.0333 = 2252.25..., capped at 2252.25 is fine; 75 / 0.07 = 1071.428... -> 1071.42
    expect(suggestedQuoteUsd({ dailyLossCapUsd: 300, maxPositionUsd: 5000 }, 7)).toBe(1071.42);
  });
});

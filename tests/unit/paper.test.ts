import { describe, expect, it } from "vitest";
import { buildPositions, dayStats, fillPaperOrder, isFlat, realizeSell } from "@/lib/domain/paper";
import { DUST_BASE_SIZE, PAPER_TAKER_FEE_RATE } from "@/lib/domain/strategy";
import type { PaperTrade } from "@/lib/types";

const t = (o: Partial<PaperTrade>): PaperTrade => ({ id: "1", userId: "u", productId: "BTC-USD", side: "BUY", baseSize: 1, price: 100, quoteUsd: 100, feeUsd: null, status: "filled", realizedPnlUsd: 0, note: "", signalId: null, riskDecision: null, createdAt: "2026-10-09T10:00:00Z", ...o });

describe("buildPositions", () => {
  it("averages cost on buys and reduces on sells", () => {
    const p = buildPositions([t({ baseSize: 1, price: 100 }), t({ baseSize: 1, price: 200, createdAt: "2026-10-09T10:01:00Z" }), t({ side: "SELL", baseSize: 1, price: 300, createdAt: "2026-10-09T10:02:00Z" })], { "BTC-USD": 300 });
    expect(p["BTC-USD"]).toEqual({ baseSize: 1, avgCost: 150, notionalUsd: 300 });
  });
  it("drops flat positions and ignores blocked trades", () => {
    expect(buildPositions([t({}), t({ side: "SELL", createdAt: "2026-10-09T10:01:00Z" }), t({ status: "blocked", baseSize: 5 })], {})).toEqual({});
  });
  it("adds buy fees to the cost basis; sell fees leave the average cost alone", () => {
    const p = buildPositions([
      t({ baseSize: 1, price: 100, feeUsd: 0.6 }),
      t({ baseSize: 1, price: 100, feeUsd: 0.6, createdAt: "2026-10-09T10:01:00Z" }),
      t({ side: "SELL", baseSize: 0.5, price: 120, feeUsd: 0.36, createdAt: "2026-10-09T10:02:00Z" })
    ], { "BTC-USD": 120 });
    expect(p["BTC-USD"]!.baseSize).toBeCloseTo(1.5, 12);
    expect(p["BTC-USD"]!.avgCost).toBeCloseTo(100.6, 12);
  });
  it("treats a remainder below the dust threshold as flat, and a later buy starts a fresh average", () => {
    const fills = [
      t({ baseSize: 0.3, price: 100 }),
      t({ side: "SELL", baseSize: 0.3 - DUST_BASE_SIZE / 10, price: 100, createdAt: "2026-10-09T10:01:00Z" })
    ];
    expect(buildPositions(fills, {})).toEqual({});
    const reopened = buildPositions([...fills, t({ baseSize: 1, price: 50, createdAt: "2026-10-09T10:02:00Z" })], {});
    expect(reopened["BTC-USD"]).toEqual({ baseSize: 1, avgCost: 50, notionalUsd: 50 });
  });
  it("leaves no phantom position from float noise on large sizes", () => {
    // In floats, 18205783.61333829 - 9157509 - 9048274.61333829 is 1.86e-9, above the dust threshold.
    const p = buildPositions([
      t({ productId: "SHIB-USD", baseSize: 18205783.61333829, price: 0.00000546 }),
      t({ productId: "SHIB-USD", side: "SELL", baseSize: 9157509, price: 0.00000546, createdAt: "2026-10-09T10:01:00Z" }),
      t({ productId: "SHIB-USD", side: "SELL", baseSize: 9048274.61333829, price: 0.00000546, createdAt: "2026-10-09T10:02:00Z" })
    ], {});
    expect(p).toEqual({});
  });
  it("keeps each product separate across interleaved fills, including products outside the watchlist", () => {
    const p = buildPositions([
      t({ productId: "AVAX-USD", baseSize: 2, price: 30, createdAt: "2026-10-01T00:00:00Z" }),
      t({ productId: "BTC-USD", baseSize: 1, price: 100, createdAt: "2026-10-02T00:00:00Z" }),
      t({ productId: "AVAX-USD", baseSize: 2, price: 40, createdAt: "2026-10-03T00:00:00Z" })
    ], { "BTC-USD": 110 });
    expect(p["AVAX-USD"]).toEqual({ baseSize: 4, avgCost: 35, notionalUsd: 140 });
    expect(p["BTC-USD"]).toEqual({ baseSize: 1, avgCost: 100, notionalUsd: 110 });
  });
  it("orders fills by time, not by input order", () => {
    const p = buildPositions([
      t({ side: "SELL", baseSize: 1, price: 150, createdAt: "2026-10-09T11:00:00Z" }),
      t({ baseSize: 2, price: 100, createdAt: "2026-10-09T10:00:00Z" })
    ], {});
    expect(p["BTC-USD"]).toMatchObject({ baseSize: 1, avgCost: 100 });
  });
});

describe("isFlat", () => {
  it("is true below the dust threshold and for non-finite sizes", () => {
    expect(isFlat(0)).toBe(true);
    expect(isFlat(DUST_BASE_SIZE / 2)).toBe(true);
    expect(isFlat(-DUST_BASE_SIZE / 2)).toBe(true);
    expect(isFlat(Number.NaN)).toBe(true);
    expect(isFlat(DUST_BASE_SIZE)).toBe(false);
    expect(isFlat(0.00000001)).toBe(false);
  });
});

describe("fillPaperOrder", () => {
  it("spends exactly the quote on a buy, fee included, as Coinbase does", () => {
    expect(PAPER_TAKER_FEE_RATE).toBe(0.006);
    // $100 at $100: filled value 100 / 1.006 = 99.40357853, fee 0.59642147, coins 0.99403579.
    const f = fillPaperOrder({}, { productId: "BTC-USD", side: "BUY", quoteUsd: 100, mode: "paper" }, 100);
    expect(f).toEqual({ baseSize: 0.99403579, price: 100, feeUsd: 0.59642147, realizedPnlUsd: 0 });
    expect(f.baseSize * f.price + f.feeUsd).toBeCloseTo(100, 6);
    expect(fillPaperOrder({ "BTC-USD": undefined }, { productId: "BTC-USD", side: "BUY", quoteUsd: 50, mode: "paper" }, 200)).toEqual({
      baseSize: 0.24850895,
      price: 200,
      feeUsd: 0.29821074,
      realizedPnlUsd: 0
    });
  });
  it("matches the mock exchange's fee-inclusive buy to the satoshi", async () => {
    const { createMockClient } = await import("@/lib/exchange/mock");
    const mock = createMockClient(async () => 100, () => "id");
    const preview = await mock.previewOrder({ productId: "BTC-USD", side: "BUY", size: { kind: "quote", quoteSize: "100" } });
    const f = fillPaperOrder({}, { productId: "BTC-USD", side: "BUY", quoteUsd: 100, mode: "paper" }, 100);
    expect({ baseSize: f.baseSize, feeUsd: f.feeUsd }).toEqual({ baseSize: preview.baseSize, feeUsd: preview.commissionTotal });
  });
  it("fills nothing on a buy without a usable price", () => {
    expect(fillPaperOrder({}, { productId: "BTC-USD", side: "BUY", quoteUsd: 100, mode: "paper" }, 0)).toEqual({ baseSize: 0, price: 0, feeUsd: 0, realizedPnlUsd: 0 });
  });
  it("realizes P&L on a sell net of the sell fee, against an average cost that already holds the buy fee", () => {
    const f = fillPaperOrder({ "BTC-USD": { baseSize: 2, avgCost: 100.6, notionalUsd: 300 } }, { productId: "BTC-USD", side: "SELL", quoteUsd: 150, mode: "paper" }, 150);
    expect(f.baseSize).toBeCloseTo(1, 10);
    expect(f.feeUsd).toBeCloseTo(0.9, 10);
    // 150 proceeds - 0.90 fee - 100.60 cost = 48.50
    expect(f.realizedPnlUsd).toBeCloseTo(48.5, 10);
  });
  it("a flat round trip loses both fees (about 1.19%)", () => {
    const buy = fillPaperOrder({}, { productId: "BTC-USD", side: "BUY", quoteUsd: 100, mode: "paper" }, 100);
    const positions = buildPositions([t({ baseSize: buy.baseSize, price: buy.price, feeUsd: buy.feeUsd })], {});
    // The cost basis is the $100 spent, fee included.
    expect(positions["BTC-USD"]!.baseSize * positions["BTC-USD"]!.avgCost).toBeCloseTo(100, 6);
    const sell = fillPaperOrder(positions, { productId: "BTC-USD", side: "SELL", quoteUsd: 100, mode: "paper" }, 100);
    expect(sell.baseSize).toBe(0.99403579);
    // Proceeds 99.403579 - 0.59642147 sell fee = 98.80715753 against the $100 spent.
    expect(sell.feeUsd).toBe(0.59642147);
    expect(sell.realizedPnlUsd).toBeCloseTo(-1.19284294, 6);
  });
  it("caps a sell at the held size and closes the position when only dust would remain", () => {
    const held = { "BTC-USD": { baseSize: 1, avgCost: 100, notionalUsd: 100 } };
    expect(fillPaperOrder(held, { productId: "BTC-USD", side: "SELL", quoteUsd: 500, mode: "paper" }, 100).baseSize).toBe(1);
    // 0.1 + 0.2 held; selling $30 at $100 asks for 0.3 and would leave 5.5e-17 behind.
    const noisy = { "BTC-USD": { baseSize: 0.1 + 0.2, avgCost: 100, notionalUsd: 30 } };
    const all = fillPaperOrder(noisy, { productId: "BTC-USD", side: "SELL", quoteUsd: 30, mode: "paper" }, 100);
    expect(all.baseSize).toBe(0.1 + 0.2);
  });
  it("rounds size and price to the 8 decimals the database stores, so rebuilt positions match the fill", () => {
    const f = fillPaperOrder({}, { productId: "BTC-USD", side: "BUY", quoteUsd: 100, mode: "paper" }, 61234.567891234);
    expect(f.price).toBe(61234.56789123);
    expect(f.baseSize).toBe(0.00162332); // 100 / 1.006 / 61234.56789123 = 0.0016233245...
    expect(f.feeUsd).toBe(0.59642147);
  });
  it("closes the exact held size when asked to, whatever the dollar size rounds to", () => {
    const held = { "BTC-USD": { baseSize: 0.12345678, avgCost: 100, notionalUsd: 0 } };
    // $12.35 at $100 asks for 0.1235, more than held; $12.34 asks for 0.1234, less than held.
    for (const quoteUsd of [12.35, 12.34]) {
      const f = fillPaperOrder(held, { productId: "BTC-USD", side: "SELL", quoteUsd, mode: "paper" }, 100, PAPER_TAKER_FEE_RATE, { closePosition: true });
      expect(f.baseSize).toBe(0.12345678);
    }
  });
  it("fills the Coinbase-sized order: the floored quote on a buy, the floored coins on a sell", () => {
    const buy = fillPaperOrder({}, { productId: "BTC-USD", side: "BUY", quoteUsd: 100.759, mode: "paper" }, 100, PAPER_TAKER_FEE_RATE, {
      size: { kind: "quote", quoteSize: "100.75" }
    });
    expect(buy.baseSize * buy.price + buy.feeUsd).toBeCloseTo(100.75, 6);
    const held = { "SHIB-USD": { baseSize: 20000000, avgCost: 0.000005, notionalUsd: 0 } };
    const sell = fillPaperOrder(held, { productId: "SHIB-USD", side: "SELL", quoteUsd: 50, mode: "paper" }, 0.00000546, PAPER_TAKER_FEE_RATE, {
      size: { kind: "base", baseSize: "9157509" },
      baseIncrement: "1"
    });
    expect(sell.baseSize).toBe(9157509);
  });
  describe("dust rule: a sell never leaves less than one base_increment behind", () => {
    const sellOf = (heldSize: number, baseSize: string, baseIncrement: string) =>
      fillPaperOrder({ "SHIB-USD": { baseSize: heldSize, avgCost: 1, notionalUsd: 0 } }, { productId: "SHIB-USD", side: "SELL", quoteUsd: 1, mode: "paper" }, 1, PAPER_TAKER_FEE_RATE, {
        size: { kind: "base", baseSize },
        baseIncrement
      }).baseSize;
    it("sells the full held amount when the floored size would strand a sub-increment remainder", () => {
      expect(sellOf(18206777.07, "18206777", "1")).toBe(18206777.07);
      expect(sellOf(0.12345678, "0.12345", "0.00001")).toBe(0.12345678);
    });
    it("keeps a remainder of one increment or more", () => {
      expect(sellOf(18206778, "18206777", "1")).toBe(18206777);
      expect(sellOf(0.00000002, "0.00000001", "0.00000001")).toBe(0.00000001);
      expect(sellOf(0.3, "0.1", "0.00000001")).toBe(0.1);
    });
  });
  it("realizes nothing on a sell without a position", () => {
    expect(fillPaperOrder({}, { productId: "BTC-USD", side: "SELL", quoteUsd: 10, mode: "paper" }, 100)).toEqual({ baseSize: 0, price: 100, feeUsd: 0, realizedPnlUsd: 0 });
  });
});

describe("realizeSell", () => {
  it("pro-rates the fee when the sell is larger than the recorded position", () => {
    // Holds 1 at 100; a 2-unit sell at 110 with a 1.32 fee realizes only the held unit: 110 - 0.66 - 100.
    expect(realizeSell({ baseSize: 1, avgCost: 100 }, 2, 110, 1.32)).toBeCloseTo(9.34, 10);
    expect(realizeSell(undefined, 2, 110, 1.32)).toBe(0);
  });
});

describe("dayStats", () => {
  it("counts today's fills, sums realized P&L, tracks the loss streak", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const s = dayStats([
      t({ createdAt: "2026-10-08T23:00:00Z", side: "SELL", realizedPnlUsd: -500 }), // yesterday, ignored
      t({ createdAt: "2026-10-09T09:00:00Z", side: "SELL", realizedPnlUsd: 20 }),
      t({ createdAt: "2026-10-09T10:00:00Z", side: "SELL", realizedPnlUsd: -10 }),
      t({ createdAt: "2026-10-09T11:00:00Z", side: "SELL", realizedPnlUsd: -5 }),
      t({ createdAt: "2026-10-09T11:30:00Z", status: "blocked" })
    ], now);
    expect(s).toEqual({ tradesCount: 3, realizedPnlUsd: 5, consecutiveLosses: 2, lastLossAt: "2026-10-09T11:00:00Z" });
  });
  it("never counts a buy as a loss, even though it paid a fee", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const s = dayStats([
      t({ createdAt: "2026-10-09T09:00:00Z", side: "SELL", realizedPnlUsd: -3 }),
      t({ createdAt: "2026-10-09T10:00:00Z", side: "BUY", feeUsd: 6, realizedPnlUsd: 0 }),
      t({ createdAt: "2026-10-09T11:00:00Z", side: "BUY", feeUsd: 6, realizedPnlUsd: 0 })
    ], now);
    expect(s).toEqual({ tradesCount: 3, realizedPnlUsd: -3, consecutiveLosses: 1, lastLossAt: "2026-10-09T09:00:00Z" });
  });
  it("does not count blocked attempts toward trades used", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(dayStats([t({ status: "blocked" }), t({ status: "blocked" })], now).tradesCount).toBe(0);
  });
  describe("loss streak across midnight", () => {
    const streak = [
      t({ createdAt: "2026-10-08T23:40:00Z", side: "SELL", realizedPnlUsd: -5 }),
      t({ createdAt: "2026-10-08T23:50:00Z", side: "SELL", realizedPnlUsd: -5 })
    ];
    it("keeps the streak and last loss past 00:00 UTC while today's counts reset", () => {
      const s = dayStats(streak, new Date("2026-10-09T00:05:00Z"));
      expect(s).toEqual({ tradesCount: 0, realizedPnlUsd: 0, consecutiveLosses: 2, lastLossAt: "2026-10-08T23:50:00Z" });
    });
    it("ignores losses older than 24 hours", () => {
      const s = dayStats([t({ createdAt: "2026-10-02T10:00:00Z", side: "SELL", realizedPnlUsd: -5 }), t({ createdAt: "2026-10-02T11:00:00Z", side: "SELL", realizedPnlUsd: -5 })], new Date("2026-10-09T12:00:00Z"));
      expect(s).toMatchObject({ consecutiveLosses: 0, lastLossAt: null });
    });
    it("resets the streak on a gain but skips zero-P&L buys", () => {
      const now = new Date("2026-10-09T12:00:00Z");
      const s = dayStats([
        t({ createdAt: "2026-10-09T08:00:00Z", side: "SELL", realizedPnlUsd: -5 }),
        t({ createdAt: "2026-10-09T09:00:00Z", side: "SELL", realizedPnlUsd: 3 }),
        t({ createdAt: "2026-10-09T10:00:00Z", side: "SELL", realizedPnlUsd: -2 }),
        t({ createdAt: "2026-10-09T11:00:00Z", side: "BUY", realizedPnlUsd: 0 })
      ], now);
      expect(s).toMatchObject({ consecutiveLosses: 1, lastLossAt: "2026-10-09T10:00:00Z" });
    });
  });
});

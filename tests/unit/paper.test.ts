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
  it("fills a buy at the reference price and charges the taker fee on the notional", () => {
    const f = fillPaperOrder({ "BTC-USD": undefined }, { productId: "BTC-USD", side: "BUY", quoteUsd: 50, mode: "paper" }, 200);
    expect(f).toEqual({ baseSize: 0.25, price: 200, feeUsd: 0.3, realizedPnlUsd: 0 });
    expect(PAPER_TAKER_FEE_RATE).toBe(0.006);
  });
  it("realizes P&L on a sell net of the sell fee, against an average cost that already holds the buy fee", () => {
    const f = fillPaperOrder({ "BTC-USD": { baseSize: 2, avgCost: 100.6, notionalUsd: 300 } }, { productId: "BTC-USD", side: "SELL", quoteUsd: 150, mode: "paper" }, 150);
    expect(f.baseSize).toBeCloseTo(1, 10);
    expect(f.feeUsd).toBeCloseTo(0.9, 10);
    // 150 proceeds - 0.90 fee - 100.60 cost = 48.50
    expect(f.realizedPnlUsd).toBeCloseTo(48.5, 10);
  });
  it("a flat round trip loses both fees (about 1.2%)", () => {
    const buy = fillPaperOrder({}, { productId: "BTC-USD", side: "BUY", quoteUsd: 100, mode: "paper" }, 100);
    const positions = buildPositions([t({ baseSize: buy.baseSize, price: buy.price, feeUsd: buy.feeUsd })], {});
    const sell = fillPaperOrder(positions, { productId: "BTC-USD", side: "SELL", quoteUsd: 100, mode: "paper" }, 100);
    expect(sell.realizedPnlUsd).toBeCloseTo(-1.2, 10);
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
    expect(f.baseSize).toBe(0.00163306); // 100 / 61234.56789123 = 0.0016330645...
    expect(f.feeUsd).toBe(Math.round(f.baseSize * f.price * 0.006 * 1e8) / 1e8);
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
});

import { describe, expect, it } from "vitest";
import { evaluateRisk } from "@/lib/domain/risk";
import type { OrderIntent, RiskContext, TradingLimits } from "@/lib/types";

const limits: TradingLimits = { userId: "u", maxPositionUsd: 1500, dailyLossCapUsd: 300, maxTradesPerDay: 6, cooldownMinutes: 20, lossStreakTrigger: 2, perSymbolMaxUsd: { "SOL-USD": 200 }, tradingPaused: false, updatedAt: "" };
const now = new Date("2026-10-09T12:00:00Z");
const ctx = (over: Partial<RiskContext> = {}): RiskContext => ({ limits, today: { tradesCount: 0, realizedPnlUsd: 0, consecutiveLosses: 0, lastLossAt: null }, positions: {}, referencePrice: 100, dataAgeMs: 1000, maxDataAgeMs: 300000, providerDegraded: false, now, ...over });
const buy = (quoteUsd: number, productId = "BTC-USD"): OrderIntent => ({ productId, side: "BUY", quoteUsd, mode: "paper" });

describe("evaluateRisk", () => {
  it("approves a small buy", () => {
    const d = evaluateRisk(ctx(), buy(100));
    expect(d.outcome).toBe("approved");
    expect(d.checks.every((c) => c.passed)).toBe(true);
  });
  it("halts when trading is paused", () => {
    const d = evaluateRisk(ctx({ limits: { ...limits, tradingPaused: true } }), buy(100));
    expect(d.outcome).toBe("halted");
    expect(d.reasons[0]).toMatch(/paused/i);
  });
  it("halts on stale data and on provider degradation", () => {
    expect(evaluateRisk(ctx({ dataAgeMs: 999999 }), buy(100)).outcome).toBe("halted");
    expect(evaluateRisk(ctx({ providerDegraded: true }), buy(100)).outcome).toBe("halted");
  });
  it("blocks when the order alone exceeds max position", () => {
    expect(evaluateRisk(ctx(), buy(1501)).outcome).toBe("blocked");
  });
  it("blocks when the resulting position exceeds max position", () => {
    const d = evaluateRisk(ctx({ positions: { "BTC-USD": { baseSize: 10, avgCost: 100, notionalUsd: 1000 } } }), buy(600));
    expect(d.outcome).toBe("blocked");
    expect(d.reasons.join(" ")).toMatch(/max position/i);
  });
  it("blocks on the per-symbol cap", () => {
    expect(evaluateRisk(ctx(), buy(250, "SOL-USD")).reasons.join(" ")).toMatch(/SOL-USD cap/);
  });
  it("blocks when trades per day are exhausted", () => {
    expect(evaluateRisk(ctx({ today: { tradesCount: 6, realizedPnlUsd: 0, consecutiveLosses: 0, lastLossAt: null } }), buy(100)).outcome).toBe("blocked");
  });
  it("blocks when the daily loss cap is hit", () => {
    expect(evaluateRisk(ctx({ today: { tradesCount: 1, realizedPnlUsd: -300, consecutiveLosses: 1, lastLossAt: null } }), buy(100)).outcome).toBe("blocked");
  });
  it("blocks during cooldown after a loss streak and clears after it", () => {
    const streak = { tradesCount: 2, realizedPnlUsd: -50, consecutiveLosses: 2, lastLossAt: "2026-10-09T11:50:00Z" };
    expect(evaluateRisk(ctx({ today: streak }), buy(100)).reasons.join(" ")).toMatch(/cooldown/i);
    expect(evaluateRisk(ctx({ today: { ...streak, lastLossAt: "2026-10-09T11:00:00Z" } }), buy(100)).outcome).toBe("approved");
  });
  it("lets a sell reduce a position even above the caps, but still respects pause", () => {
    const pos = { "BTC-USD": { baseSize: 20, avgCost: 100, notionalUsd: 2000 } };
    expect(evaluateRisk(ctx({ positions: pos }), { productId: "BTC-USD", side: "SELL", quoteUsd: 2000, mode: "paper" }).outcome).toBe("approved");
    expect(evaluateRisk(ctx({ positions: pos, limits: { ...limits, tradingPaused: true } }), { productId: "BTC-USD", side: "SELL", quoteUsd: 10, mode: "paper" }).outcome).toBe("halted");
  });
  it("blocks a sell larger than the held position", () => {
    expect(evaluateRisk(ctx(), { productId: "BTC-USD", side: "SELL", quoteUsd: 10, mode: "paper" }).reasons.join(" ")).toMatch(/no position/i);
  });
  it("blocks a non-positive quote", () => { expect(evaluateRisk(ctx(), buy(0)).outcome).toBe("blocked"); });

  it("compares limits in whole cents, so float noise never blocks an order that is exactly at a limit", () => {
    // 3 * 33.040000000000006 + 1400.88 = 1500.0000000000002 in floating point.
    const pos = { "BTC-USD": { baseSize: 3, avgCost: 30, notionalUsd: 99.12 } };
    const d = evaluateRisk(ctx({ positions: pos, referencePrice: 33.040000000000006 }), buy(1400.88));
    expect(d.outcome).toBe("approved");
    expect(d.checks.find((c) => c.code === "max-position")?.detail).toBe("Position after fill $1,500.00 is within the $1,500.00 max position.");
  });
  it("allows an order exactly equal to the per-symbol cap and blocks one cent over", () => {
    expect(evaluateRisk(ctx(), buy(200, "SOL-USD")).outcome).toBe("approved");
    expect(evaluateRisk(ctx(), buy(200.01, "SOL-USD")).outcome).toBe("blocked");
  });
  it("treats a realized loss that rounds to the cap as reaching it", () => {
    const today = { tradesCount: 3, realizedPnlUsd: -299.99999999999994, consecutiveLosses: 0, lastLossAt: null };
    const d = evaluateRisk(ctx({ today }), buy(100));
    expect(d.outcome).toBe("blocked");
    expect(d.reasons.join(" ")).toMatch(/Daily loss cap of \$300\.00 reached/);
  });
  it("lets a dollar-sized sell of a whole position through when it only rounds up to the next cent", () => {
    const pos = { "BTC-USD": { baseSize: 0.00495, avgCost: 100, notionalUsd: 0.495 } };
    expect(evaluateRisk(ctx({ positions: pos }), { productId: "BTC-USD", side: "SELL", quoteUsd: 0.5, mode: "paper" }).outcome).toBe("approved");
    expect(evaluateRisk(ctx({ positions: pos }), { productId: "BTC-USD", side: "SELL", quoteUsd: 0.51, mode: "paper" }).outcome).toBe("blocked");
  });
  it("counts a dust-sized holding as no position", () => {
    const pos = { "BTC-USD": { baseSize: 1e-10, avgCost: 100, notionalUsd: 0 } };
    expect(evaluateRisk(ctx({ positions: pos }), { productId: "BTC-USD", side: "SELL", quoteUsd: 0.01, mode: "paper" }).reasons.join(" ")).toMatch(/no position/i);
  });
  it("halts without a usable market price even when the provider answered", () => {
    const d = evaluateRisk(ctx({ referencePrice: 0 }), buy(100));
    expect(d.outcome).toBe("halted");
    expect(d.reasons[0]).toBe("No usable market price for BTC-USD; execution is halted until one arrives.");
    expect(evaluateRisk(ctx({ referencePrice: Number.NaN }), buy(100)).outcome).toBe("halted");
  });
  it("blocks (does not halt) a product Coinbase does not list, without blaming the provider", () => {
    const d = evaluateRisk(ctx({ referencePrice: 0, unknownProduct: true }), buy(100, "ZZZZ-USD"));
    expect(d.outcome).toBe("blocked");
    expect(d.reasons).toEqual(["ZZZZ-USD is not a tradable Coinbase pair."]);
    expect(d.checks.find((c) => c.code === "provider-health")).toMatchObject({ passed: true });
  });
  it("fails closed on limits of 0", () => {
    expect(evaluateRisk(ctx({ limits: { ...limits, maxTradesPerDay: 0 } }), buy(1)).reasons.join(" ")).toMatch(/Daily trade limit of 0 reached/);
    expect(evaluateRisk(ctx({ limits: { ...limits, maxPositionUsd: 0 } }), buy(1)).reasons.join(" ")).toMatch(/max position/);
  });
  it("says the trade count and realized P&L are for the UTC day", () => {
    const d = evaluateRisk(ctx(), buy(100));
    expect(d.checks.find((c) => c.code === "trades-per-day")?.detail).toBe("0 of 6 trades used today (UTC).");
    expect(d.checks.find((c) => c.code === "daily-loss-cap")?.detail).toBe("Realized P&L today (UTC) $0.00 against a $300.00 loss cap.");
  });
  it("starts the cooldown at the last loss and says when it ends", () => {
    const streak = { tradesCount: 2, realizedPnlUsd: -50, consecutiveLosses: 2, lastLossAt: "2026-10-09T11:50:00.000Z" };
    expect(evaluateRisk(ctx({ today: streak }), buy(100)).reasons).toContain(
      "In cooldown after 2 consecutive losses; new orders wait until 12:10 UTC (20 min after the last loss)."
    );
    expect(evaluateRisk(ctx({ today: streak, now: new Date("2026-10-09T12:10:00.000Z") }), buy(100)).outcome).toBe("approved");
  });
  it("never reports a negative data age", () => {
    expect(evaluateRisk(ctx({ dataAgeMs: -4000 }), buy(100)).checks.find((c) => c.code === "fresh-data")?.detail).toBe("Market data is 0 s old.");
  });

  describe("risk-reducing sells", () => {
    const pos = { "BTC-USD": { baseSize: 5, avgCost: 100, notionalUsd: 500 } };
    const sell = (quoteUsd: number): OrderIntent => ({ productId: "BTC-USD", side: "SELL", quoteUsd, mode: "paper" });
    const atCap = { tradesCount: 1, realizedPnlUsd: -300, consecutiveLosses: 0, lastLossAt: null };
    const inCooldown = { tradesCount: 2, realizedPnlUsd: -50, consecutiveLosses: 2, lastLossAt: "2026-10-09T11:50:00Z" };
    const atTradeLimit = { tradesCount: 6, realizedPnlUsd: 0, consecutiveLosses: 0, lastLossAt: null };
    it("lets a sell through at the daily loss cap, in cooldown and after the trade limit", () => {
      for (const today of [atCap, inCooldown, atTradeLimit]) {
        const d = evaluateRisk(ctx({ positions: pos, today }), sell(200));
        expect(d.outcome).toBe("approved");
        expect(d.checks.filter((c) => ["trades-per-day", "daily-loss-cap", "cooldown"].includes(c.code)).every((c) => c.passed)).toBe(true);
      }
      const d = evaluateRisk(ctx({ positions: pos, today: atCap }), sell(200));
      expect(d.checks.find((c) => c.code === "daily-loss-cap")?.detail).toBe("Exits are always allowed: this sell reduces your position.");
    });
    it("still halts a sell while paused", () => {
      expect(evaluateRisk(ctx({ positions: pos, today: atCap, limits: { ...limits, tradingPaused: true } }), sell(200)).outcome).toBe("halted");
    });
    it("still blocks a buy at each limit", () => {
      for (const today of [atCap, inCooldown, atTradeLimit]) {
        expect(evaluateRisk(ctx({ positions: pos, today }), buy(100)).outcome).toBe("blocked");
      }
    });
    it("still blocks an oversell at a limit", () => {
      expect(evaluateRisk(ctx({ positions: pos, today: atCap }), sell(600)).outcome).toBe("blocked");
      expect(evaluateRisk(ctx({ today: atCap }), sell(10)).outcome).toBe("blocked");
    });
  });
  it("keeps the cooldown across midnight until it ends", () => {
    const streak = { tradesCount: 0, realizedPnlUsd: 0, consecutiveLosses: 2, lastLossAt: "2026-10-08T23:50:00Z" };
    expect(evaluateRisk(ctx({ today: streak, now: new Date("2026-10-09T00:05:00Z") }), buy(100)).reasons.join(" ")).toMatch(/cooldown/i);
    expect(evaluateRisk(ctx({ today: streak, now: new Date("2026-10-09T00:15:00Z") }), buy(100)).outcome).toBe("approved");
  });
});

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
});

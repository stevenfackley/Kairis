import { describe, expect, it } from "vitest";
import { buildPositions, dayStats, fillPaperOrder } from "@/lib/domain/paper";
import type { PaperTrade } from "@/lib/types";

const t = (o: Partial<PaperTrade>): PaperTrade => ({ id: "1", userId: "u", productId: "BTC-USD", side: "BUY", baseSize: 1, price: 100, quoteUsd: 100, status: "filled", realizedPnlUsd: 0, note: "", signalId: null, riskDecision: null, createdAt: "2026-10-09T10:00:00Z", ...o });

describe("buildPositions", () => {
  it("averages cost on buys and reduces on sells", () => {
    const p = buildPositions([t({ baseSize: 1, price: 100 }), t({ baseSize: 1, price: 200 }), t({ side: "SELL", baseSize: 1, price: 300 })], { "BTC-USD": 300 });
    expect(p["BTC-USD"]).toEqual({ baseSize: 1, avgCost: 150, notionalUsd: 300 });
  });
  it("drops flat positions and ignores blocked trades", () => {
    expect(buildPositions([t({}), t({ side: "SELL" }), t({ status: "blocked", baseSize: 5 })], {})).toEqual({});
  });
});

describe("fillPaperOrder", () => {
  it("fills a buy at the reference price", () => {
    const f = fillPaperOrder({ "BTC-USD": undefined }, { productId: "BTC-USD", side: "BUY", quoteUsd: 50, mode: "paper" }, 200);
    expect(f).toEqual({ baseSize: 0.25, price: 200, realizedPnlUsd: 0 });
  });
  it("realizes P&L on a sell against average cost", () => {
    const f = fillPaperOrder({ "BTC-USD": { baseSize: 2, avgCost: 100, notionalUsd: 300 } }, { productId: "BTC-USD", side: "SELL", quoteUsd: 150, mode: "paper" }, 150);
    expect(f.baseSize).toBeCloseTo(1, 10);
    expect(f.realizedPnlUsd).toBeCloseTo(50, 10);
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
});

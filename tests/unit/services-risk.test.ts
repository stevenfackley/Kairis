import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistedOrder, TradingLimits } from "@/lib/types";

const m = vi.hoisted(() => ({
  getLimits: vi.fn(),
  listPaperTrades: vi.fn(),
  listAssistedOrders: vi.fn(),
  appendAudit: vi.fn(),
  getMarketSnapshot: vi.fn(),
  getReferencePrices: vi.fn()
}));

vi.mock("@/lib/server/repos/limits", () => ({ getLimits: m.getLimits }));
vi.mock("@/lib/server/repos/paper", () => ({ listPaperTrades: m.listPaperTrades }));
vi.mock("@/lib/server/repos/assisted", () => ({ listAssistedOrders: m.listAssistedOrders }));
vi.mock("@/lib/server/repos/audit", () => ({ appendAudit: m.appendAudit }));
vi.mock("@/lib/server/services/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/services/market")>();
  return {
    ...actual,
    getMarketSnapshot: m.getMarketSnapshot,
    getReferencePrices: m.getReferencePrices,
    marketDataAgeMs: (s: { ticker: { tradeTime: number } }, nowMs: number) => nowMs - s.ticker.tradeTime
  };
});

import { buildRiskContext } from "@/lib/server/services/risk";

const USER = "user-1";
const limits: TradingLimits = {
  userId: USER,
  maxPositionUsd: 1500,
  dailyLossCapUsd: 300,
  maxTradesPerDay: 6,
  cooldownMinutes: 20,
  lossStreakTrigger: 2,
  perSymbolMaxUsd: {},
  tradingPaused: false,
  updatedAt: "2026-10-09T00:00:00.000Z"
};

function order(o: Partial<AssistedOrder>): AssistedOrder {
  const now = new Date().toISOString();
  return {
    id: "o",
    userId: USER,
    productId: "BTC-USD",
    side: "BUY",
    quoteUsd: 100,
    status: "filled",
    reconcileState: "reconciled",
    reconciledAt: now,
    provider: "coinbase",
    detail: "",
    orderId: "x",
    clientOrderId: "o",
    previewId: null,
    exchangeStatus: "FILLED",
    filledSize: 1,
    averagePrice: 100,
    totalFees: 0.6,
    signalId: null,
    riskDecision: null,
    createdAt: now,
    updatedAt: now,
    ...o
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.getLimits.mockResolvedValue(limits);
  m.listPaperTrades.mockResolvedValue([]);
  m.appendAudit.mockResolvedValue(undefined);
  m.getMarketSnapshot.mockImplementation(async (productId: string) => ({
    candles: [],
    ticker: { productId, price: 100, bestBid: 100, bestAsk: 100, tradeTime: Date.now() },
    fetchedAt: Date.now()
  }));
  m.getReferencePrices.mockResolvedValue({ "BTC-USD": 100 });
});

describe("buildRiskContext (live)", () => {
  it("charges the exchange-reported fees: buy fees into the cost basis, sell fees out of the proceeds", async () => {
    const t0 = new Date(Date.now() - 60_000).toISOString();
    m.listAssistedOrders.mockResolvedValue([
      order({ id: "sell", side: "SELL", filledSize: 1, averagePrice: 100, totalFees: 0.6 }),
      order({ id: "buy2", side: "BUY", filledSize: 1, averagePrice: 100, totalFees: 0.6, createdAt: t0 }),
      order({ id: "buy1", side: "BUY", filledSize: 1, averagePrice: 100, totalFees: 0.6, createdAt: t0.replace(/\.\d{3}Z$/, ".000Z") })
    ]);

    const ctx = await buildRiskContext(USER, "live", "BTC-USD");

    expect(ctx.positions["BTC-USD"]?.baseSize).toBeCloseTo(1, 10);
    expect(ctx.positions["BTC-USD"]?.avgCost).toBeCloseTo(100.6, 10);
    // A flat sell loses both fees: 100 - 0.60 - 100.60.
    expect(ctx.today.realizedPnlUsd).toBeCloseTo(-1.2, 10);
    expect(ctx.today.consecutiveLosses).toBe(1);
    expect(ctx.today.tradesCount).toBe(3);
  });

  it("treats an in-flight order with no reported fee as fee-free until it reconciles", async () => {
    m.listAssistedOrders.mockResolvedValue([order({ status: "submitted", filledSize: null, averagePrice: null, totalFees: null, quoteUsd: 50 })]);
    const ctx = await buildRiskContext(USER, "live", "BTC-USD");
    expect(ctx.positions["BTC-USD"]).toMatchObject({ baseSize: 0.5, avgCost: 100 });
  });
});

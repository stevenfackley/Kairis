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

  it("estimates an in-flight buy as Coinbase will fill it: the submitted quote includes the fee", async () => {
    const inFlight = { status: "submitted" as const, filledSize: null, averagePrice: null, totalFees: null };
    // The size submitted wins over the dollars on the row: $50 buys 50 / 1.006 / 100 = 0.49701789 BTC.
    m.listAssistedOrders.mockResolvedValue([order({ ...inFlight, quoteUsd: 50.004, orderSize: { kind: "quote", quoteSize: "50" } })]);
    const sized = await buildRiskContext(USER, "live", "BTC-USD");
    expect(sized.positions["BTC-USD"]?.baseSize).toBe(0.49701789);
    // The estimated fee is in the cost basis, so the basis is the $50 spent.
    expect(sized.positions["BTC-USD"]!.baseSize * sized.positions["BTC-USD"]!.avgCost).toBeCloseTo(50, 6);

    // Without a recorded size (rows from before sizes were stored), the order's dollars are used.
    m.listAssistedOrders.mockResolvedValue([order({ ...inFlight, quoteUsd: 50 })]);
    expect((await buildRiskContext(USER, "live", "BTC-USD")).positions["BTC-USD"]?.baseSize).toBe(0.49701789);
  });

  it("estimates an in-flight sell by the coins submitted, its fee off the proceeds", async () => {
    const t0 = new Date(Date.now() - 60_000).toISOString();
    m.listAssistedOrders.mockResolvedValue([
      order({ id: "buy", side: "BUY", filledSize: 1, averagePrice: 100, totalFees: 0.6, createdAt: t0 }),
      order({ id: "sell", side: "SELL", status: "submitted", filledSize: null, averagePrice: null, totalFees: null, quoteUsd: 40, orderSize: { kind: "base", baseSize: "0.4" } })
    ]);
    const ctx = await buildRiskContext(USER, "live", "BTC-USD");
    expect(ctx.positions["BTC-USD"]?.baseSize).toBeCloseTo(0.6, 10);
    // 0.4 * 100 - 0.24 estimated fee - 0.4 * 100.60 cost = -0.48.
    expect(ctx.today.realizedPnlUsd).toBeCloseTo(-0.48, 10);
  });

  it("charges what Coinbase reports once an order has filled, not the estimate", async () => {
    // A $100 buy as Coinbase fills it: 99.40357853 of coins and a 0.59642147 fee.
    m.listAssistedOrders.mockResolvedValue([order({ filledSize: 0.99403579, averagePrice: 100, totalFees: 0.59642147, orderSize: { kind: "quote", quoteSize: "100" } })]);
    const ctx = await buildRiskContext(USER, "live", "BTC-USD");
    expect(ctx.positions["BTC-USD"]?.baseSize).toBe(0.99403579);
    expect(ctx.positions["BTC-USD"]!.baseSize * ctx.positions["BTC-USD"]!.avgCost).toBeCloseTo(100, 6);
  });
});

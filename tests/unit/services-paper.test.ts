import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaperTrade, TradingLimits } from "@/lib/types";

const m = vi.hoisted(() => ({
  getLimits: vi.fn(),
  listPaperTrades: vi.fn(),
  insertPaperTrade: vi.fn(),
  listAssistedOrders: vi.fn(),
  appendAudit: vi.fn(),
  getMarketSnapshot: vi.fn(),
  getReferencePrices: vi.fn()
}));

vi.mock("@/lib/server/repos/limits", () => ({ getLimits: m.getLimits }));
vi.mock("@/lib/server/repos/paper", () => ({ listPaperTrades: m.listPaperTrades, insertPaperTrade: m.insertPaperTrade }));
vi.mock("@/lib/server/repos/assisted", () => ({ listAssistedOrders: m.listAssistedOrders }));
vi.mock("@/lib/server/repos/audit", () => ({ appendAudit: m.appendAudit }));
vi.mock("@/lib/server/services/market", () => ({
  getMarketSnapshot: m.getMarketSnapshot,
  getReferencePrices: m.getReferencePrices,
  marketDataAgeMs: (s: { ticker: { tradeTime: number } }, nowMs: number) => nowMs - s.ticker.tradeTime
}));

import { placePaperOrder } from "@/lib/server/services/paper";

const USER = "user-1";
const PRICE = 50000;

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

describe("placePaperOrder", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.getLimits.mockResolvedValue(limits);
    m.listPaperTrades.mockResolvedValue([]);
    m.listAssistedOrders.mockResolvedValue([]);
    m.appendAudit.mockResolvedValue(undefined);
    m.getMarketSnapshot.mockImplementation(async (productId: string) => ({
      candles: [],
      ticker: { productId, price: PRICE, bestBid: PRICE - 1, bestAsk: PRICE + 1, tradeTime: Date.now() },
      fetchedAt: Date.now()
    }));
    m.getReferencePrices.mockResolvedValue({ "BTC-USD": PRICE });
    m.insertPaperTrade.mockImplementation(async (t: PaperTrade) => ({ ...t, id: "trade-1", createdAt: "2026-10-09T12:00:00.000Z" }));
  });

  it("persists a blocked trade carrying the risk decision when risk fails, and audits it", async () => {
    const { trade, decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 5000 });

    expect(decision.outcome).toBe("blocked");
    expect(decision.checks.find((c) => c.code === "max-position")?.passed).toBe(false);
    expect(m.insertPaperTrade).toHaveBeenCalledTimes(1);
    const inserted = m.insertPaperTrade.mock.calls[0]![0] as PaperTrade;
    expect(inserted).toMatchObject({ id: "", createdAt: "", status: "blocked", baseSize: 0, price: PRICE, feeUsd: null, realizedPnlUsd: 0, quoteUsd: 5000 });
    expect(inserted.riskDecision).toEqual(decision);
    expect(inserted.note).toContain("max position");
    expect(trade.status).toBe("blocked");
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "risk", "blocked", expect.stringContaining("paper BUY BTC-USD $5000"));
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "paper-trade", "blocked", expect.stringContaining("max position"));
  });

  it("keeps a user note on a blocked trade", async () => {
    m.getLimits.mockResolvedValue({ ...limits, tradingPaused: true });
    const { trade, decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100, note: "  testing the pause  " });
    expect(decision.outcome).toBe("halted");
    expect(trade).toMatchObject({ status: "blocked", note: "testing the pause" });
  });

  it("fills an approved order at the reference price with the matching base size and a 0.6% taker fee", async () => {
    const { trade, decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100, signalId: "sig-1" });

    expect(decision.outcome).toBe("approved");
    expect(trade).toMatchObject({ status: "filled", price: PRICE, quoteUsd: 100, feeUsd: 0.6, realizedPnlUsd: 0, signalId: "sig-1", note: "" });
    expect(trade.baseSize).toBeCloseTo(0.002, 12);
    expect(trade.riskDecision).toEqual(decision);
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "paper-trade", "filled", expect.stringContaining("BUY 0.002 BTC-USD at $50000 ($100), fee $0.60"));
  });

  it("rejects a fill too large for the size column with a readable error before inserting", async () => {
    m.getLimits.mockResolvedValue({ ...limits, maxPositionUsd: 10_000_000 });
    m.getMarketSnapshot.mockImplementation(async (productId: string) => ({
      candles: [],
      ticker: { productId, price: 0.00001, bestBid: 0.00001, bestAsk: 0.00001, tradeTime: Date.now() },
      fetchedAt: Date.now()
    }));
    m.getReferencePrices.mockResolvedValue({ "BONK-USD": 0.00001 });

    await expect(placePaperOrder(USER, { productId: "BONK-USD", side: "BUY", quoteUsd: 1_000_000 })).rejects.toThrow(
      "This order is too large to record: 100,000,000,000 BONK is more than Kairis can store. Use a smaller order."
    );
    expect(m.insertPaperTrade).not.toHaveBeenCalled();
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "paper-trade", "rejected", expect.stringContaining("too large to record"));
  });

  it("realizes P&L on a sell against the average cost of earlier paper fills", async () => {
    m.listPaperTrades.mockResolvedValue([
      {
        id: "t0",
        userId: USER,
        productId: "BTC-USD",
        side: "BUY",
        baseSize: 0.01,
        price: 40000,
        quoteUsd: 400,
        feeUsd: null,
        status: "filled",
        realizedPnlUsd: 0,
        note: "",
        signalId: null,
        riskDecision: null,
        createdAt: "2026-10-01T10:00:00.000Z"
      }
    ] satisfies PaperTrade[]);

    const { trade, decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "SELL", quoteUsd: 250 });

    expect(decision.outcome).toBe("approved");
    expect(trade.baseSize).toBeCloseTo(0.005, 12);
    // The legacy buy carries no fee; the sell pays 0.6% of $250: 250 - 1.50 - 200 = 48.50.
    expect(trade.feeUsd).toBeCloseTo(1.5, 8);
    expect(trade.realizedPnlUsd).toBeCloseTo(48.5, 8);
  });
});

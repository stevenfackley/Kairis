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
import { UnknownProductError } from "@/lib/server/services/shared";

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
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "risk", "blocked", expect.stringContaining("paper BUY BTC-USD $5,000.00"));
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "paper-trade", "blocked", expect.stringContaining("max position"));
  });

  it("blocks (does not halt) a custom product Coinbase does not list", async () => {
    m.getMarketSnapshot.mockRejectedValue(new UnknownProductError("ZZZZ-USD"));
    const { trade, decision } = await placePaperOrder(USER, { productId: "ZZZZ-USD", side: "BUY", quoteUsd: 100 });
    expect(decision.outcome).toBe("blocked");
    expect(decision.reasons).toEqual(["ZZZZ-USD is not a tradable Coinbase pair."]);
    expect(decision.checks.find((c) => c.code === "provider-health")?.passed).toBe(true);
    expect(trade).toMatchObject({ status: "blocked", price: 0, note: "ZZZZ-USD is not a tradable Coinbase pair." });
  });

  it("halts as degraded when the market feed itself is down", async () => {
    m.getMarketSnapshot.mockRejectedValue(new Error("Coinbase public request failed (503): down"));
    const { decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100 });
    expect(decision.outcome).toBe("halted");
    expect(decision.reasons[0]).toBe("Exchange provider is degraded; execution is halted.");
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
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "paper-trade", "filled", "BUY 0.002 BTC-USD at $50,000.00 ($100.00), fee $0.60, realized $0.00.");
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

  it("sells the entire held position exactly, sized at the current price, leaving no dust", async () => {
    m.listPaperTrades.mockResolvedValue([
      {
        id: "t0",
        userId: USER,
        productId: "BTC-USD",
        side: "BUY",
        baseSize: 0.00123457,
        price: 40000,
        quoteUsd: 49.38,
        feeUsd: 0.29628,
        status: "filled",
        realizedPnlUsd: 0,
        note: "",
        signalId: null,
        riskDecision: null,
        createdAt: "2026-10-01T10:00:00.000Z"
      }
    ] satisfies PaperTrade[]);

    const { trade, decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "SELL", quoteUsd: 0, sellAll: true });

    expect(decision.outcome).toBe("approved");
    expect(trade).toMatchObject({ status: "filled", side: "SELL", baseSize: 0.00123457, quoteUsd: 61.73 });
    // 0.00123457 * 50000 = 61.7285 proceeds; fee 0.6% = 0.370371; cost 49.3828 + 0.29628 = 49.67908.
    expect(trade.feeUsd).toBeCloseTo(0.370371, 8);
    expect(trade.realizedPnlUsd).toBeCloseTo(61.7285 - 0.370371 - 49.67908, 6);
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "risk", "approved", expect.stringContaining("paper SELL BTC-USD $61.73 (entire position)"));
  });

  it("blocks selling an entire position that does not exist", async () => {
    const { trade, decision } = await placePaperOrder(USER, { productId: "ETH-USD", side: "SELL", quoteUsd: 0, sellAll: true });
    expect(decision.outcome).toBe("blocked");
    expect(decision.reasons).toEqual(["There is no position in ETH-USD to sell."]);
    expect(trade.status).toBe("blocked");
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

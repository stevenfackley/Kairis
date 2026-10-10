import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __setProductLoader, mapProduct } from "@/lib/exchange/coinbase-public";
import { ExchangeHttpError } from "@/lib/exchange/errors";
import type { ProductRules } from "@/lib/exchange/sizing";
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

// Captured from GET https://api.coinbase.com/api/v3/brokerage/market/products/{id} on 2026-10-10.
function fixture(name: string): ProductRules {
  return mapProduct(JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/coinbase", name), "utf8")));
}
const BTC_RULES = fixture("product-btc-usd.json");
const SHIB_RULES = fixture("product-shib-usd.json");
const SHIB_PRICE = 0.00000546;

/** BTC-USD's rules for every product unless a test swaps the loader. */
function useRules(overrides: Partial<ProductRules> = {}): void {
  __setProductLoader(async (productId) =>
    productId === "SHIB-USD" ? SHIB_RULES : { ...BTC_RULES, productId, baseCurrency: productId.split("-")[0]!, ...overrides }
  );
}

function filled(o: Partial<PaperTrade>): PaperTrade {
  return {
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
    createdAt: "2026-10-01T10:00:00.000Z",
    ...o
  };
}

function priceAt(prices: Record<string, number>): void {
  m.getMarketSnapshot.mockImplementation(async (productId: string) => {
    const price = prices[productId] ?? PRICE;
    return { candles: [], ticker: { productId, price, bestBid: price, bestAsk: price, tradeTime: Date.now() }, fetchedAt: Date.now() };
  });
  m.getReferencePrices.mockResolvedValue(prices);
}

afterAll(() => {
  __setProductLoader(null);
});

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
    useRules();
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

  it("fills an approved buy at the reference price, spending the quote with the 0.6% taker fee included", async () => {
    const { trade, decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100, signalId: "sig-1" });

    expect(decision.outcome).toBe("approved");
    // 100 / 1.006 = 99.40357853 buys 0.00198807 BTC at $50,000; the other 0.59642147 is the fee.
    expect(trade).toMatchObject({ status: "filled", price: PRICE, quoteUsd: 100, baseSize: 0.00198807, feeUsd: 0.59642147, realizedPnlUsd: 0, signalId: "sig-1", note: "" });
    expect(trade.riskDecision).toEqual(decision);
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "paper-trade", "filled", "BUY 0.00198807 BTC-USD at $50,000.00: spent $100.00 including a $0.60 fee.");
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
      // 1,000,000 / 1.006 of filled value at $0.00001.
      "This order is too large to record: 99,403,578,529 BONK is more than Kairis can store. Use a smaller order."
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

  describe("Coinbase product rules (the same sizing live orders get)", () => {
    const SHIB_HELD = filled({ productId: "SHIB-USD", baseSize: 18206777.07, price: 0.0000054, quoteUsd: 98.93, feeUsd: 0.58994 });

    it("floors a buy to the product's quote_increment and records the dollars actually spent", async () => {
      const { trade, decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100.759 });
      expect(decision.outcome).toBe("approved");
      // quote_increment 0.01: $100.75 is spent, fee included (100.75 / 1.006 = 100.14910537 of coins).
      expect(trade).toMatchObject({ status: "filled", quoteUsd: 100.75, baseSize: 0.00200298, feeUsd: 0.60089463 });
    });

    it("floors a sell to the product's base_increment", async () => {
      priceAt({ "SHIB-USD": SHIB_PRICE });
      m.listPaperTrades.mockResolvedValue([SHIB_HELD]);
      const { trade, decision } = await placePaperOrder(USER, { productId: "SHIB-USD", side: "SELL", quoteUsd: 50 });
      expect(decision.outcome).toBe("approved");
      // $50 at $0.00000546 is 9,157,509.16 SHIB; with a base_increment of 1 the sell is 9,157,509.
      expect(trade).toMatchObject({ status: "filled", side: "SELL", baseSize: 9157509, quoteUsd: 50 });
    });

    it("sells an entire position with a remainder below base_increment in full, leaving no dust", async () => {
      priceAt({ "SHIB-USD": SHIB_PRICE });
      m.listPaperTrades.mockResolvedValue([SHIB_HELD]);
      const { trade, decision } = await placePaperOrder(USER, { productId: "SHIB-USD", side: "SELL", quoteUsd: 0, sellAll: true });
      expect(decision.outcome).toBe("approved");
      // Floored to whole SHIB the sell would be 18,206,777 and strand 0.07 SHIB nobody could ever sell.
      expect(trade).toMatchObject({ status: "filled", baseSize: 18206777.07, feeUsd: 0.59645402 });
      expect(trade.realizedPnlUsd).toBeCloseTo(18206777.07 * SHIB_PRICE - 0.59645402 - (18206777.07 * 0.0000054 + 0.58994), 8);
    });

    it("blocks a buy below the product minimum with the message live shows", async () => {
      const { trade, decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 0.5 });
      expect(decision.outcome).toBe("blocked");
      expect(decision.reasons).toEqual(["The smallest BTC-USD buy Coinbase accepts is $1.00."]);
      expect(decision.checks).toContainEqual({ code: "exchange-rules", passed: false, detail: "The smallest BTC-USD buy Coinbase accepts is $1.00." });
      expect(trade).toMatchObject({ status: "blocked", baseSize: 0, feeUsd: null, note: "The smallest BTC-USD buy Coinbase accepts is $1.00." });
      expect(trade.riskDecision).toEqual(decision);
      expect(m.appendAudit).toHaveBeenCalledWith(USER, "paper-trade", "blocked", "BUY BTC-USD $0.50 blocked: The smallest BTC-USD buy Coinbase accepts is $1.00.");
    });

    it("blocks a sell below base_min_size", async () => {
      priceAt({ "SHIB-USD": SHIB_PRICE });
      m.listPaperTrades.mockResolvedValue([SHIB_HELD]);
      const { decision } = await placePaperOrder(USER, { productId: "SHIB-USD", side: "SELL", quoteUsd: 0.000004 });
      expect(decision).toMatchObject({ outcome: "blocked", reasons: ["This sell comes to 0 SHIB, below the 1 SHIB minimum Coinbase accepts for SHIB-USD."] });
    });

    it("blocks a buy above the product maximum", async () => {
      useRules({ quoteMaxSize: "1000" });
      const { decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 1200 });
      expect(decision).toMatchObject({ outcome: "blocked", reasons: ["The largest BTC-USD market buy Coinbase accepts is $1,000.00."] });
    });

    it.each<[Partial<ProductRules>, string]>([
      [{ isDisabled: true }, "BTC-USD is disabled for trading on Coinbase right now."],
      [{ cancelOnly: true }, "BTC-USD is in cancel-only mode on Coinbase: new orders are not accepted."],
      [{ limitOnly: true }, "BTC-USD accepts only limit orders on Coinbase right now, and Kairis places market orders."],
      [{ postOnly: true }, "BTC-USD accepts only post-only limit orders on Coinbase right now, and Kairis places market orders."],
      [{ status: "delisted" }, "Coinbase lists BTC-USD as \"delisted\", not online."]
    ])("blocks a product closed to market orders (%o) with the message live shows", async (overrides, reason) => {
      useRules(overrides);
      const { trade, decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100 });
      expect(decision).toMatchObject({ outcome: "blocked", reasons: [reason] });
      expect(trade).toMatchObject({ status: "blocked", baseSize: 0 });
    });

    it("halts, as live does, when the product rules cannot be loaded", async () => {
      __setProductLoader(async () => {
        throw new Error("Coinbase public request failed (503): down");
      });
      const { trade, decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100 });
      const reason = "Kairis could not load the BTC-USD trading rules from Coinbase: Coinbase public request failed (503): down";
      expect(decision).toMatchObject({ outcome: "halted", reasons: [reason] });
      expect(decision.checks).toContainEqual({ code: "exchange-rules", passed: false, detail: reason });
      expect(trade).toMatchObject({ status: "blocked", baseSize: 0, feeUsd: null });
      expect(m.appendAudit).toHaveBeenCalledWith(USER, "paper-trade", "blocked", `BUY BTC-USD $100.00 halted: ${reason}`);
    });

    it("blocks a product the Coinbase product endpoint does not list", async () => {
      __setProductLoader(async () => {
        throw new ExchangeHttpError(404, "Coinbase does not offer BTC-USD for trading (HTTP 404).", null);
      });
      const { decision } = await placePaperOrder(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100 });
      expect(decision).toMatchObject({ outcome: "blocked", reasons: ["BTC-USD is not a tradable Coinbase pair."] });
      expect(decision.checks).toContainEqual({ code: "tradable-product", passed: false, detail: "BTC-USD is not a tradable Coinbase pair." });
    });
  });
});

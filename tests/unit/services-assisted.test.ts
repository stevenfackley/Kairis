import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapProduct } from "@/lib/exchange/coinbase-public";
import { ExchangeTransportError, describeHttpFailure } from "@/lib/exchange/errors";
import { createMockClient } from "@/lib/exchange/mock";
import type { ExchangeClient, OrderPreview, OrderStatus, ProductRules } from "@/lib/exchange/types";
import type { AssistedOrder, TradingLimits } from "@/lib/types";

const m = vi.hoisted(() => ({
  getAssistedOrder: vi.fn(),
  claimPreviewedOrder: vi.fn(),
  releaseSubmitClaim: vi.fn(),
  updateAssistedOrder: vi.fn(),
  insertAssistedOrder: vi.fn(),
  listPendingAssistedOrders: vi.fn(),
  listAssistedOrders: vi.fn(),
  expireStalePreviews: vi.fn(),
  listPaperTrades: vi.fn(),
  getLimits: vi.fn(),
  appendAudit: vi.fn(),
  getMarketSnapshot: vi.fn(),
  getReferencePrices: vi.fn(),
  getReferencePrice: vi.fn(),
  getExchangeClient: vi.fn(),
  getConnectionStatus: vi.fn(),
  getProductRules: vi.fn()
}));

vi.mock("@/lib/exchange/coinbase-public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/exchange/coinbase-public")>()),
  getProductRules: m.getProductRules
}));

vi.mock("@/lib/server/repos/assisted", () => ({
  getAssistedOrder: m.getAssistedOrder,
  claimPreviewedOrder: m.claimPreviewedOrder,
  releaseSubmitClaim: m.releaseSubmitClaim,
  updateAssistedOrder: m.updateAssistedOrder,
  insertAssistedOrder: m.insertAssistedOrder,
  listPendingAssistedOrders: m.listPendingAssistedOrders,
  listAssistedOrders: m.listAssistedOrders,
  expireStalePreviews: m.expireStalePreviews
}));
vi.mock("@/lib/server/repos/paper", () => ({ listPaperTrades: m.listPaperTrades }));
vi.mock("@/lib/server/repos/limits", () => ({ getLimits: m.getLimits }));
vi.mock("@/lib/server/repos/audit", () => ({ appendAudit: m.appendAudit }));
vi.mock("@/lib/server/services/market", () => ({
  getMarketSnapshot: m.getMarketSnapshot,
  getReferencePrices: m.getReferencePrices,
  getReferencePrice: m.getReferencePrice,
  marketDataAgeMs: (s: { ticker: { tradeTime: number } }, nowMs: number) => nowMs - s.ticker.tradeTime
}));
vi.mock("@/lib/server/services/exchange-connection", () => ({
  getExchangeClient: m.getExchangeClient,
  getConnectionStatus: m.getConnectionStatus
}));

const USER = "user-1";
const PRICE = 50000;
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const LIVE_DISABLED = "Live assisted trading is disabled by environment policy (ENABLE_LIVE_ASSISTED_TRADING=false).";
// GET /api/v3/brokerage/market/products/BTC-USD as captured on 2026-10-10.
const BTC_RULES: ProductRules = mapProduct(JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/coinbase/product-btc-usd.json"), "utf8")));

function cleanPreview(overrides: Partial<OrderPreview> = {}): OrderPreview {
  return { previewId: "p1", orderTotal: 100, commissionTotal: 0.6, bestBid: PRICE - 1, bestAsk: PRICE + 1, baseSize: 0.002, quoteSize: 100, errors: [], warnings: [], ...overrides };
}

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

function order(overrides: Partial<AssistedOrder> = {}): AssistedOrder {
  const now = new Date().toISOString();
  return {
    id: ORDER_ID,
    userId: USER,
    productId: "BTC-USD",
    side: "BUY",
    quoteUsd: 100,
    status: "previewed",
    reconcileState: "pending",
    reconciledAt: null,
    provider: "mock",
    detail: "Preview total $100 with commission $0.6.",
    orderId: null,
    clientOrderId: null,
    previewId: "prev-1",
    exchangeStatus: null,
    filledSize: null,
    averagePrice: null,
    totalFees: null,
    signalId: null,
    riskDecision: null,
    orderSize: { kind: "quote", quoteSize: "100" },
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function fakeClient(provider: "coinbase" | "mock", overrides: Partial<ExchangeClient> = {}): ExchangeClient {
  return {
    provider,
    keyPermissions: vi.fn(),
    balances: vi.fn(),
    previewOrder: vi.fn(),
    createOrder: vi.fn(),
    getOrder: vi.fn(),
    findOrderByClientId: vi.fn(async () => null),
    ...overrides
  };
}

async function load(liveEnabled: boolean) {
  vi.stubEnv("ENABLE_LIVE_ASSISTED_TRADING", liveEnabled ? "true" : "false");
  vi.resetModules();
  const mod = await import("@/lib/server/services/assisted");
  mod.__setSettleDelayMs(0);
  return mod;
}

let current: AssistedOrder;
let claimed = false;

beforeEach(() => {
  vi.resetAllMocks();
  current = order();
  claimed = false;
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
  m.getReferencePrice.mockResolvedValue(PRICE);
  m.getProductRules.mockResolvedValue(BTC_RULES);
  m.expireStalePreviews.mockResolvedValue(0);
  m.getAssistedOrder.mockImplementation(async () => current);
  m.claimPreviewedOrder.mockImplementation(async () => {
    if (current.status !== "previewed" || claimed) {
      return null;
    }
    claimed = true;
    return current;
  });
  m.releaseSubmitClaim.mockImplementation(async () => {
    claimed = false;
  });
  m.updateAssistedOrder.mockImplementation(async (_id: string, patch: Partial<AssistedOrder>) => {
    current = { ...current, ...patch };
    return current;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("previewAssisted", () => {
  const NO_TRADE = "The connected Coinbase key has no trade permission. Create a trade-only key (no transfer permission) and reconnect.";

  beforeEach(() => {
    m.insertAssistedOrder.mockImplementation(async (o: AssistedOrder) => ({ ...o, id: ORDER_ID }));
  });

  it("blocks without calling the exchange when the connected key cannot trade", async () => {
    const { previewAssisted } = await load(true);
    const previewOrder = vi.fn();
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { previewOrder }));
    m.getConnectionStatus.mockResolvedValue({ canTrade: false });

    const result = await previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100 });

    expect(previewOrder).not.toHaveBeenCalled();
    expect(result.preview).toBeNull();
    expect(result.decision.outcome).toBe("blocked");
    expect(result.decision.checks).toContainEqual({ code: "exchange-key", passed: false, detail: NO_TRADE });
    expect(result.decision.reasons).toContain(NO_TRADE);
    expect(result.order).toMatchObject({ status: "blocked", reconcileState: "error", detail: NO_TRADE });
    expect(result.order.reconciledAt).not.toBeNull();
  });

  it("previews normally when the key can trade", async () => {
    const { previewAssisted } = await load(true);
    const previewOrder = vi.fn(async () => cleanPreview());
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { previewOrder }));
    m.getConnectionStatus.mockResolvedValue({ canTrade: true });

    const result = await previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100 });

    expect(previewOrder).toHaveBeenCalledWith({ productId: "BTC-USD", side: "BUY", size: { kind: "quote", quoteSize: "100" } });
    expect(result.order).toMatchObject({ status: "previewed", orderSize: { kind: "quote", quoteSize: "100" } });
    expect(result.order.detail).toBe("Previewed: spend $100.00, order total $100.00 including $0.60 commission.");
  });

  describe("sells", () => {
    // 0.01 BTC bought earlier through Kairis: a $500 position at the $50,000 mark.
    beforeEach(() => {
      m.listAssistedOrders.mockResolvedValue([
        order({ id: "held-1", status: "filled", side: "BUY", quoteUsd: 500, filledSize: 0.01, averagePrice: PRICE, createdAt: "2026-10-09T10:00:00.000Z" })
      ]);
      m.getConnectionStatus.mockResolvedValue({ canTrade: true });
    });

    it("sizes a SELL in base currency at the risk-check price, never with quote_size", async () => {
      const { previewAssisted } = await load(true);
      const previewOrder = vi.fn(async () => cleanPreview());
      const balances = vi.fn(async () => [{ currency: "BTC", available: 0.01 }]);
      m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { previewOrder, balances }));

      const result = await previewAssisted(USER, { productId: "BTC-USD", side: "SELL", quoteUsd: 100 });

      expect(previewOrder).toHaveBeenCalledWith({ productId: "BTC-USD", side: "SELL", size: { kind: "base", baseSize: "0.002" } });
      expect(result.order).toMatchObject({ status: "previewed", orderSize: { kind: "base", baseSize: "0.002" } });
      expect(result.order.detail).toContain("Previewed: sell 0.002 BTC");
    });

    it("sizes a live SELL down to the Coinbase balance when fees left slightly less than Kairis recorded", async () => {
      const { previewAssisted } = await load(true);
      const previewOrder = vi.fn(async () => cleanPreview());
      m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { previewOrder, balances: vi.fn(async () => [{ currency: "BTC", available: 0.00995 }]) }));

      const result = await previewAssisted(USER, { productId: "BTC-USD", side: "SELL", quoteUsd: 500 });

      expect(previewOrder).toHaveBeenCalledWith({ productId: "BTC-USD", side: "SELL", size: { kind: "base", baseSize: "0.00995" } });
      expect(result.order.detail).toContain("Sized down from 0.01 to the 0.00995 BTC available on Coinbase.");
    });

    it("closes the whole position by base size, not by a dollar amount", async () => {
      const { previewAssisted } = await load(true);
      const previewOrder = vi.fn(async () => cleanPreview());
      m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { previewOrder, balances: vi.fn(async () => [{ currency: "BTC", available: 0.01 }]) }));

      const result = await previewAssisted(USER, { productId: "BTC-USD", side: "SELL", quoteUsd: 0, closePosition: true });

      expect(previewOrder).toHaveBeenCalledWith({ productId: "BTC-USD", side: "SELL", size: { kind: "base", baseSize: "0.01" } });
      expect(result.decision.outcome).toBe("approved");
      expect(result.order).toMatchObject({ status: "previewed", side: "SELL", quoteUsd: 500, orderSize: { kind: "base", baseSize: "0.01" } });
      expect(result.order.detail).toContain("Closing the whole BTC-USD position.");
    });

    it("blocks closing a position Kairis has no record of", async () => {
      const { previewAssisted } = await load(true);
      m.listAssistedOrders.mockResolvedValue([]);
      const previewOrder = vi.fn();
      m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { previewOrder }));

      const result = await previewAssisted(USER, { productId: "BTC-USD", side: "SELL", quoteUsd: 0, closePosition: true });

      expect(previewOrder).not.toHaveBeenCalled();
      expect(result.order.status).toBe("blocked");
      expect(result.decision.reasons).toContain("There is no position in BTC-USD to sell.");
    });

    it("values a base-sized sell at the current price when limits are re-checked at submit", async () => {
      const { submitAssisted } = await load(true);
      // Previewed at $500 for 0.01 BTC; the price has since fallen 2%, so $500 now exceeds the $490 held.
      current = order({ provider: "coinbase", side: "SELL", quoteUsd: 500, orderSize: { kind: "base", baseSize: "0.01" } });
      m.getReferencePrices.mockResolvedValue({ "BTC-USD": 49000 });
      m.getReferencePrice.mockResolvedValue(49000);
      m.getMarketSnapshot.mockImplementation(async (productId: string) => ({
        candles: [],
        ticker: { productId, price: 49000, bestBid: 48999, bestAsk: 49001, tradeTime: Date.now() },
        fetchedAt: Date.now()
      }));
      const createOrder = vi.fn(async () => ({ success: true, orderId: "cb-close", clientOrderId: ORDER_ID, failureReason: null, detail: "Coinbase accepted the order." }));
      m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder }));

      const result = await submitAssisted(USER, ORDER_ID);

      expect(result).toMatchObject({ status: "submitted", orderId: "cb-close" });
      expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ size: { kind: "base", baseSize: "0.01" } }));
    });

    it("blocks a live SELL Coinbase cannot cover without calling preview", async () => {
      const { previewAssisted } = await load(true);
      const previewOrder = vi.fn();
      m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { previewOrder, balances: vi.fn(async () => [{ currency: "USD", available: 5 }]) }));

      const result = await previewAssisted(USER, { productId: "BTC-USD", side: "SELL", quoteUsd: 100 });

      expect(previewOrder).not.toHaveBeenCalled();
      expect(result.order).toMatchObject({ status: "blocked" });
      expect(result.order.detail).toBe("Coinbase shows 0 BTC available (about $0.00), less than the 0.002 BTC this sell needs.");
      expect(result.decision.checks).toContainEqual({ code: "exchange-rules", passed: false, detail: result.order.detail });
    });
  });

  it("blocks below the product minimum and for products closed to market orders, without calling preview", async () => {
    const { previewAssisted } = await load(true);
    const previewOrder = vi.fn();
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { previewOrder }));
    m.getConnectionStatus.mockResolvedValue({ canTrade: true });

    const small = await previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 0.5 });
    expect(small.order).toMatchObject({ status: "blocked", detail: "The smallest BTC-USD buy Coinbase accepts is $1.00." });
    expect(small.decision.outcome).toBe("blocked");

    m.getProductRules.mockResolvedValue({ ...BTC_RULES, cancelOnly: true });
    const closed = await previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100 });
    expect(closed.order.detail).toBe("BTC-USD is in cancel-only mode on Coinbase: new orders are not accepted.");
    expect(previewOrder).not.toHaveBeenCalled();
  });

  it("marks the order blocked, not previewed, when the Coinbase preview lists errs", async () => {
    const { previewAssisted } = await load(true);
    const err = "Not enough funds in the Coinbase account for this order. (PREVIEW_INSUFFICIENT_FUND)";
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { previewOrder: vi.fn(async () => cleanPreview({ errors: [err] })) }));
    m.getConnectionStatus.mockResolvedValue({ canTrade: true });

    const result = await previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100 });

    expect(result.preview).toBeNull();
    expect(result.order).toMatchObject({ status: "blocked", reconcileState: "error", detail: `Coinbase would reject this order: ${err}` });
    expect(result.decision).toMatchObject({ outcome: "blocked" });
    expect(result.decision.checks).toContainEqual({ code: "exchange-preview", passed: false, detail: `Coinbase would reject this order: ${err}` });
  });

  it("explains a failure to load the product rules", async () => {
    const { previewAssisted } = await load(true);
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase"));
    m.getConnectionStatus.mockResolvedValue({ canTrade: true });
    m.getProductRules.mockRejectedValue(new Error("Coinbase public request failed (503): down"));

    await expect(previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100 })).rejects.toThrow(
      "Kairis could not load the BTC-USD trading rules from Coinbase: Coinbase public request failed (503): down"
    );
    expect(m.insertAssistedOrder).not.toHaveBeenCalled();
  });

  it("gives mock users the same product-rule blocks", async () => {
    const { previewAssisted } = await load(false);
    m.getExchangeClient.mockResolvedValue(createMockClient(async () => PRICE, () => "mock-p", async () => BTC_RULES));
    const result = await previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 0.5 });
    expect(result.order).toMatchObject({ status: "blocked", provider: "mock", detail: "The smallest BTC-USD buy Coinbase accepts is $1.00." });
  });
});

describe("submitAssisted", () => {
  it("throws when the order does not exist", async () => {
    const { submitAssisted } = await load(false);
    m.claimPreviewedOrder.mockResolvedValue(null);
    m.getAssistedOrder.mockResolvedValue(null);
    await expect(submitAssisted(USER, ORDER_ID)).rejects.toThrow("Order not found.");
  });

  it("refuses an order another caller already claimed", async () => {
    const { submitAssisted } = await load(true);
    claimed = true;
    await expect(submitAssisted(USER, ORDER_ID)).rejects.toThrow("This order is already being submitted.");
    expect(m.updateAssistedOrder).not.toHaveBeenCalled();
    expect(m.getExchangeClient).not.toHaveBeenCalled();
  });

  it("refuses an order that is not in the previewed state", async () => {
    const { submitAssisted } = await load(true);
    current = order({ status: "submitted", orderId: "ex-1" });
    await expect(submitAssisted(USER, ORDER_ID)).rejects.toThrow("Only a previewed order can be submitted.");
    expect(m.updateAssistedOrder).not.toHaveBeenCalled();
    expect(m.getExchangeClient).not.toHaveBeenCalled();
  });

  it("expires a preview older than two minutes", async () => {
    const { submitAssisted } = await load(true);
    current = order({ createdAt: new Date(Date.now() - 3 * 60_000).toISOString() });
    await expect(submitAssisted(USER, ORDER_ID)).rejects.toThrow("Preview expired after 2 minutes; preview again.");
    expect(m.updateAssistedOrder).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ status: "expired", reconcileState: "reconciled", detail: "Preview expired after 2 minutes; preview again." })
    );
    expect(current.reconciledAt).not.toBeNull();
    expect(m.getExchangeClient).not.toHaveBeenCalled();
  });

  it("blocks a Coinbase submit when live assisted trading is disabled", async () => {
    const { submitAssisted } = await load(false);
    current = order({ provider: "coinbase" });
    const client = fakeClient("coinbase");
    m.getExchangeClient.mockResolvedValue(client);

    const result = await submitAssisted(USER, ORDER_ID);

    expect(result).toMatchObject({ status: "blocked", reconcileState: "error", detail: LIVE_DISABLED });
    expect(result.reconciledAt).not.toBeNull();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "assisted-order", "blocked", expect.stringContaining(LIVE_DISABLED));
  });

  it("submits through the mock client even when live assisted trading is disabled", async () => {
    const { submitAssisted } = await load(false);
    m.getExchangeClient.mockResolvedValue(createMockClient(async () => PRICE, () => "mock-order-1"));

    const result = await submitAssisted(USER, ORDER_ID);

    expect(result).toMatchObject({ status: "submitted", orderId: "mock-order-1", clientOrderId: ORDER_ID, reconcileState: "pending", reconciledAt: null });
    expect(result.riskDecision?.outcome).toBe("approved");
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "assisted-order", "submitted", expect.stringContaining("BUY BTC-USD $100"));
  });

  it("sends the order id as client_order_id with the preview id when live trading is enabled", async () => {
    const { submitAssisted } = await load(true);
    current = order({ provider: "coinbase" });
    const createOrder = vi.fn(async () => ({ success: true, orderId: "cb-1", clientOrderId: ORDER_ID, failureReason: null, detail: "Coinbase accepted the order." }));
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder }));

    const result = await submitAssisted(USER, ORDER_ID);

    expect(createOrder).toHaveBeenCalledWith({ productId: "BTC-USD", side: "BUY", size: { kind: "quote", quoteSize: "100" }, clientOrderId: ORDER_ID, previewId: "prev-1" });
    expect(result).toMatchObject({ status: "submitted", orderId: "cb-1" });
  });

  it("submits a SELL with the exact base size stored at preview", async () => {
    const { submitAssisted } = await load(true);
    m.listAssistedOrders.mockResolvedValue([order({ id: "held-1", status: "filled", quoteUsd: 500, filledSize: 0.01, averagePrice: PRICE, createdAt: "2026-10-09T10:00:00.000Z" })]);
    current = order({ provider: "coinbase", side: "SELL", orderSize: { kind: "base", baseSize: "0.00199999" } });
    const createOrder = vi.fn(async () => ({ success: true, orderId: "cb-2", clientOrderId: ORDER_ID, failureReason: null, detail: "Coinbase accepted the order." }));
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder }));

    await submitAssisted(USER, ORDER_ID);

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ side: "SELL", size: { kind: "base", baseSize: "0.00199999" } }));
  });

  it("blocks a preview with no recorded size instead of guessing one", async () => {
    const { submitAssisted } = await load(true);
    current = order({ provider: "coinbase", orderSize: null });
    const client = fakeClient("coinbase");
    m.getExchangeClient.mockResolvedValue(client);

    const result = await submitAssisted(USER, ORDER_ID);

    expect(result).toMatchObject({ status: "blocked", detail: "This preview has no recorded order size; preview again." });
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it("blocks when the risk re-check fails at submit time", async () => {
    const { submitAssisted } = await load(true);
    m.getLimits.mockResolvedValue({ ...limits, tradingPaused: true });

    const result = await submitAssisted(USER, ORDER_ID);

    expect(result).toMatchObject({ status: "blocked", detail: "Trading is paused by the global kill switch." });
    expect(m.getExchangeClient).not.toHaveBeenCalled();
  });

  it("marks the order failed when Coinbase definitely refused the request", async () => {
    const { submitAssisted } = await load(true);
    current = order({ provider: "coinbase" });
    const createOrder = vi.fn(async () => {
      throw describeHttpFailure(400, JSON.stringify({ error: "INVALID_ARGUMENT", message: "invalid product_id" }));
    });
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder }));

    const result = await submitAssisted(USER, ORDER_ID);

    expect(result).toMatchObject({ status: "failed", reconcileState: "error", detail: "Coinbase rejected the request (HTTP 400): invalid product_id." });
    expect(m.releaseSubmitClaim).not.toHaveBeenCalled();
  });

  it("records a Coinbase rejection with its reason in words", async () => {
    const { submitAssisted } = await load(true);
    current = order({ provider: "coinbase" });
    const detail = "Coinbase rejected the order. Not enough funds in the Coinbase account for this order. (INSUFFICIENT_FUND)";
    const createOrder = vi.fn(async () => ({ success: false, orderId: null, clientOrderId: ORDER_ID, failureReason: "INSUFFICIENT_FUND", detail }));
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder }));

    expect(await submitAssisted(USER, ORDER_ID)).toMatchObject({ status: "failed", orderId: null, detail });
  });

  it("settles an IOC fill right after submit instead of leaving the order 'submitted'", async () => {
    const { submitAssisted, settleAssisted } = await load(true);
    current = order({ provider: "coinbase" });
    const createOrder = vi.fn(async () => ({ success: true, orderId: "cb-9", clientOrderId: ORDER_ID, failureReason: null, detail: "Coinbase accepted the order." }));
    const getOrder = vi.fn(async (): Promise<OrderStatus> => ({ orderId: "cb-9", status: "FILLED", filledSize: 0.00198807, averagePrice: 50000, totalFees: 0.59642147, raw: "FILLED" }));
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder, getOrder }));

    const submitted = await submitAssisted(USER, ORDER_ID);
    expect(submitted).toMatchObject({ status: "submitted", orderId: "cb-9" });
    expect(getOrder).not.toHaveBeenCalled();
    const result = await settleAssisted(USER, submitted);

    expect(getOrder).toHaveBeenCalledWith("cb-9");
    expect(result).toMatchObject({ status: "filled", orderId: "cb-9", reconcileState: "reconciled", filledSize: 0.00198807, totalFees: 0.59642147 });
    expect(result.detail).toBe("Filled 0.00198807 BTC at an average $50,000.00, fees $0.60.");
    const actions = m.appendAudit.mock.calls.filter((c) => c[1] === "assisted-order").map((c) => c[2]);
    expect(actions).toEqual(["submitted", "filled"]);
  });

  it("leaves the order submitted when Coinbase has not reported the fill yet", async () => {
    const { submitAssisted, settleAssisted } = await load(true);
    current = order({ provider: "coinbase" });
    const createOrder = vi.fn(async () => ({ success: true, orderId: "cb-10", clientOrderId: ORDER_ID, failureReason: null, detail: "Coinbase accepted the order." }));
    const getOrder = vi.fn(async (): Promise<OrderStatus> => ({ orderId: "cb-10", status: "PENDING", filledSize: 0, averagePrice: null, totalFees: 0, raw: "PENDING" }));
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder, getOrder }));

    const result = await settleAssisted(USER, await submitAssisted(USER, ORDER_ID));

    expect(getOrder).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "submitted", orderId: "cb-10", reconcileState: "pending", exchangeStatus: "PENDING" });
  });

  it("keeps a timed-out submit as unconfirmed and finds it by client order id", async () => {
    const { submitAssisted, settleAssisted } = await load(true);
    current = order({ provider: "coinbase" });
    const createOrder = vi.fn(async () => {
      throw new ExchangeTransportError("timeout", "Coinbase did not answer within 10 s.");
    });
    const findOrderByClientId = vi.fn(async (): Promise<OrderStatus> => ({ orderId: "cb-11", status: "FILLED", filledSize: 0.002, averagePrice: 50000, totalFees: 0.6, raw: "FILLED" }));
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder, findOrderByClientId }));

    const unconfirmed = await submitAssisted(USER, ORDER_ID);
    expect(unconfirmed).toMatchObject({ status: "submitted", orderId: null, reconcileState: "pending" });
    const result = await settleAssisted(USER, unconfirmed);

    expect(findOrderByClientId).toHaveBeenCalledWith(expect.objectContaining({ clientOrderId: ORDER_ID, productId: "BTC-USD", side: "BUY" }));
    expect(result).toMatchObject({ status: "filled", orderId: "cb-11", clientOrderId: ORDER_ID });
    expect(createOrder).toHaveBeenCalledOnce();
  });

  it("never marks an unanswered submit failed: it stays submitted, counted as exposure, for reconcile to resolve", async () => {
    const { submitAssisted } = await load(true);
    current = order({ provider: "coinbase" });
    const createOrder = vi.fn(async () => {
      throw describeHttpFailure(503, "");
    });
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder }));

    const result = await submitAssisted(USER, ORDER_ID);

    expect(result).toMatchObject({ status: "submitted", orderId: null, clientOrderId: ORDER_ID, reconcileState: "pending" });
    expect(result.detail).toBe(
      "Coinbase did not confirm the order (Coinbase is not responding normally (HTTP 503).) It may have been placed; Reconcile looks it up by its client order id."
    );
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "assisted-order", "unconfirmed", expect.any(String));
  });

  it("treats DUPLICATE_CLIENT_ORDER_ID as an order already placed and looks it up", async () => {
    const { submitAssisted, settleAssisted } = await load(true);
    current = order({ provider: "coinbase" });
    const createOrder = vi.fn(async () => ({ success: false, orderId: null, clientOrderId: ORDER_ID, failureReason: "DUPLICATE_CLIENT_ORDER_ID", detail: "x" }));
    const findOrderByClientId = vi.fn(async (): Promise<OrderStatus> => ({ orderId: "cb-12", status: "FILLED", filledSize: 0.002, averagePrice: 50000, totalFees: 0.6, raw: "FILLED" }));
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder, findOrderByClientId }));

    expect(await settleAssisted(USER, await submitAssisted(USER, ORDER_ID))).toMatchObject({ status: "filled", orderId: "cb-12" });
  });

  it("settleAssisted leaves anything but a pending submitted order alone and never throws", async () => {
    const { settleAssisted } = await load(true);
    const blocked = order({ status: "blocked" });
    expect(await settleAssisted(USER, blocked)).toBe(blocked);
    m.getExchangeClient.mockRejectedValue(new Error("decrypt failed"));
    const pending = order({ status: "submitted", provider: "coinbase", orderId: "cb-x" });
    expect(await settleAssisted(USER, pending)).toBe(pending);
  });

  it("releases the claim when the risk check throws before the exchange, so the order can be resubmitted", async () => {
    const { submitAssisted } = await load(false);
    // A fresh client order id: the mock, like Coinbase, answers a repeated one with the existing order.
    current = order({ id: "22222222-2222-4222-8222-222222222222" });
    m.getLimits.mockRejectedValueOnce(new Error("db down"));
    m.getExchangeClient.mockResolvedValue(createMockClient(async () => PRICE, () => "mock-order-2"));

    await expect(submitAssisted(USER, ORDER_ID)).rejects.toThrow("db down");
    expect(m.releaseSubmitClaim).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", USER);
    expect(current.status).toBe("previewed");

    const retry = await submitAssisted(USER, ORDER_ID);
    expect(retry).toMatchObject({ status: "submitted", orderId: "mock-order-2" });
  });
});

describe("reconcileAssisted", () => {
  const statuses: Record<string, OrderStatus> = {
    "o-filled": { orderId: "o-filled", status: "FILLED", filledSize: 0.002, averagePrice: PRICE, totalFees: 0.6, raw: "FILLED" },
    "o-cancelled": { orderId: "o-cancelled", status: "CANCELLED", filledSize: 0, averagePrice: null, totalFees: 0, raw: "CANCELLED" },
    "o-open": { orderId: "o-open", status: "OPEN", filledSize: 0, averagePrice: null, totalFees: 0, raw: "OPEN" },
    "o-unknown": { orderId: "o-unknown", status: "UNKNOWN", filledSize: null, averagePrice: null, totalFees: null, raw: "WEIRD" },
    "o-partial": { orderId: "o-partial", status: "CANCELLED", filledSize: 0.0012, averagePrice: 50010.5, totalFees: 0.36, raw: "CANCELLED" },
    "o-failed": { orderId: "o-failed", status: "FAILED", filledSize: 0, averagePrice: null, totalFees: 0, raw: "FAILED", message: "Insufficient balance" }
  };

  function pending(orderId: string): AssistedOrder {
    return order({ id: `id-${orderId}`, orderId, status: "submitted", provider: "coinbase", clientOrderId: `id-${orderId}` });
  }

  it("maps FILLED, partial fills, CANCELLED, FAILED, OPEN and unknown exchange statuses", async () => {
    const { reconcileAssisted } = await load(true);
    m.listPendingAssistedOrders.mockResolvedValue(Object.keys(statuses).map(pending));
    const getOrder = vi.fn(async (orderId: string) => statuses[orderId]!);
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { getOrder }));
    m.updateAssistedOrder.mockImplementation(async (id: string, patch: Partial<AssistedOrder>) => ({ ...order({ id }), ...patch }));

    const result = await reconcileAssisted(USER);

    expect(result).toEqual({ checked: 6, updated: 4 });
    const patchFor = (id: string) => m.updateAssistedOrder.mock.calls.find((c) => c[0] === id)?.[1];
    expect(patchFor("id-o-filled")).toMatchObject({
      status: "filled",
      reconcileState: "reconciled",
      filledSize: 0.002,
      averagePrice: PRICE,
      totalFees: 0.6,
      exchangeStatus: "FILLED",
      detail: "Filled 0.002 BTC at an average $50,000.00, fees $0.60."
    });
    // An IOC order Coinbase cancelled after a partial fill moved real money: it is a fill, not a zero.
    expect(patchFor("id-o-partial")).toMatchObject({
      status: "filled",
      reconcileState: "reconciled",
      filledSize: 0.0012,
      averagePrice: 50010.5,
      exchangeStatus: "CANCELLED",
      detail: "Partially filled 0.0012 BTC at an average $50,010.50, fees $0.36; Coinbase reported CANCELLED for the rest."
    });
    expect(patchFor("id-o-cancelled")).toMatchObject({ status: "cancelled", reconcileState: "reconciled", exchangeStatus: "CANCELLED", detail: "Coinbase reported CANCELLED; nothing was filled." });
    expect(patchFor("id-o-failed")).toMatchObject({ status: "failed", detail: "Coinbase reported FAILED; nothing was filled. Coinbase says: Insufficient balance." });
    expect(patchFor("id-o-open")).toEqual({ exchangeStatus: "OPEN" });
    // An unrecognised status stays queued for the next pass instead of dropping out as an error.
    expect(patchFor("id-o-unknown")).toEqual({ exchangeStatus: "WEIRD", detail: "Coinbase reported status WEIRD; reconcile again shortly." });
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "operations", "reconcile-assisted-orders", "Checked 6, updated 4.");
  });

  it("writes fill sizes and sub-dollar prices through the shared formatters", async () => {
    const { reconcileAssisted } = await load(true);
    const fills: Record<string, OrderStatus> = {
      "o-shib": { orderId: "o-shib", status: "FILLED", filledSize: 18205783.61333829, averagePrice: 0.00000546, totalFees: 0.59642147, raw: "FILLED" },
      "o-half": { orderId: "o-half", status: "FILLED", filledSize: 10, averagePrice: 0.5, totalFees: 0.03, raw: "FILLED" }
    };
    m.listPendingAssistedOrders.mockResolvedValue(Object.keys(fills).map((id) => ({ ...pending(id), productId: id === "o-shib" ? "SHIB-USD" : "DOGE-USD" })));
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { getOrder: vi.fn(async (orderId: string) => fills[orderId]!) }));
    m.updateAssistedOrder.mockImplementation(async (id: string, patch: Partial<AssistedOrder>) => ({ ...order({ id }), ...patch }));

    await reconcileAssisted(USER);

    const detailFor = (id: string) => (m.updateAssistedOrder.mock.calls.find((c) => c[0] === id)?.[1] as Partial<AssistedOrder>).detail;
    expect(detailFor("id-o-shib")).toBe("Filled 18,205,783.61333829 SHIB at an average $0.00000546, fees $0.60.");
    expect(detailFor("id-o-half")).toBe("Filled 10 DOGE at an average $0.50, fees $0.03.");
  });

  it("expires previews abandoned for more than 2 minutes on every reconcile and preview", async () => {
    const { reconcileAssisted, previewAssisted } = await load(true);
    m.listPendingAssistedOrders.mockResolvedValue([]);
    m.expireStalePreviews.mockResolvedValue(2);

    await reconcileAssisted(USER);
    const [userId, cutoff, detail] = m.expireStalePreviews.mock.calls[0]!;
    expect(userId).toBe(USER);
    expect(Date.now() - Date.parse(cutoff as string)).toBeGreaterThanOrEqual(120_000);
    expect(detail).toBe("Preview expired after 2 minutes without a submit; nothing was sent.");

    m.insertAssistedOrder.mockImplementation(async (o: AssistedOrder) => ({ ...o, id: ORDER_ID }));
    m.getExchangeClient.mockResolvedValue(createMockClient(async () => PRICE, () => "mock-x", async () => BTC_RULES));
    await previewAssisted(USER, { productId: "BTC-USD", side: "BUY", quoteUsd: 100 });
    expect(m.expireStalePreviews).toHaveBeenCalledTimes(2);
  });

  it("finds an unconfirmed order by client order id, and gives up after 10 minutes without a trace", async () => {
    const { reconcileAssisted } = await load(true);
    const recent = order({ id: "id-recent", orderId: null, status: "submitted", provider: "coinbase", clientOrderId: "id-recent" });
    const stale = order({ id: "id-stale", orderId: null, status: "submitted", provider: "coinbase", clientOrderId: "id-stale", createdAt: new Date(Date.now() - 11 * 60_000).toISOString() });
    const found = order({ id: "id-found", orderId: null, status: "submitted", provider: "coinbase", clientOrderId: "id-found" });
    m.listPendingAssistedOrders.mockResolvedValue([recent, stale, found]);
    const findOrderByClientId = vi.fn(async ({ clientOrderId }: { clientOrderId: string }): Promise<OrderStatus | null> =>
      clientOrderId === "id-found" ? { orderId: "cb-found", status: "FILLED", filledSize: 0.002, averagePrice: PRICE, totalFees: 0.6, raw: "FILLED" } : null
    );
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { findOrderByClientId }));
    m.updateAssistedOrder.mockImplementation(async (id: string, patch: Partial<AssistedOrder>) => ({ ...order({ id }), ...patch }));

    const result = await reconcileAssisted(USER);

    expect(result).toEqual({ checked: 3, updated: 2 });
    const patchFor = (id: string) => m.updateAssistedOrder.mock.calls.find((c) => c[0] === id)?.[1];
    expect(patchFor("id-found")).toMatchObject({ orderId: "cb-found", status: "filled" });
    expect(patchFor("id-stale")).toMatchObject({
      status: "failed",
      reconcileState: "reconciled",
      detail: "Coinbase has no order with this client order id 10 minutes on, so it was never placed."
    });
    expect(patchFor("id-recent")).toEqual({ detail: "Coinbase has no order with this client order id yet; reconcile again in a minute." });
  });

  it("keeps an order queued on a retriable error and marks it errored otherwise", async () => {
    const { reconcileAssisted } = await load(true);
    m.listPendingAssistedOrders.mockResolvedValue([pending("o-503"), pending("o-404")]);
    const getOrder = vi.fn(async (orderId: string): Promise<OrderStatus> => {
      throw new Error(orderId === "o-503" ? "Coinbase request failed (503): busy" : "Coinbase request failed (404): not found");
    });
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { getOrder }));
    m.updateAssistedOrder.mockImplementation(async (id: string, patch: Partial<AssistedOrder>) => ({ ...order({ id }), ...patch }));

    const result = await reconcileAssisted(USER);

    expect(result).toEqual({ checked: 2, updated: 1 });
    expect(m.updateAssistedOrder).toHaveBeenCalledWith("id-o-503", { detail: "Reconcile will retry: Coinbase request failed (503): busy" });
    expect(m.updateAssistedOrder).toHaveBeenCalledWith(
      "id-o-404",
      expect.objectContaining({ reconcileState: "error", detail: "Coinbase request failed (404): not found" })
    );
  });
});

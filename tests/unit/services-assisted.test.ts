import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockClient } from "@/lib/exchange/mock";
import type { ExchangeClient, OrderStatus } from "@/lib/exchange/types";
import type { AssistedOrder, TradingLimits } from "@/lib/types";

const m = vi.hoisted(() => ({
  getAssistedOrder: vi.fn(),
  updateAssistedOrder: vi.fn(),
  insertAssistedOrder: vi.fn(),
  listPendingAssistedOrders: vi.fn(),
  listAssistedOrders: vi.fn(),
  listPaperTrades: vi.fn(),
  getLimits: vi.fn(),
  appendAudit: vi.fn(),
  getMarketSnapshot: vi.fn(),
  getReferencePrices: vi.fn(),
  getReferencePrice: vi.fn(),
  getExchangeClient: vi.fn()
}));

vi.mock("@/lib/server/repos/assisted", () => ({
  getAssistedOrder: m.getAssistedOrder,
  updateAssistedOrder: m.updateAssistedOrder,
  insertAssistedOrder: m.insertAssistedOrder,
  listPendingAssistedOrders: m.listPendingAssistedOrders,
  listAssistedOrders: m.listAssistedOrders
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
vi.mock("@/lib/server/services/exchange-connection", () => ({ getExchangeClient: m.getExchangeClient }));

const USER = "user-1";
const PRICE = 50000;
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const LIVE_DISABLED = "Live assisted trading is disabled by environment policy (ENABLE_LIVE_ASSISTED_TRADING=false).";

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
    ...overrides
  };
}

async function load(liveEnabled: boolean) {
  vi.stubEnv("ENABLE_LIVE_ASSISTED_TRADING", liveEnabled ? "true" : "false");
  vi.resetModules();
  return import("@/lib/server/services/assisted");
}

let current: AssistedOrder;

beforeEach(() => {
  vi.resetAllMocks();
  current = order();
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
  m.getAssistedOrder.mockImplementation(async () => current);
  m.updateAssistedOrder.mockImplementation(async (_id: string, patch: Partial<AssistedOrder>) => {
    current = { ...current, ...patch };
    return current;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("submitAssisted", () => {
  it("throws when the order does not exist", async () => {
    const { submitAssisted } = await load(false);
    m.getAssistedOrder.mockResolvedValue(null);
    await expect(submitAssisted(USER, ORDER_ID)).rejects.toThrow("Order not found.");
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
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "assisted-order", "submitted", expect.stringContaining("BUY BTC-USD $100"));
  });

  it("sends the order id as client_order_id with the preview id when live trading is enabled", async () => {
    const { submitAssisted } = await load(true);
    current = order({ provider: "coinbase" });
    const createOrder = vi.fn(async () => ({ success: true, orderId: "cb-1", clientOrderId: ORDER_ID, detail: "Coinbase accepted the order." }));
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder }));

    const result = await submitAssisted(USER, ORDER_ID);

    expect(createOrder).toHaveBeenCalledWith({ productId: "BTC-USD", side: "BUY", quoteUsd: 100, clientOrderId: ORDER_ID, previewId: "prev-1" });
    expect(result).toMatchObject({ status: "submitted", orderId: "cb-1" });
  });

  it("blocks when the risk re-check fails at submit time", async () => {
    const { submitAssisted } = await load(true);
    m.getLimits.mockResolvedValue({ ...limits, tradingPaused: true });

    const result = await submitAssisted(USER, ORDER_ID);

    expect(result).toMatchObject({ status: "blocked", detail: "Trading is paused by the global kill switch." });
    expect(m.getExchangeClient).not.toHaveBeenCalled();
  });

  it("marks the order failed and rethrows when the exchange call throws", async () => {
    const { submitAssisted } = await load(true);
    current = order({ provider: "coinbase" });
    const createOrder = vi.fn(async () => {
      throw new Error("Coinbase request failed (503): unavailable");
    });
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { createOrder }));

    await expect(submitAssisted(USER, ORDER_ID)).rejects.toThrow("Coinbase request failed (503): unavailable");
    expect(current).toMatchObject({ status: "failed", reconcileState: "error" });
  });
});

describe("reconcileAssisted", () => {
  const statuses: Record<string, OrderStatus> = {
    "o-filled": { orderId: "o-filled", status: "FILLED", filledSize: 0.002, averagePrice: PRICE, totalFees: 0.6, raw: "FILLED" },
    "o-cancelled": { orderId: "o-cancelled", status: "CANCELLED", filledSize: 0, averagePrice: null, totalFees: 0, raw: "CANCELLED" },
    "o-open": { orderId: "o-open", status: "OPEN", filledSize: 0, averagePrice: null, totalFees: 0, raw: "OPEN" },
    "o-unknown": { orderId: "o-unknown", status: "UNKNOWN", filledSize: null, averagePrice: null, totalFees: null, raw: "WEIRD" }
  };

  function pending(orderId: string): AssistedOrder {
    return order({ id: `id-${orderId}`, orderId, status: "submitted", provider: "coinbase", clientOrderId: `id-${orderId}` });
  }

  it("maps FILLED, CANCELLED, OPEN and UNKNOWN exchange statuses", async () => {
    const { reconcileAssisted } = await load(true);
    m.listPendingAssistedOrders.mockResolvedValue(Object.keys(statuses).map(pending));
    const getOrder = vi.fn(async (orderId: string) => statuses[orderId]!);
    m.getExchangeClient.mockResolvedValue(fakeClient("coinbase", { getOrder }));
    m.updateAssistedOrder.mockImplementation(async (id: string, patch: Partial<AssistedOrder>) => ({ ...order({ id }), ...patch }));

    const result = await reconcileAssisted(USER);

    expect(result).toEqual({ checked: 4, updated: 3 });
    const patchFor = (id: string) => m.updateAssistedOrder.mock.calls.find((c) => c[0] === id)?.[1];
    expect(patchFor("id-o-filled")).toMatchObject({
      status: "filled",
      reconcileState: "reconciled",
      filledSize: 0.002,
      averagePrice: PRICE,
      totalFees: 0.6,
      exchangeStatus: "FILLED"
    });
    expect(patchFor("id-o-filled").detail).toContain("Filled 0.002 at average $50000");
    expect(patchFor("id-o-cancelled")).toMatchObject({ status: "cancelled", reconcileState: "reconciled", exchangeStatus: "CANCELLED" });
    expect(patchFor("id-o-open")).toEqual({ exchangeStatus: "OPEN" });
    expect(patchFor("id-o-unknown")).toMatchObject({
      reconcileState: "error",
      exchangeStatus: "WEIRD",
      detail: "Exchange returned an unknown status; check the order on Coinbase."
    });
    expect(patchFor("id-o-unknown")).not.toHaveProperty("status");
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "operations", "reconcile-assisted-orders", "Checked 4, updated 3.");
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

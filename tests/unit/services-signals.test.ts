import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle, SignalEvaluation, SignalRecord, Ticker, TradingLimits } from "@/lib/types";

const m = vi.hoisted(() => ({
  insertSignal: vi.fn(),
  latestSignals: vi.fn(),
  appendAudit: vi.fn()
}));

vi.mock("@/lib/server/repos/signals", () => ({ insertSignal: m.insertSignal, latestSignals: m.latestSignals }));
vi.mock("@/lib/server/repos/audit", () => ({ appendAudit: m.appendAudit }));

import { __setMarketFetchers } from "@/lib/server/services/market";
import { __resetSignalRefresh, latestSignalsWithSizing, refreshSignals, refreshSignalsOnce, SIGNAL_REFRESH_AFTER_MS } from "@/lib/server/services/signals";

const USER = "user-1";

function candles(): Candle[] {
  const nowSec = Math.floor(Date.now() / 1000);
  return Array.from({ length: 120 }, (_, i) => {
    const close = 100 + i * 0.1;
    return { start: nowSec - (119 - i) * 3600 - 60, open: close - 0.05, high: close + 0.5, low: close - 0.5, close, volume: 10 };
  });
}

function ticker(productId: string): Ticker {
  return { productId, price: 112, bestBid: 111.99, bestAsk: 112.01, tradeTime: Date.now() };
}

beforeEach(() => {
  vi.resetAllMocks();
  __resetSignalRefresh();
  let n = 0;
  m.insertSignal.mockImplementation(async (e: SignalEvaluation) => ({ ...e, id: `sig-${++n}` }));
  m.appendAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  __setMarketFetchers(null);
});

describe("refreshSignals", () => {
  it("turns a throwing market fetcher into a blocked signal without failing the others", async () => {
    __setMarketFetchers({
      candles: async (productId) => {
        if (productId === "ETH-USD") {
          throw new Error("Coinbase public request failed (503): down");
        }
        return candles();
      },
      ticker: async (productId) => ticker(productId)
    });

    const records = await refreshSignals(USER);

    expect(records.map((r) => r.productId)).toEqual(["BTC-USD", "ETH-USD", "SOL-USD"]);
    const eth = records.find((r) => r.productId === "ETH-USD")!;
    expect(eth).toMatchObject({ action: "blocked", setup: "Market data unavailable", strength: 0, rationale: ["Coinbase public request failed (503): down"] });
    for (const other of records.filter((r) => r.productId !== "ETH-USD")) {
      expect(other.setup).not.toBe("Market data unavailable");
      expect(other.referencePrice).toBe(112);
    }
    expect(m.insertSignal).toHaveBeenCalledTimes(3);
    expect(m.appendAudit).toHaveBeenCalledTimes(3);
    expect(m.appendAudit).toHaveBeenCalledWith(USER, "signal", "evaluated", "ETH-USD: blocked — Market data unavailable");
  });

  it("skips audit events without a user", async () => {
    __setMarketFetchers({
      candles: async () => {
        throw new Error("offline");
      },
      ticker: async (productId) => ticker(productId)
    });

    const records = await refreshSignals(null);

    expect(records.every((r) => r.action === "blocked" && r.rationale[0] === "offline")).toBe(true);
    expect(m.appendAudit).not.toHaveBeenCalled();
  });
});

describe("latestSignalsWithSizing", () => {
  const limits: TradingLimits = {
    userId: USER,
    maxPositionUsd: 1500,
    dailyLossCapUsd: 300,
    maxTradesPerDay: 6,
    cooldownMinutes: 20,
    lossStreakTrigger: 2,
    perSymbolMaxUsd: { "SOL-USD": 200 },
    tradingPaused: false,
    updatedAt: "2026-10-09T00:00:00.000Z"
  };
  const record = (productId: string, evaluatedAt: string, atrPct: number | null = 5): SignalRecord => ({
    id: `s-${productId}`,
    productId,
    action: "long",
    setup: "Trend continuation",
    rationale: [],
    strength: 0.6,
    referencePrice: 100,
    atrPct,
    rsi: 55,
    spreadPct: 0.01,
    dataAgeMs: 1000,
    evaluatedAt
  });

  it("adds the ATR-based suggested size, capped by the per-symbol cap, without refreshing fresh signals", async () => {
    const fresh = new Date().toISOString();
    m.latestSignals.mockResolvedValue([record("BTC-USD", fresh), record("ETH-USD", fresh, null), record("SOL-USD", fresh), record("DOGE-USD", fresh)]);

    const sized = await latestSignalsWithSizing(limits);

    expect(sized.map((s) => [s.productId, s.suggestedQuoteUsd])).toEqual([
      ["BTC-USD", 1500],
      ["ETH-USD", 0],
      ["SOL-USD", 200]
    ]);
    expect(m.insertSignal).not.toHaveBeenCalled();
  });

  it("re-evaluates once when the latest signals are older than 15 minutes, even for concurrent page loads", async () => {
    const old = new Date(Date.now() - SIGNAL_REFRESH_AFTER_MS - 60_000).toISOString();
    m.latestSignals.mockResolvedValue([record("BTC-USD", old), record("ETH-USD", old), record("SOL-USD", old)]);
    __setMarketFetchers({ candles: async () => candles(), ticker: async (productId) => ticker(productId) });

    const [a, b] = await Promise.all([latestSignalsWithSizing(limits), latestSignalsWithSizing(limits)]);

    expect(m.insertSignal).toHaveBeenCalledTimes(3);
    expect(a.map((s) => s.productId)).toEqual(["BTC-USD", "ETH-USD", "SOL-USD"]);
    expect(b.map((s) => s.id)).toEqual(a.map((s) => s.id));
    expect(Date.now() - Date.parse(a[0]!.evaluatedAt)).toBeLessThan(60_000);
  });

  it("refreshes when a watchlist product has no signal at all", async () => {
    const fresh = new Date().toISOString();
    m.latestSignals.mockResolvedValue([record("BTC-USD", fresh)]);
    __setMarketFetchers({ candles: async () => candles(), ticker: async (productId) => ticker(productId) });

    await latestSignalsWithSizing(limits);

    expect(m.insertSignal).toHaveBeenCalledTimes(3);
  });

  it("returns the stored signals when the automatic refresh fails", async () => {
    const old = new Date(Date.now() - SIGNAL_REFRESH_AFTER_MS - 60_000).toISOString();
    m.latestSignals.mockResolvedValue([record("BTC-USD", old), record("ETH-USD", old), record("SOL-USD", old)]);
    __setMarketFetchers({ candles: async () => candles(), ticker: async (productId) => ticker(productId) });
    m.insertSignal.mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const sized = await latestSignalsWithSizing(limits);

    expect(sized.map((s) => s.evaluatedAt)).toEqual([old, old, old]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("refreshSignalsOnce", () => {
  it("shares one refresh between overlapping callers", async () => {
    __setMarketFetchers({ candles: async () => candles(), ticker: async (productId) => ticker(productId) });
    const [a, b] = await Promise.all([refreshSignalsOnce(USER), refreshSignalsOnce(USER)]);
    expect(a).toBe(b);
    expect(m.insertSignal).toHaveBeenCalledTimes(3);
    await refreshSignalsOnce(USER);
    expect(m.insertSignal).toHaveBeenCalledTimes(6);
  });
});

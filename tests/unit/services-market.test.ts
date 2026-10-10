import { afterEach, describe, expect, it, vi } from "vitest";
import { STRATEGY } from "@/lib/domain/strategy";
import {
  __clearMarketCache,
  __setMarketFetchers,
  getMarketSnapshot,
  getReferencePrice,
  getReferencePrices,
  marketDataAgeMs
} from "@/lib/server/services/market";
import { isUnknownProductError } from "@/lib/server/services/shared";
import type { Candle, Ticker } from "@/lib/types";

function ticker(productId: string, price: number): Ticker {
  return { productId, price, bestBid: price, bestAsk: price, tradeTime: Date.now() };
}

afterEach(() => {
  vi.useRealTimers();
  __setMarketFetchers(null);
});

describe("market snapshot cache", () => {
  it("fetches candles with the strategy granularity and reuses the snapshot for 30 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z"));
    const candles = vi.fn(async (): Promise<Candle[]> => []);
    const tick = vi.fn(async (productId: string) => ticker(productId, 100));
    __setMarketFetchers({ candles, ticker: tick });

    const first = await getMarketSnapshot("BTC-USD");
    vi.setSystemTime(new Date("2026-10-09T12:00:29.000Z"));
    const second = await getMarketSnapshot("BTC-USD");

    expect(second).toBe(first);
    expect(candles).toHaveBeenCalledTimes(1);
    expect(candles).toHaveBeenCalledWith("BTC-USD", STRATEGY.granularity, STRATEGY.candleLimit);

    vi.setSystemTime(new Date("2026-10-09T12:00:31.000Z"));
    await getMarketSnapshot("BTC-USD");
    expect(candles).toHaveBeenCalledTimes(2);

    __clearMarketCache();
    await getMarketSnapshot("BTC-USD");
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("remembers a failed fetch for a few seconds only, then tries again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z"));
    let down = true;
    const tick = vi.fn(async (productId: string) => {
      if (down) throw new Error("Coinbase public request failed (503): down");
      return ticker(productId, 100);
    });
    __setMarketFetchers({ candles: async () => [], ticker: tick });

    await expect(getMarketSnapshot("BTC-USD")).rejects.toThrow("(503)");
    vi.setSystemTime(new Date("2026-10-09T12:00:04.000Z"));
    await expect(getMarketSnapshot("BTC-USD")).rejects.toThrow("(503)");
    expect(tick).toHaveBeenCalledTimes(1);

    down = false;
    vi.setSystemTime(new Date("2026-10-09T12:00:06.000Z"));
    await expect(getMarketSnapshot("BTC-USD")).resolves.toMatchObject({ ticker: { price: 100 } });
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("does not let one product's failure affect another product", async () => {
    __setMarketFetchers({
      candles: async () => [],
      ticker: async (productId) => {
        if (productId === "SOL-USD") throw new Error("down");
        return ticker(productId, 5);
      }
    });
    await expect(getMarketSnapshot("SOL-USD")).rejects.toThrow("down");
    await expect(getMarketSnapshot("ETH-USD")).resolves.toMatchObject({ ticker: { price: 5 } });
  });

  it("fetches candles and ticker once per refresh for a product", async () => {
    const candles = vi.fn(async (): Promise<Candle[]> => []);
    const tick = vi.fn(async (productId: string) => ticker(productId, 100));
    __setMarketFetchers({ candles, ticker: tick });

    await Promise.all([getMarketSnapshot("BTC-USD"), getReferencePrice("BTC-USD"), getReferencePrices(["BTC-USD"])]);

    expect(candles).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight fetch between concurrent callers", async () => {
    const tick = vi.fn(async (productId: string) => ticker(productId, 100));
    __setMarketFetchers({ candles: async () => [], ticker: tick });

    await Promise.all([getMarketSnapshot("ETH-USD"), getMarketSnapshot("ETH-USD")]);

    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("returns reference prices and leaves out products whose fetch fails", async () => {
    __setMarketFetchers({
      candles: async () => [],
      ticker: async (productId) => {
        if (productId === "SOL-USD") {
          throw new Error("down");
        }
        return ticker(productId, productId === "BTC-USD" ? 60000 : 3000);
      }
    });

    expect(await getReferencePrice("BTC-USD")).toBe(60000);
    expect(await getReferencePrices(["BTC-USD", "ETH-USD", "SOL-USD", "BTC-USD"])).toEqual({ "BTC-USD": 60000, "ETH-USD": 3000 });
  });

  it("reports a product Coinbase does not list as an UnknownProductError, and an outage as a plain error", async () => {
    __setMarketFetchers({
      candles: async (productId) => {
        if (productId === "ZZZZ-USD") throw new Error('Coinbase public request failed (404): {"error":"NOT_FOUND","message":"product ZZZZ-USD not found"}');
        if (productId === "QQQQ-USD") throw new Error('Coinbase public request failed (400): {"error":"INVALID_ARGUMENT","message":"ProductID is invalid"}');
        if (productId === "DOWN-USD") throw new Error("Coinbase public request failed (503): upstream unavailable");
        throw new Error("Coinbase public request timed out after 8 s");
      },
      ticker: async (productId) => ticker(productId, 1)
    });

    const unknown = await getMarketSnapshot("ZZZZ-USD").catch((e: unknown) => e);
    expect(isUnknownProductError(unknown)).toBe(true);
    expect(String(unknown)).toContain("ZZZZ-USD is not a tradable Coinbase pair.");
    expect(isUnknownProductError(await getMarketSnapshot("QQQQ-USD").catch((e: unknown) => e))).toBe(true);
    for (const outage of ["DOWN-USD", "SLOW-USD"]) {
      const error = await getMarketSnapshot(outage).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(isUnknownProductError(error)).toBe(false);
    }
  });

  it("measures data age from the ticker trade time", () => {
    expect(marketDataAgeMs({ ticker: { productId: "BTC-USD", price: 1, bestBid: 1, bestAsk: 1, tradeTime: 1000 } }, 4500)).toBe(3500);
  });
});

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

  it("measures data age from the ticker trade time", () => {
    expect(marketDataAgeMs({ ticker: { productId: "BTC-USD", price: 1, bestBid: 1, bestAsk: 1, tradeTime: 1000 } }, 4500)).toBe(3500);
  });
});

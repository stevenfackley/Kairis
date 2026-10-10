import { STRATEGY } from "@/lib/domain/strategy";
import { fetchCandles, fetchTicker } from "@/lib/exchange/coinbase-public";
import { isProductNotFound, UnknownProductError } from "@/lib/server/services/shared";
import type { Candle, Ticker } from "@/lib/types";

export type MarketSnapshot = { candles: Candle[]; ticker: Ticker; fetchedAt: number };

type MarketFetchers = { candles: typeof fetchCandles; ticker: typeof fetchTicker };

const TTL_MS = 30_000;

// Per-process cache: every signal refresh, risk check and mock fill within 30 s shares one fetch.
const cache = new Map<string, MarketSnapshot>();
const inflight = new Map<string, Promise<MarketSnapshot>>();
let fetchers: MarketFetchers = { candles: fetchCandles, ticker: fetchTicker };

// Tests only: swap the public-market fetchers (null restores the real ones). Clears the cache.
export function __setMarketFetchers(f: { candles?: typeof fetchCandles; ticker?: typeof fetchTicker } | null): void {
  fetchers = { candles: f?.candles ?? fetchCandles, ticker: f?.ticker ?? fetchTicker };
  __clearMarketCache();
}

export function __clearMarketCache(): void {
  cache.clear();
  inflight.clear();
}

// A "not found" from Coinbase means the product id is wrong, not that the feed is down: it surfaces
// as UnknownProductError so the risk engine blocks the order instead of halting as degraded.
async function load(productId: string): Promise<MarketSnapshot> {
  let candles: Candle[];
  let ticker: Ticker;
  try {
    [candles, ticker] = await Promise.all([
      fetchers.candles(productId, STRATEGY.granularity, STRATEGY.candleLimit),
      fetchers.ticker(productId)
    ]);
  } catch (error) {
    throw isProductNotFound(error) ? new UnknownProductError(productId) : error;
  }
  const snapshot: MarketSnapshot = { candles, ticker, fetchedAt: Date.now() };
  cache.set(productId, snapshot);
  return snapshot;
}

export async function getMarketSnapshot(productId: string): Promise<MarketSnapshot> {
  const hit = cache.get(productId);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    return hit;
  }
  const pending = inflight.get(productId);
  if (pending) {
    return pending;
  }
  const request = load(productId);
  inflight.set(productId, request);
  try {
    return await request;
  } finally {
    if (inflight.get(productId) === request) {
      inflight.delete(productId);
    }
  }
}

export async function getReferencePrice(productId: string): Promise<number> {
  return (await getMarketSnapshot(productId)).ticker.price;
}

// Products whose fetch fails are left out: callers mark positions at average cost instead.
export async function getReferencePrices(productIds: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(productIds)];
  const settled = await Promise.allSettled(unique.map((id) => getReferencePrice(id)));
  const prices: Record<string, number> = {};
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      prices[unique[i]!] = result.value;
    }
  });
  return prices;
}

export function marketDataAgeMs(snapshot: Pick<MarketSnapshot, "ticker">, nowMs: number): number {
  return nowMs - snapshot.ticker.tradeTime;
}

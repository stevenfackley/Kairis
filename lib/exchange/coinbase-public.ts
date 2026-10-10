import type { Candle, Ticker } from "@/lib/types";
import { ExchangeHttpError, ExchangeTransportError, scrubSecrets } from "@/lib/exchange/errors";
import type { FetchLike } from "@/lib/exchange/types";

type Granularity = "ONE_HOUR" | "ONE_DAY" | "FIFTEEN_MINUTE";

const baseUrl = "https://api.coinbase.com/api/v3/brokerage/market/products";

const granularitySeconds: Record<Granularity, number> = {
  FIFTEEN_MINUTE: 900,
  ONE_HOUR: 3600,
  ONE_DAY: 86400
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, label: string): number {
  if (typeof value === "string" && value.trim() === "") {
    throw new Error(`Malformed Coinbase response: ${label} is empty.`);
  }
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  if (!Number.isFinite(n)) {
    throw new Error(`Malformed Coinbase response: ${label} is not numeric.`);
  }
  return n;
}

export function mapCandles(json: unknown): Candle[] {
  if (!isRecord(json) || !Array.isArray(json.candles)) {
    throw new Error("Malformed Coinbase candles response.");
  }
  const candles = (json.candles as unknown[]).map((c): Candle => {
    if (!isRecord(c)) {
      throw new Error("Malformed Coinbase candle entry.");
    }
    return {
      start: num(c.start, "candle.start"),
      open: num(c.open, "candle.open"),
      high: num(c.high, "candle.high"),
      low: num(c.low, "candle.low"),
      close: num(c.close, "candle.close"),
      volume: num(c.volume, "candle.volume")
    };
  });
  return candles.sort((a, b) => a.start - b.start);
}

export function mapTicker(productId: string, json: unknown): Ticker {
  if (!isRecord(json) || !Array.isArray(json.trades) || !isRecord(json.trades[0])) {
    throw new Error("Malformed Coinbase ticker response.");
  }
  const trade = json.trades[0];
  const price = num(trade.price, "trade.price");
  const tradeTime = typeof trade.time === "string" ? Date.parse(trade.time) : NaN;
  if (!Number.isFinite(tradeTime)) {
    throw new Error("Malformed Coinbase response: trade.time is invalid.");
  }
  const missing = (v: unknown) => v === undefined || v === null || v === "";
  return {
    productId,
    price,
    bestBid: missing(json.best_bid) ? price : num(json.best_bid, "best_bid"),
    bestAsk: missing(json.best_ask) ? price : num(json.best_ask, "best_ask"),
    tradeTime
  };
}

const TIMEOUT_MS = 8000;
const TIMEOUT_MESSAGE = "Coinbase public request timed out after 8 s";

function isTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (isTimeout(error)) {
      throw new ExchangeTransportError("timeout", TIMEOUT_MESSAGE);
    }
    throw new ExchangeTransportError("network", "Kairis could not reach Coinbase market data (network error).");
  }
  if (!response.ok) {
    const body = scrubSecrets((await response.text().catch(() => "")).trim()).slice(0, 200);
    throw new ExchangeHttpError(response.status, `Coinbase public request failed (${response.status}): ${body}`, null);
  }
  return (await response.json()) as unknown;
}

export async function fetchCandles(
  productId: string,
  granularity: Granularity,
  limit: number,
  fetchImpl: FetchLike = fetch,
  nowMs = Date.now()
): Promise<Candle[]> {
  const end = Math.floor(nowMs / 1000);
  const start = end - limit * granularitySeconds[granularity];
  const url = `${baseUrl}/${encodeURIComponent(productId)}/candles?start=${start}&end=${end}&granularity=${granularity}&limit=${limit}`;
  return mapCandles(await getJson(fetchImpl, url));
}

export async function fetchTicker(productId: string, fetchImpl: FetchLike = fetch): Promise<Ticker> {
  const url = `${baseUrl}/${encodeURIComponent(productId)}/ticker?limit=1`;
  return mapTicker(productId, await getJson(fetchImpl, url));
}

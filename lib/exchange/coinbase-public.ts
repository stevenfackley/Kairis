import type { Candle, Ticker } from "@/lib/types";
import { ExchangeHttpError, ExchangeTransportError, scrubSecrets } from "@/lib/exchange/errors";
import type { ProductRules } from "@/lib/exchange/sizing";
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

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

/** Maps GET /api/v3/brokerage/market/products/{product_id} into the rules order sizing needs. */
export function mapProduct(json: unknown): ProductRules {
  if (!isRecord(json) || typeof json.product_id !== "string" || json.product_id === "") {
    throw new Error("Malformed Coinbase product response.");
  }
  const productId = json.product_id;
  const increment = (value: unknown, label: string): string => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!PLAIN_DECIMAL.test(s) || Number(s) <= 0) {
      throw new Error(`Malformed Coinbase product response: ${label} is not a positive decimal.`);
    }
    return s;
  };
  // An empty or missing bound means Coinbase sets none.
  const bound = (value: unknown): string => {
    const s = typeof value === "string" ? value.trim() : "";
    return PLAIN_DECIMAL.test(s) ? s : "0";
  };
  const baseCurrency =
    typeof json.base_currency_id === "string" && json.base_currency_id !== "" ? json.base_currency_id : productId.split("-")[0] ?? productId;
  return {
    productId,
    baseCurrency,
    status: typeof json.status === "string" ? json.status : "",
    baseIncrement: increment(json.base_increment, "base_increment"),
    quoteIncrement: increment(json.quote_increment, "quote_increment"),
    baseMinSize: bound(json.base_min_size),
    baseMaxSize: bound(json.base_max_size),
    quoteMinSize: bound(json.quote_min_size),
    quoteMaxSize: bound(json.quote_max_size),
    isDisabled: json.is_disabled === true,
    tradingDisabled: json.trading_disabled === true,
    cancelOnly: json.cancel_only === true,
    limitOnly: json.limit_only === true,
    postOnly: json.post_only === true,
    viewOnly: json.view_only === true
  };
}

export async function fetchProduct(productId: string, fetchImpl: FetchLike = fetch): Promise<ProductRules> {
  try {
    return mapProduct(await getJson(fetchImpl, `${baseUrl}/${encodeURIComponent(productId)}`));
  } catch (error) {
    if (error instanceof ExchangeHttpError && (error.status === 404 || error.status === 400)) {
      throw new ExchangeHttpError(error.status, `Coinbase does not offer ${productId} for trading (HTTP ${error.status}).`, null);
    }
    throw error;
  }
}

// Increments and limits change rarely; five minutes keeps a burst of previews to one fetch per product.
const PRODUCT_TTL_MS = 5 * 60_000;
const productCache = new Map<string, { rules: ProductRules; fetchedAt: number }>();
const productInflight = new Map<string, Promise<ProductRules>>();
let productLoader: (productId: string) => Promise<ProductRules> = (productId) => fetchProduct(productId);

/** Tests only: swap the product loader (null restores the real one). Clears the cache. */
export function __setProductLoader(loader: ((productId: string) => Promise<ProductRules>) | null): void {
  productLoader = loader ?? ((productId) => fetchProduct(productId));
  productCache.clear();
  productInflight.clear();
}

/** Cached product rules; failures are not cached. */
export async function getProductRules(productId: string, nowMs = Date.now()): Promise<ProductRules> {
  const hit = productCache.get(productId);
  if (hit && nowMs - hit.fetchedAt < PRODUCT_TTL_MS) {
    return hit.rules;
  }
  const pending = productInflight.get(productId);
  if (pending) {
    return pending;
  }
  const request = productLoader(productId).then((rules) => {
    productCache.set(productId, { rules, fetchedAt: Date.now() });
    return rules;
  });
  productInflight.set(productId, request);
  try {
    return await request;
  } finally {
    if (productInflight.get(productId) === request) {
      productInflight.delete(productId);
    }
  }
}

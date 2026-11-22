import { afterEach, describe, expect, it, vi } from "vitest";
import { __setProductLoader, fetchCandles, fetchProduct, fetchTicker } from "@/lib/exchange/coinbase-public";
import { __setMarketFetchers, getMarketSnapshot } from "@/lib/server/services/market";
import { isUnknownProductError, loadProductRules } from "@/lib/server/services/shared";

// "Coinbase does not list this product" blocks an order; any other failure is an outage and halts it.
// These go through the real public fetchers, so they pin the classification whatever shape the error takes.

function respond(status: number, body: string): typeof fetch {
  return vi.fn(async () => new Response(body, { status }));
}

function serveMarket(status: number, body: string): void {
  const f = respond(status, body);
  __setMarketFetchers({
    candles: (productId, granularity, limit) => fetchCandles(productId, granularity, limit, f),
    ticker: (productId) => fetchTicker(productId, f)
  });
}

function serveProduct(status: number, body: string): void {
  const f = respond(status, body);
  __setProductLoader((productId) => fetchProduct(productId, f));
}

afterEach(() => {
  __setMarketFetchers(null);
  __setProductLoader(null);
});

describe("market snapshot: unknown product or outage", () => {
  it("treats a 404 as an unknown product", async () => {
    serveMarket(404, JSON.stringify({ error: "NOT_FOUND", message: "not found" }));
    const error = await getMarketSnapshot("ZZZZ-USD").catch((e: unknown) => e);
    expect(isUnknownProductError(error)).toBe(true);
    expect(String(error)).toContain("ZZZZ-USD is not a tradable Coinbase pair.");
  });

  it("treats a 400 about the product as an unknown product", async () => {
    serveMarket(400, JSON.stringify({ error: "INVALID_ARGUMENT", message: "ProductID is invalid" }));
    expect(isUnknownProductError(await getMarketSnapshot("QQQQ-USD").catch((e: unknown) => e))).toBe(true);
  });

  it("treats a 400 about anything else as an outage", async () => {
    serveMarket(400, JSON.stringify({ error: "INVALID_ARGUMENT", message: "granularity is invalid" }));
    const error = await getMarketSnapshot("BTC-USD").catch((e: unknown) => e);
    expect(isUnknownProductError(error)).toBe(false);
    expect(String(error)).toContain('Coinbase public request failed (400): {"error":"INVALID_ARGUMENT","message":"granularity is invalid"}');
  });

  it.each([429, 500, 503])("treats a %i as an outage", async (status) => {
    serveMarket(status, "upstream unavailable");
    const error = await getMarketSnapshot("BTC-USD").catch((e: unknown) => e);
    expect(isUnknownProductError(error)).toBe(false);
    expect(String(error)).toContain(`Coinbase public request failed (${status}): upstream unavailable`);
  });
});

describe("product rules: unknown product or outage", () => {
  it.each([
    [404, JSON.stringify({ error: "NOT_FOUND", message: "Product NOPE-USD not supported" })],
    [400, JSON.stringify({ error: "INVALID_ARGUMENT", message: "bad request" })]
  ])("fetchProduct says plainly that Coinbase does not offer the product on a %i", async (status, body) => {
    await expect(fetchProduct("NOPE-USD", respond(status, body))).rejects.toThrow(`Coinbase does not offer NOPE-USD for trading (HTTP ${status}).`);
  });

  it("fetchProduct passes any other failure through", async () => {
    await expect(fetchProduct("NOPE-USD", respond(503, "down"))).rejects.toThrow("Coinbase public request failed (503): down");
  });

  // Any 400 counts here, unlike the market data: the product id is the endpoint's only parameter.
  it.each([404, 400])("loadProductRules reports an unknown product on a %i", async (status) => {
    serveProduct(status, "bad request");
    expect(await loadProductRules("NOPE-USD")).toEqual({ ok: false, unknownProduct: true, message: "NOPE-USD is not a tradable Coinbase pair." });
  });

  it.each([429, 503])("loadProductRules reports a %i as an outage", async (status) => {
    serveProduct(status, "down");
    expect(await loadProductRules("NOPE-USD")).toEqual({
      ok: false,
      unknownProduct: false,
      message: `Kairis could not load the NOPE-USD trading rules from Coinbase: Coinbase public request failed (${status}): down`
    });
  });
});

import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@coinbase/cdp-sdk/auth", () => ({ generateJwt: vi.fn(async () => "token") }));

import { generateJwt } from "@coinbase/cdp-sdk/auth";

import {
  createCoinbaseClient,
  mapBalances,
  mapKeyPermissions,
  mapOrderStatus,
  mapPreview,
  mapSubmit
} from "@/lib/exchange/coinbase";
import {
  __setProductLoader,
  fetchCandles,
  fetchProduct,
  fetchTicker,
  getProductRules,
  mapCandles,
  mapProduct,
  mapTicker
} from "@/lib/exchange/coinbase-public";
import { ExchangeHttpError, ExchangeTransportError, normalizeExchangeError } from "@/lib/exchange/errors";

function stub(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return vi.fn(async () => new Response(text, { status }));
}

function call(fn: ReturnType<typeof stub>) {
  const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init, headers: (init.headers ?? {}) as Record<string, string> };
}

describe("public mappers", () => {
  it("maps candles ascending as numbers", () => {
    const out = mapCandles({
      candles: [
        { start: "1700003600", low: "1", high: "2", open: "1.5", close: "1.8", volume: "10" },
        { start: "1700000000", low: "0.5", high: "2", open: "1", close: "1.5", volume: "4" }
      ]
    });
    expect(out.map((c) => c.start)).toEqual([1700000000, 1700003600]);
    expect(out[1]).toEqual({ start: 1700003600, low: 1, high: 2, open: 1.5, close: 1.8, volume: 10 });
  });

  it("rejects malformed candles", () => {
    expect(() => mapCandles({})).toThrow();
    expect(() => mapCandles({ candles: [{ start: "x" }] })).toThrow();
    expect(() => mapCandles({ candles: [null] })).toThrow();
  });

  it("maps ticker and falls back to price", () => {
    const base = { trades: [{ price: "100.5", time: "2026-10-09T12:00:00Z" }] };
    expect(mapTicker("BTC-USD", { ...base, best_bid: "100.4", best_ask: "100.6" })).toEqual({
      productId: "BTC-USD",
      price: 100.5,
      bestBid: 100.4,
      bestAsk: 100.6,
      tradeTime: Date.parse("2026-10-09T12:00:00Z")
    });
    const fb = mapTicker("BTC-USD", base);
    expect(fb.bestBid).toBe(100.5);
    expect(fb.bestAsk).toBe(100.5);
  });

  it("rejects malformed ticker", () => {
    expect(() => mapTicker("BTC-USD", { trades: [] })).toThrow();
    expect(() => mapTicker("BTC-USD", { trades: [{ price: "1", time: "nope" }] })).toThrow();
  });
});

describe("public fetchers", () => {
  it("fetchCandles builds the URL", async () => {
    const f = stub(200, { candles: [{ start: "1", low: "1", high: "2", open: "1", close: "2", volume: "3" }] });
    const out = await fetchCandles("BTC-USD", "ONE_HOUR", 10, f, 1_700_000_000_000);
    expect(out).toHaveLength(1);
    const { url, init } = call(f);
    expect(url).toBe(
      `https://api.coinbase.com/api/v3/brokerage/market/products/BTC-USD/candles?start=${1_700_000_000 - 36000}&end=1700000000&granularity=ONE_HOUR&limit=10`
    );
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
  });

  it("fetchTicker builds the URL", async () => {
    const f = stub(200, { trades: [{ price: "5", time: "2026-10-09T12:00:00Z" }], best_bid: "4", best_ask: "6" });
    const t = await fetchTicker("ETH-USD", f);
    expect(t.price).toBe(5);
    expect(call(f).url).toBe("https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD/ticker?limit=1");
  });

  it("throws with status on non-2xx", async () => {
    await expect(fetchTicker("ETH-USD", stub(429, "slow down"))).rejects.toThrow(
      "Coinbase public request failed (429): slow down"
    );
    await expect(fetchCandles("ETH-USD", "ONE_DAY", 5, stub(500, "boom"))).rejects.toThrow("(500)");
  });

  it("passes an abort signal and works with stubs that ignore it", async () => {
    const f = stub(200, { trades: [{ price: "5", time: "2026-10-09T12:00:00Z" }] });
    await fetchTicker("ETH-USD", f);
    expect(call(f).init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps a timeout abort to a clear error", async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(fetchTicker("ETH-USD", timeout)).rejects.toThrow("Coinbase public request timed out after 8 s");
    await expect(fetchCandles("ETH-USD", "ONE_DAY", 5, timeout)).rejects.toThrow("Coinbase public request timed out after 8 s");
  });

  it("throws on malformed JSON body", async () => {
    await expect(fetchTicker("ETH-USD", stub(200, "not json"))).rejects.toThrow();
    await expect(fetchCandles("ETH-USD", "ONE_DAY", 5, stub(200, { nope: 1 }))).rejects.toThrow();
  });
});

describe("product rules", () => {
  const btc = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/coinbase/product-btc-usd.json"), "utf8")) as Record<string, unknown>;

  it("fetchProduct GETs the public product and maps it", async () => {
    const f = stub(200, btc);
    const rules = await fetchProduct("BTC-USD", f);
    expect(rules).toMatchObject({ productId: "BTC-USD", quoteIncrement: "0.01", quoteMinSize: "1", baseIncrement: "0.00000001" });
    expect(call(f).url).toBe("https://api.coinbase.com/api/v3/brokerage/market/products/BTC-USD");
    expect(call(f).init.signal).toBeInstanceOf(AbortSignal);
  });

  it("says plainly when Coinbase does not offer the product", async () => {
    const f = stub(404, { error: "NOT_FOUND", error_details: "Product NOPE-USD not supported", message: "Product NOPE-USD not supported" });
    await expect(fetchProduct("NOPE-USD", f)).rejects.toThrow("Coinbase does not offer NOPE-USD for trading (HTTP 404).");
  });

  it("getProductRules caches per product for five minutes and does not cache failures", async () => {
    const rules = mapProduct(btc);
    const loader = vi.fn(async () => rules);
    __setProductLoader(loader);
    try {
      await getProductRules("BTC-USD");
      await getProductRules("BTC-USD");
      expect(loader).toHaveBeenCalledTimes(1);
      await getProductRules("BTC-USD", Date.now() + 6 * 60_000);
      expect(loader).toHaveBeenCalledTimes(2);

      const failing = vi.fn(async () => {
        throw new Error("down");
      });
      __setProductLoader(failing);
      await expect(getProductRules("ETH-USD")).rejects.toThrow("down");
      await expect(getProductRules("ETH-USD")).rejects.toThrow("down");
      expect(failing).toHaveBeenCalledTimes(2);
    } finally {
      __setProductLoader(null);
    }
  });
});

describe("authed mappers", () => {
  it("mapKeyPermissions", () => {
    // Shaped like the documented GET /api/v3/brokerage/key_permissions response.
    expect(mapKeyPermissions({ can_view: true, can_trade: false, can_transfer: false, portfolio_uuid: "p-1", portfolio_type: "CONSUMER" })).toEqual({
      canView: true,
      canTrade: false,
      canTransfer: false,
      portfolioUuid: "p-1",
      portfolioType: "CONSUMER"
    });
    expect(mapKeyPermissions({ can_view: true, can_trade: true, can_transfer: true })).toMatchObject({ portfolioUuid: null, portfolioType: null });
    // UNDEFINED is the enum's default, not a portfolio type.
    expect(mapKeyPermissions({ can_view: true, portfolio_type: "UNDEFINED" }).portfolioType).toBeNull();
    expect(() => mapKeyPermissions("x")).toThrow();
  });

  it("mapBalances", () => {
    const out = mapBalances({
      accounts: [
        { currency: "USD", available_balance: { value: "123.45", currency: "USD" } },
        { currency: "BTC", available_balance: { value: "bad", currency: "BTC" } },
        { currency: "ETH" }
      ]
    });
    expect(out).toEqual([{ currency: "USD", available: 123.45 }]);
    expect(() => mapBalances({})).toThrow();
  });

  // Shaped like the documented OrderPreviewResponse: every amount a string, errs/warning enum arrays.
  const previewOk = {
    order_total: "100",
    commission_total: "0.6",
    errs: [],
    warning: [],
    quote_size: "99.4",
    base_size: "0.00119869",
    best_bid: "82921.35",
    best_ask: "82921.36",
    is_max: false,
    preview_id: "b40bbff9-17ce-4726-8b64-9de7ae57ad26"
  };

  it("mapPreview reads a clean preview", () => {
    expect(mapPreview(previewOk)).toEqual({
      previewId: "b40bbff9-17ce-4726-8b64-9de7ae57ad26",
      orderTotal: 100,
      commissionTotal: 0.6,
      bestBid: 82921.35,
      bestAsk: 82921.36,
      baseSize: 0.00119869,
      quoteSize: 99.4,
      errors: [],
      warnings: []
    });
    expect(mapPreview({})).toEqual({
      previewId: null,
      orderTotal: 0,
      commissionTotal: 0,
      bestBid: null,
      bestAsk: null,
      baseSize: null,
      quoteSize: null,
      errors: [],
      warnings: []
    });
  });

  it("mapPreview keeps errs apart from warnings and words both", () => {
    const out = mapPreview({ ...previewOk, errs: ["PREVIEW_INSUFFICIENT_FUND", "PREVIEW_SOMETHING_NEW"], warning: ["UNKNOWN", "BIG_ORDER"] });
    expect(out.errors).toEqual([
      "Not enough funds in the Coinbase account for this order. (PREVIEW_INSUFFICIENT_FUND)",
      "Something new. (PREVIEW_SOMETHING_NEW)"
    ]);
    expect(out.warnings).toEqual(["Large order for this market: expect the fill price to move against you. (BIG_ORDER)"]);
  });

  it("mapSubmit reads the documented success and failure shapes", () => {
    expect(
      mapSubmit({ success: true, success_response: { order_id: "11111-00000-000000", product_id: "BTC-USD", side: "BUY", client_order_id: "c1" }, order_configuration: {} }, "c1")
    ).toEqual({ success: true, orderId: "11111-00000-000000", clientOrderId: "c1", failureReason: null, detail: "Coinbase accepted the order." });

    const rejected = mapSubmit(
      {
        success: false,
        error_response: {
          error: "INSUFFICIENT_FUND",
          message: "Insufficient balance in source account",
          error_details: "",
          preview_failure_reason: "PREVIEW_INSUFFICIENT_FUND",
          new_order_failure_reason: "INSUFFICIENT_FUND"
        },
        order_configuration: { market_market_ioc: { quote_size: "100" } }
      },
      "c1"
    );
    expect(rejected).toEqual({
      success: false,
      orderId: null,
      clientOrderId: "c1",
      failureReason: "INSUFFICIENT_FUND",
      detail: 'Coinbase rejected the order. Not enough funds in the Coinbase account for this order. (INSUFFICIENT_FUND) Coinbase says: "Insufficient balance in source account".'
    });

    // Only the deprecated preview reason, and an UNKNOWN_* default that says nothing.
    expect(mapSubmit({ success: false, error_response: { preview_failure_reason: "PREVIEW_INVALID_BASE_SIZE_TOO_SMALL" } }, "c1")).toMatchObject({
      failureReason: "PREVIEW_INVALID_BASE_SIZE_TOO_SMALL",
      detail: "Coinbase rejected the order. The order is below the minimum size Coinbase accepts for this product. (PREVIEW_INVALID_BASE_SIZE_TOO_SMALL)"
    });
    expect(mapSubmit({ success: false, error_response: { new_order_failure_reason: "UNKNOWN_FAILURE_REASON", error_details: "Market orders cannot be placed with empty order sizes" } }, "c1")).toMatchObject({
      failureReason: null,
      detail: 'Coinbase rejected the order. Coinbase says: "Market orders cannot be placed with empty order sizes".'
    });
    expect(mapSubmit({ success: false }, "c1")).toEqual({
      success: false,
      orderId: null,
      clientOrderId: "c1",
      failureReason: null,
      detail: "Coinbase rejected the order without giving a reason."
    });
  });

  it("mapOrderStatus maps statuses", () => {
    const row = (status: string) => mapOrderStatus({ order: { order_id: "o", status } });
    for (const s of ["FILLED", "CANCELLED", "EXPIRED", "FAILED", "OPEN"]) {
      expect(row(s).status).toBe(s);
    }
    for (const s of ["PENDING", "QUEUED", "CANCEL_QUEUED"]) {
      expect(row(s).status).toBe("PENDING");
    }
    expect(row("WEIRD")).toMatchObject({ status: "UNKNOWN", raw: "WEIRD" });
    expect(
      mapOrderStatus({
        order: { order_id: "o", status: "FILLED", filled_size: "0.5", average_filled_price: "200", total_fees: "0.6" }
      })
    ).toEqual({ orderId: "o", status: "FILLED", filledSize: 0.5, averagePrice: 200, totalFees: 0.6, raw: "FILLED" });
    expect(() => mapOrderStatus({})).toThrow();
  });
});

describe("createCoinbaseClient", () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  // The SEC1 PEM exactly as Coinbase's ECDSA key download holds it.
  const creds = { keyId: "organizations/org-1/apiKeys/key-1", secret: ec.export({ type: "sec1", format: "pem" }).toString() };

  it("signs with the normalized PKCS#8 key and a uri claim without the query string", async () => {
    vi.mocked(generateJwt).mockClear();
    const f = stub(200, { accounts: [] });
    await createCoinbaseClient(creds, f).balances();
    expect(generateJwt).toHaveBeenCalledWith({
      apiKeyId: "organizations/org-1/apiKeys/key-1",
      apiKeySecret: ec.export({ type: "pkcs8", format: "pem" }).toString(),
      requestMethod: "GET",
      requestHost: "api.coinbase.com",
      requestPath: "/api/v3/brokerage/accounts"
    });
  });

  it("refuses a malformed stored key without calling Coinbase", async () => {
    const f = stub(200, {});
    await expect(createCoinbaseClient({ keyId: "kid", secret: "sec" }, f).keyPermissions()).rejects.toThrow("not in a format Coinbase issues");
    expect(f).not.toHaveBeenCalled();
  });

  it("keyPermissions GETs with bearer", async () => {
    const f = stub(200, { can_view: true, can_trade: true, can_transfer: false });
    const out = await createCoinbaseClient(creds, f).keyPermissions();
    expect(out.canTrade).toBe(true);
    const { url, init, headers } = call(f);
    expect(url).toBe("https://api.coinbase.com/api/v3/brokerage/key_permissions");
    expect(init.method).toBe("GET");
    expect(headers.Authorization).toBe("Bearer token");
    expect(init.cache).toBe("no-store");
  });

  it("balances GETs accounts", async () => {
    const f = stub(200, { accounts: [{ currency: "USD", available_balance: { value: "5", currency: "USD" } }], has_next: false, cursor: "", size: 1 });
    expect(await createCoinbaseClient(creds, f).balances()).toEqual([{ currency: "USD", available: 5 }]);
    expect(call(f).url).toBe("https://api.coinbase.com/api/v3/brokerage/accounts?limit=250");
  });

  it("balances follows the cursor across pages", async () => {
    const account = (currency: string, value: string) => ({ currency, available_balance: { value, currency } });
    const pages = [
      { accounts: [account("USD", "5")], has_next: true, cursor: "c-2", size: 1 },
      { accounts: [account("BTC", "0.5")], has_next: false, cursor: "", size: 1 }
    ];
    const f = vi.fn(async () => new Response(JSON.stringify(pages.shift())));
    expect(await createCoinbaseClient(creds, f).balances()).toEqual([
      { currency: "USD", available: 5 },
      { currency: "BTC", available: 0.5 }
    ]);
    expect(f.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      "https://api.coinbase.com/api/v3/brokerage/accounts?limit=250",
      "https://api.coinbase.com/api/v3/brokerage/accounts?limit=250&cursor=c-2"
    ]);
  });

  it("previewOrder sizes a BUY with quote_size", async () => {
    const f = stub(200, { preview_id: "pv", order_total: "10", errs: [], warning: [] });
    const out = await createCoinbaseClient(creds, f).previewOrder({ productId: "BTC-USD", side: "BUY", size: { kind: "quote", quoteSize: "10" } });
    expect(out.previewId).toBe("pv");
    const { url, init, headers } = call(f);
    expect(url).toBe("https://api.coinbase.com/api/v3/brokerage/orders/preview");
    expect(init.method).toBe("POST");
    expect(headers.Authorization).toBe("Bearer token");
    expect(JSON.parse(init.body as string)).toEqual({
      product_id: "BTC-USD",
      side: "BUY",
      order_configuration: { market_market_ioc: { quote_size: "10" } }
    });
  });

  it("previewOrder and createOrder size a SELL with base_size, never quote_size", async () => {
    const preview = stub(200, { preview_id: "pv", errs: [], warning: [] });
    await createCoinbaseClient(creds, preview).previewOrder({ productId: "BTC-USD", side: "SELL", size: { kind: "base", baseSize: "0.00120596" } });
    expect(JSON.parse(call(preview).init.body as string).order_configuration).toEqual({ market_market_ioc: { base_size: "0.00120596" } });

    const f = stub(200, { success: true, success_response: { order_id: "o1", client_order_id: "c1" } });
    const out = await createCoinbaseClient(creds, f).createOrder({
      productId: "BTC-USD",
      side: "SELL",
      size: { kind: "base", baseSize: "0.00120596" },
      clientOrderId: "c1",
      previewId: "pv"
    });
    expect(out.orderId).toBe("o1");
    const { url, init } = call(f);
    expect(url).toBe("https://api.coinbase.com/api/v3/brokerage/orders");
    expect(JSON.parse(init.body as string)).toEqual({
      client_order_id: "c1",
      product_id: "BTC-USD",
      side: "SELL",
      preview_id: "pv",
      order_configuration: { market_market_ioc: { base_size: "0.00120596" } }
    });
  });

  it("refuses to send a quote-sized SELL", async () => {
    const f = stub(200, {});
    await expect(
      createCoinbaseClient(creds, f).createOrder({ productId: "BTC-USD", side: "SELL", size: { kind: "quote", quoteSize: "100" }, clientOrderId: "c1" })
    ).rejects.toThrow("A market SELL must be sized in base currency (base_size).");
    expect(f).not.toHaveBeenCalled();
  });

  it("getOrder GETs historical", async () => {
    const f = stub(200, { order: { order_id: "o1", status: "OPEN" } });
    const out = await createCoinbaseClient(creds, f).getOrder("o1");
    expect(out.status).toBe("OPEN");
    expect(call(f).url).toBe("https://api.coinbase.com/api/v3/brokerage/orders/historical/o1");
  });

  it("throws a readable typed error on non-2xx", async () => {
    await expect(createCoinbaseClient(creds, stub(401, "Unauthorized")).keyPermissions()).rejects.toThrow(
      "Coinbase rejected the API key (HTTP 401): Unauthorized."
    );
    const body = { error: "PERMISSION_DENIED", error_details: "Missing required scopes", message: "Missing required scopes" };
    const err = await createCoinbaseClient(creds, stub(403, body)).balances().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExchangeHttpError);
    expect(err).toMatchObject({ status: 403, reason: "PERMISSION_DENIED", message: "Coinbase refused the request (HTTP 403): Missing required scopes." });
    expect(normalizeExchangeError(await createCoinbaseClient(creds, stub(429, "")).balances().catch((e: unknown) => e))).toMatchObject({
      code: "rate_limited",
      retriable: true
    });
    expect(normalizeExchangeError(await createCoinbaseClient(creds, stub(503, "")).balances().catch((e: unknown) => e))).toMatchObject({
      code: "provider_unavailable",
      retriable: true,
      ambiguous: true
    });
  });

  it("passes a 10 s abort signal and maps a timeout or network failure to a transport error", async () => {
    const f = stub(200, { accounts: [] });
    await createCoinbaseClient(creds, f).balances();
    expect(call(f).init.signal).toBeInstanceOf(AbortSignal);

    const timeout = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const t = await createCoinbaseClient(creds, timeout).balances().catch((e: unknown) => e);
    expect(t).toBeInstanceOf(ExchangeTransportError);
    expect(t).toMatchObject({ kind: "timeout", message: "Coinbase did not answer within 10 s." });

    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await createCoinbaseClient(creds, offline).balances().catch((e: unknown) => e)).toMatchObject({ kind: "network" });
  });

  it("throws on malformed JSON", async () => {
    await expect(createCoinbaseClient(creds, stub(200, "<html>")).balances()).rejects.toThrow();
    await expect(createCoinbaseClient(creds, stub(200, { x: 1 })).balances()).rejects.toThrow();
  });
});

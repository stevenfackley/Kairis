import { generateKeyPairSync } from "node:crypto";
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
import { fetchCandles, fetchTicker, mapCandles, mapTicker } from "@/lib/exchange/coinbase-public";

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

describe("authed mappers", () => {
  it("mapKeyPermissions", () => {
    expect(mapKeyPermissions({ can_view: true, can_trade: false, can_transfer: false, portfolio_uuid: "p-1" })).toEqual({
      canView: true,
      canTrade: false,
      canTransfer: false,
      portfolioUuid: "p-1"
    });
    expect(mapKeyPermissions({ can_view: true, can_trade: true, can_transfer: true }).portfolioUuid).toBeNull();
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

  it("mapPreview", () => {
    expect(
      mapPreview({
        order_total: "100",
        commission_total: "0.6",
        best_bid: "99",
        best_ask: "101",
        preview_id: "pv",
        errs: ["e1"],
        warning: ["w1"]
      })
    ).toEqual({ previewId: "pv", orderTotal: 100, commissionTotal: 0.6, bestBid: 99, bestAsk: 101, warnings: ["e1", "w1"] });
    expect(mapPreview({})).toEqual({
      previewId: null,
      orderTotal: 0,
      commissionTotal: 0,
      bestBid: null,
      bestAsk: null,
      warnings: []
    });
  });

  it("mapSubmit success and failure", () => {
    expect(
      mapSubmit({ success: true, success_response: { order_id: "o1", client_order_id: "c1" } }, "c1")
    ).toEqual({ success: true, orderId: "o1", clientOrderId: "c1", detail: "Coinbase accepted the order." });
    expect(mapSubmit({ success: false, error_response: { message: "m", error_details: "d" } }, "c1").detail).toBe("d");
    expect(mapSubmit({ success: false, error_response: { message: "m" } }, "c1").detail).toBe("m");
    expect(mapSubmit({ success: false, error_response: { preview_failure_reason: "p" } }, "c1").detail).toBe("p");
    expect(mapSubmit({ success: false }, "c1")).toEqual({
      success: false,
      orderId: null,
      clientOrderId: "c1",
      detail: "Coinbase rejected the order."
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
    const f = stub(200, { accounts: [{ currency: "USD", available_balance: { value: "5", currency: "USD" } }] });
    expect(await createCoinbaseClient(creds, f).balances()).toEqual([{ currency: "USD", available: 5 }]);
    expect(call(f).url).toBe("https://api.coinbase.com/api/v3/brokerage/accounts?limit=250");
  });

  it("previewOrder POSTs market config", async () => {
    const f = stub(200, { preview_id: "pv", order_total: "10" });
    const out = await createCoinbaseClient(creds, f).previewOrder({ productId: "BTC-USD", side: "BUY", quoteUsd: 10 });
    expect(out.previewId).toBe("pv");
    const { url, init, headers } = call(f);
    expect(url).toBe("https://api.coinbase.com/api/v3/brokerage/orders/preview");
    expect(init.method).toBe("POST");
    expect(headers.Authorization).toBe("Bearer token");
    expect(JSON.parse(init.body as string)).toEqual({
      product_id: "BTC-USD",
      side: "BUY",
      order_configuration: { market_market_ioc: { quote_size: "10.00" } }
    });
  });

  it("createOrder POSTs with ids", async () => {
    const f = stub(200, { success: true, success_response: { order_id: "o1", client_order_id: "c1" } });
    const out = await createCoinbaseClient(creds, f).createOrder({
      productId: "BTC-USD",
      side: "SELL",
      quoteUsd: 12.345,
      clientOrderId: "c1",
      previewId: "pv"
    });
    expect(out.orderId).toBe("o1");
    const { url, init } = call(f);
    expect(url).toBe("https://api.coinbase.com/api/v3/brokerage/orders");
    expect(JSON.parse(init.body as string)).toMatchObject({
      client_order_id: "c1",
      preview_id: "pv",
      side: "SELL"
    });
  });

  it("getOrder GETs historical", async () => {
    const f = stub(200, { order: { order_id: "o1", status: "OPEN" } });
    const out = await createCoinbaseClient(creds, f).getOrder("o1");
    expect(out.status).toBe("OPEN");
    expect(call(f).url).toBe("https://api.coinbase.com/api/v3/brokerage/orders/historical/o1");
  });

  it("throws with status on non-2xx", async () => {
    await expect(createCoinbaseClient(creds, stub(401, "nope")).keyPermissions()).rejects.toThrow(
      "Coinbase request failed (401): nope"
    );
  });

  it("throws on malformed JSON", async () => {
    await expect(createCoinbaseClient(creds, stub(200, "<html>")).balances()).rejects.toThrow();
    await expect(createCoinbaseClient(creds, stub(200, { x: 1 })).balances()).rejects.toThrow();
  });
});

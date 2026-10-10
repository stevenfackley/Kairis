import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapProduct } from "@/lib/exchange/coinbase-public";
import {
  compareDecimal,
  decimalString,
  describeSize,
  floorToIncrement,
  isMultipleOf,
  marketOrderBlocker,
  sizeMarketOrder,
  sizeViolations,
  type ProductRules
} from "@/lib/exchange/sizing";

// Captured from GET https://api.coinbase.com/api/v3/brokerage/market/products/{id} on 2026-10-10.
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/coinbase", name), "utf8"));
}
const BTC = mapProduct(fixture("product-btc-usd.json"));
const SHIB = mapProduct(fixture("product-shib-usd.json"));
const BTC_PRICE = 82921.36;

describe("decimal helpers", () => {
  it("prints numbers as plain decimals, never in exponent form", () => {
    expect(decimalString(4.35)).toBe("4.35");
    expect(decimalString(1e-7)).toBe("0.0000001");
    expect(decimalString(1.5e-9)).toBe("0.0000000015");
    expect(decimalString(1e21)).toBe("1000000000000000000000");
    expect(decimalString(0)).toBe("0");
    expect(() => decimalString(-1)).toThrow();
    expect(() => decimalString(Number.NaN)).toThrow();
  });

  it("floors to an increment exactly", () => {
    expect(floorToIncrement("0.0012059602213450537", "0.00000001")).toBe("0.00120596");
    expect(floorToIncrement("4.35", "0.01")).toBe("4.35");
    expect(floorToIncrement("100", "0.01")).toBe("100");
    expect(floorToIncrement("18315018.315", "1")).toBe("18315018");
    expect(floorToIncrement("0.009", "0.01")).toBe("0");
    expect(floorToIncrement("1.27", "0.05")).toBe("1.25");
  });

  it("compares and checks multiples exactly", () => {
    expect(compareDecimal("0.00000001", "0.000000010")).toBe(0);
    expect(compareDecimal("1", "0.99999999")).toBe(1);
    expect(isMultipleOf("0.00120596", "0.00000001")).toBe(true);
    expect(isMultipleOf("0.001205961", "0.00000001")).toBe(false);
    expect(isMultipleOf("10.5", "1")).toBe(false);
  });
});

describe("mapProduct", () => {
  it("reads the increments, bounds and flags of a live product", () => {
    expect(BTC).toEqual({
      productId: "BTC-USD",
      baseCurrency: "BTC",
      status: "online",
      baseIncrement: "0.00000001",
      quoteIncrement: "0.01",
      baseMinSize: "0.00000001",
      baseMaxSize: "3400",
      quoteMinSize: "1",
      quoteMaxSize: "150000000",
      isDisabled: false,
      tradingDisabled: false,
      cancelOnly: false,
      limitOnly: false,
      postOnly: false,
      viewOnly: false
    });
    expect(SHIB).toMatchObject({ baseIncrement: "1", quoteIncrement: "0.00000001", baseMinSize: "1" });
  });

  it("rejects a product without usable increments", () => {
    expect(() => mapProduct({ product_id: "X-USD", base_increment: "", quote_increment: "0.01" })).toThrow("base_increment");
    expect(() => mapProduct({})).toThrow("Malformed Coinbase product response.");
  });
});

describe("sizeMarketOrder", () => {
  it("sizes a BUY in quote currency, floored to quote_increment", () => {
    expect(sizeMarketOrder({ side: "BUY", quoteUsd: 100, price: BTC_PRICE, rules: BTC })).toEqual({
      ok: true,
      size: { kind: "quote", quoteSize: "100" },
      notionalUsd: 100,
      note: null
    });
    expect(sizeMarketOrder({ side: "BUY", quoteUsd: 4.35, price: BTC_PRICE, rules: BTC })).toMatchObject({ size: { kind: "quote", quoteSize: "4.35" } });
  });

  it("sizes a SELL in base currency from the dollar amount, floored to base_increment", () => {
    const r = sizeMarketOrder({ side: "SELL", quoteUsd: 100, price: BTC_PRICE, rules: BTC });
    expect(r).toMatchObject({ ok: true, size: { kind: "base", baseSize: "0.00120596" } });
    if (r.ok) {
      // Never sells more than the dollars asked for.
      expect(r.notionalUsd).toBeLessThanOrEqual(100);
      expect(r.notionalUsd).toBeGreaterThan(99.99);
    }
    // Whole-coin increments round down too.
    expect(sizeMarketOrder({ side: "SELL", quoteUsd: 100, price: 0.00000546, rules: SHIB })).toMatchObject({ size: { kind: "base", baseSize: "18315018" } });
  });

  it("sells an exact base size when closing a position", () => {
    expect(sizeMarketOrder({ side: "SELL", quoteUsd: 0, baseSize: 0.123456789, price: BTC_PRICE, rules: BTC })).toMatchObject({
      ok: true,
      size: { kind: "base", baseSize: "0.12345678" }
    });
  });

  it("blocks sizes below the product minimum with the minimum in the message", () => {
    expect(sizeMarketOrder({ side: "BUY", quoteUsd: 0.5, price: BTC_PRICE, rules: BTC })).toEqual({
      ok: false,
      reason: "The smallest BTC-USD buy Coinbase accepts is $1.00."
    });
    const sell = sizeMarketOrder({ side: "SELL", quoteUsd: 0.000004, price: 0.00000546, rules: SHIB });
    expect(sell).toEqual({ ok: false, reason: "This sell comes to 0 SHIB, below the 1 SHIB minimum Coinbase accepts for SHIB-USD." });
  });

  it("blocks sizes above the product maximum", () => {
    expect(sizeMarketOrder({ side: "SELL", quoteUsd: 0, baseSize: 3500, price: BTC_PRICE, rules: BTC })).toEqual({
      ok: false,
      reason: "The largest BTC-USD market sell Coinbase accepts is 3,400 BTC."
    });
  });

  it("sizes a sell down to the Coinbase balance when the gap is fee-sized, and blocks a real shortfall", () => {
    const close = sizeMarketOrder({ side: "SELL", quoteUsd: 0, baseSize: 0.001, availableBase: 0.000994, price: BTC_PRICE, rules: BTC });
    expect(close).toMatchObject({ ok: true, size: { kind: "base", baseSize: "0.000994" } });
    if (close.ok) expect(close.note).toBe("Sized down from 0.001 to the 0.000994 BTC available on Coinbase.");

    const short = sizeMarketOrder({ side: "SELL", quoteUsd: 100, availableBase: 0.0005, price: BTC_PRICE, rules: BTC });
    expect(short).toEqual({
      ok: false,
      reason: "Coinbase shows 0.0005 BTC available (about $41.46), less than the 0.00120596 BTC this sell needs."
    });
    expect(sizeMarketOrder({ side: "SELL", quoteUsd: 100, availableBase: 0, price: BTC_PRICE, rules: BTC })).toMatchObject({ ok: false });
  });

  it("refuses to size a sell without a price", () => {
    expect(sizeMarketOrder({ side: "SELL", quoteUsd: 100, price: 0, rules: BTC })).toEqual({
      ok: false,
      reason: "There is no current BTC-USD price to size the sell; try again shortly."
    });
  });

  it("blocks products Coinbase will not take market orders for", () => {
    const cases: Array<[Partial<ProductRules>, string]> = [
      [{ tradingDisabled: true }, "BTC-USD is disabled for trading on Coinbase right now."],
      [{ isDisabled: true }, "BTC-USD is disabled for trading on Coinbase right now."],
      [{ cancelOnly: true }, "BTC-USD is in cancel-only mode on Coinbase: new orders are not accepted."],
      [{ limitOnly: true }, "BTC-USD accepts only limit orders on Coinbase right now, and Kairis places market orders."],
      [{ postOnly: true }, "BTC-USD accepts only post-only limit orders on Coinbase right now, and Kairis places market orders."],
      [{ status: "delisted" }, 'Coinbase lists BTC-USD as "delisted", not online.']
    ];
    for (const [override, reason] of cases) {
      const rules = { ...BTC, ...override };
      expect(marketOrderBlocker(rules)).toBe(reason);
      expect(sizeMarketOrder({ side: "BUY", quoteUsd: 100, price: BTC_PRICE, rules })).toEqual({ ok: false, reason });
    }
    expect(marketOrderBlocker({ ...BTC, status: "" })).toBeNull();
  });
});

describe("sizeViolations", () => {
  it("returns the PreviewFailureReason codes Coinbase would", () => {
    expect(sizeViolations("BUY", { kind: "quote", quoteSize: "100" }, BTC)).toEqual([]);
    expect(sizeViolations("SELL", { kind: "base", baseSize: "0.00120596" }, BTC)).toEqual([]);
    expect(sizeViolations("SELL", { kind: "quote", quoteSize: "100" }, BTC)).toEqual(["PREVIEW_INVALID_ORDER_CONFIG"]);
    expect(sizeViolations("BUY", { kind: "quote", quoteSize: "0.5" }, BTC)).toEqual(["PREVIEW_INVALID_QUOTE_SIZE_TOO_SMALL"]);
    expect(sizeViolations("BUY", { kind: "quote", quoteSize: "10.005" }, BTC)).toEqual(["PREVIEW_INVALID_QUOTE_SIZE_PRECISION"]);
    expect(sizeViolations("SELL", { kind: "base", baseSize: "0.5" }, SHIB)).toEqual(["PREVIEW_INVALID_SIZE_PRECISION", "PREVIEW_INVALID_BASE_SIZE_TOO_SMALL"]);
    expect(sizeViolations("SELL", { kind: "base", baseSize: "4000" }, BTC)).toEqual(["PREVIEW_INVALID_BASE_SIZE_TOO_LARGE"]);
    expect(sizeViolations("BUY", { kind: "quote", quoteSize: "100" }, { ...BTC, cancelOnly: true })).toEqual(["PREVIEW_TRADING_DISABLED"]);
    expect(sizeViolations("BUY", { kind: "quote", quoteSize: "100" }, { ...BTC, limitOnly: true })).toEqual(["PREVIEW_NOT_ALLOWED_BY_MARKET_STATE"]);
  });
});

describe("describeSize", () => {
  it("says what the order does", () => {
    expect(describeSize({ kind: "quote", quoteSize: "1234.5" }, "BTC-USD")).toBe("spend $1,234.50");
    expect(describeSize({ kind: "base", baseSize: "0.00120596" }, "BTC-USD")).toBe("sell 0.00120596 BTC");
  });
});

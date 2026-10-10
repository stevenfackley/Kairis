import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapProduct } from "@/lib/exchange/coinbase-public";
import { createMockClient } from "@/lib/exchange/mock";

const BTC = mapProduct(JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/coinbase/product-btc-usd.json"), "utf8")));

let clientSeq = 0;
function makeClient(withRules = false) {
  let n = 0;
  const prefix = `m${++clientSeq}`;
  return createMockClient(
    async () => 100,
    () => `${prefix}-id-${++n}`,
    withRules ? async () => BTC : undefined
  );
}

describe("mock exchange", () => {
  it("reports read-only permissions and balance", async () => {
    const c = makeClient();
    expect(c.provider).toBe("mock");
    expect(await c.keyPermissions()).toEqual({
      canView: true,
      canTrade: false,
      canTransfer: false,
      portfolioUuid: null,
      portfolioType: null
    });
    expect(await c.balances()).toEqual([{ currency: "USD", available: 10000 }]);
  });

  it("previews a quote-sized buy with the fee inside the quote size, as Coinbase does", async () => {
    const p = await makeClient().previewOrder({ productId: "BTC-USD", side: "BUY", size: { kind: "quote", quoteSize: "50" } });
    expect(p.previewId).toMatch(/-id-1$/);
    // $50 is the whole spend: 49.70178926 buys coins, 0.29821074 (0.6% of that) is the fee.
    expect(p.orderTotal).toBe(50);
    expect(p.commissionTotal).toBe(0.29821074);
    expect(p.baseSize).toBe(0.49701789);
    expect(p.bestBid).toBeCloseTo(99.95);
    expect(p.bestAsk).toBeCloseTo(100.05);
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual(["Mock provider active: no live order will be sent."]);
  });

  it("follows the fee arithmetic of a recorded Coinbase quote-sized market buy", async () => {
    // Recorded GET orders/historical/batch entry (ccxt coinbase adapter): quote_size "6.36",
    // filled_value "6.3220675944333996", total_fees "0.0379324055666004", total_value_after_fees "6.36".
    const c = createMockClient(async () => 21220.6399999973697697, () => "rec-1");
    const r = await c.createOrder({ productId: "BTC-USDT", side: "BUY", size: { kind: "quote", quoteSize: "6.36" }, clientOrderId: "c-recorded" });
    const s = await c.getOrder(r.orderId!);
    expect(s.totalFees).toBeCloseTo(0.0379324055666004, 7);
    expect(s.filledSize).toBeCloseTo(0.000297920684505, 8);
  });

  it("creates and then reports a filled order", async () => {
    const c = makeClient();
    const r = await c.createOrder({ productId: "BTC-USD", side: "BUY", size: { kind: "quote", quoteSize: "50" }, clientOrderId: "c-fill" });
    expect(r).toMatchObject({ success: true, clientOrderId: "c-fill", failureReason: null, detail: "Mock order accepted for BUY BTC-USD with quote size 50." });
    expect(await c.getOrder(r.orderId!)).toEqual({
      orderId: r.orderId,
      status: "FILLED",
      filledSize: 0.49701789,
      averagePrice: 100,
      totalFees: 0.29821074,
      raw: "FILLED"
    });
  });

  it("fills a base-sized sell for exactly the base size, fee charged on the proceeds", async () => {
    const c = makeClient(true);
    const p = await c.previewOrder({ productId: "BTC-USD", side: "SELL", size: { kind: "base", baseSize: "0.25" } });
    expect(p).toMatchObject({ orderTotal: 24.85, commissionTotal: 0.15, baseSize: 0.25, quoteSize: 25 });
    const r = await c.createOrder({ productId: "BTC-USD", side: "SELL", size: { kind: "base", baseSize: "0.25" }, clientOrderId: "c-sell" });
    expect(await c.getOrder(r.orderId!)).toMatchObject({ status: "FILLED", filledSize: 0.25, averagePrice: 100, totalFees: 0.15 });
  });

  it("returns the existing order for a repeated client order id instead of filling twice", async () => {
    const c = makeClient();
    const first = await c.createOrder({ productId: "BTC-USD", side: "BUY", size: { kind: "quote", quoteSize: "50" }, clientOrderId: "c-dup" });
    const again = await c.createOrder({ productId: "BTC-USD", side: "BUY", size: { kind: "quote", quoteSize: "50" }, clientOrderId: "c-dup" });
    expect(again).toMatchObject({ success: true, orderId: first.orderId });
  });

  it("enforces the Coinbase product rules like the live exchange", async () => {
    const c = makeClient(true);
    const small = await c.previewOrder({ productId: "BTC-USD", side: "BUY", size: { kind: "quote", quoteSize: "0.5" } });
    expect(small.errors).toEqual(["The order is below the minimum size Coinbase accepts for this product. (PREVIEW_INVALID_QUOTE_SIZE_TOO_SMALL)"]);
    const quoteSell = await c.previewOrder({ productId: "BTC-USD", side: "SELL", size: { kind: "quote", quoteSize: "50" } });
    expect(quoteSell.errors).toEqual(["Coinbase rejected the order configuration. (PREVIEW_INVALID_ORDER_CONFIG)"]);
    const precise = await c.createOrder({ productId: "BTC-USD", side: "SELL", size: { kind: "base", baseSize: "0.000000001" }, clientOrderId: "c-precise" });
    expect(precise).toMatchObject({ success: false, orderId: null, failureReason: "INVALID_SIZE_PRECISION" });
    expect(precise.detail).toContain("more decimals than Coinbase allows");
  });

  it("refuses a quote-sized sell even without product rules", async () => {
    const p = await makeClient().previewOrder({ productId: "BTC-USD", side: "SELL", size: { kind: "quote", quoteSize: "50" } });
    expect(p.errors).toHaveLength(1);
  });

  it("finds an order by its client order id", async () => {
    const c = makeClient();
    const r = await c.createOrder({ productId: "BTC-USD", side: "BUY", size: { kind: "quote", quoteSize: "50" }, clientOrderId: "c-find" });
    const lookup = { productId: "BTC-USD", side: "BUY" as const, createdAfter: "2026-01-01T00:00:00Z", createdBefore: "2099-01-01T00:00:00Z" };
    expect(await c.findOrderByClientId({ ...lookup, clientOrderId: "c-find" })).toMatchObject({ orderId: r.orderId, status: "FILLED" });
    expect(await c.findOrderByClientId({ ...lookup, clientOrderId: "c-missing" })).toBeNull();
  });

  it("returns UNKNOWN for unissued ids", async () => {
    const s = await makeClient().getOrder("never-issued");
    expect(s).toMatchObject({ orderId: "never-issued", status: "UNKNOWN", filledSize: null });
  });
});
